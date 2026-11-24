'use strict';
/* =====================================================================
 *  Рендерер: порядок проходов
 *   небо → частицы галактик → пыль → туманности → звёзды → линии →
 *   (линза + чёрная дыра) → тела (звёзды/планеты, от дальних к ближним)
 *   → bloom → ACES-тонемаппинг.
 *  Все позиции передаются в шейдеры относительно камеры (double → float).
 * ===================================================================== */
(function () {
  const MW = window.MW;
  const v3 = MW.v3;
  const f32 = (a) => new Float32Array(a);
  const AU = MW.C.AU_LY;

  const TYPE_DEFAULTS = {
    0: { col1: [0.45, 0.43, 0.4], col2: [0.62, 0.6, 0.56], bump: 6, dot: [0.6, 0.58, 0.55] },
    1: { dot: [0.95, 0.88, 0.7] }, 2: { dot: [0.5, 0.65, 1.0] }, 3: { dot: [1.0, 0.55, 0.35] },
    4: { dot: [0.95, 0.85, 0.7] }, 5: { dot: [0.95, 0.85, 0.6] }, 6: { dot: [0.7, 0.9, 0.95] }, 7: { dot: [0.45, 0.6, 1.0] },
    8: { dot: [0.75, 0.75, 0.72] }, 9: { dot: [0.95, 0.85, 0.4] }, 10: { dot: [0.9, 0.85, 0.78] }, 11: { dot: [0.9, 0.6, 0.3] },
    12: { dot: [0.5, 0.65, 0.9] }, 13: { dot: [0.8, 0.6, 0.4] }, 14: { dot: [0.9, 0.8, 0.65] }, 15: { dot: [1.0, 0.4, 0.15] },
    16: { dot: [0.85, 0.9, 1.0] }, 17: { dot: [0.6, 0.8, 0.95] },
  };
  // тип поверхности → вариант шейдера планет (см. #if FAM в bodies.js)
  const PLANET_FAM = { 0: 0, 8: 0, 9: 0, 10: 0, 3: 1, 12: 1, 13: 1, 15: 1, 16: 1, 2: 2, 1: 3, 4: 3, 5: 3, 6: 3, 7: 3, 11: 3, 14: 3, 17: 3 };
  const NEB = {
    m42: { kind: 0, col1: [1.0, 0.16, 0.42], col2: [0.25, 0.85, 0.95], col3: [1, 1, 1], bright: 3.0, rb: 1.0 },
    m1: { kind: 2, col1: [1.0, 0.42, 0.2], col2: [1.0, 0.78, 0.4], col3: [0.45, 0.55, 1.0], bright: 0.8, rb: 1.0, par: [1, 0, 0, 0] },
    m57: { kind: 1, col1: [0.3, 0.55, 1.0], col2: [0.45, 1.0, 0.45], col3: [1.0, 0.3, 0.2], bright: 0.4, rb: 1.0 },
    horsehead: { kind: 7, col1: [1.0, 0.12, 0.17], col2: [1.0, 0.35, 0.4], col3: [0.45, 0.62, 1.0], bright: 0.9, rb: 1.0 },
    flame: { kind: 0, col1: [1.0, 0.5, 0.18], col2: [1.0, 0.72, 0.4], col3: [1, 1, 1], bright: 0.8, rb: 1.0 },
    m16: { kind: 4, col1: [1.0, 0.32, 0.3], col2: [0.95, 0.62, 0.38], col3: [0.4, 0.9, 0.85], bright: 0.6, rb: 1.0 },
    carina: { kind: 4, col1: [1.0, 0.28, 0.35], col2: [0.92, 0.5, 0.62], col3: [0.5, 0.8, 1.0], bright: 0.5, rb: 1.0 },
    m45: { kind: 3, col1: [0.42, 0.58, 1.0], col2: [0, 0, 0], col3: [0, 0, 0], bright: 0.45, rb: 1.5 },
    m8: { kind: 4, col1: [1.0, 0.3, 0.4], col2: [1.0, 0.55, 0.62], col3: [0.6, 0.8, 1.0], bright: 0.7 },
    m20: { kind: 4, col1: [1.0, 0.28, 0.38], col2: [0.45, 0.6, 1.0], col3: [0.7, 0.8, 1.0], bright: 0.8 },
    rosette: { kind: 5, col1: [1.0, 0.35, 0.42], col2: [0.95, 0.22, 0.3], col3: [1, 1, 1], bright: 0.9 },
    ngc7000: { kind: 4, col1: [1.0, 0.27, 0.32], col2: [0.95, 0.45, 0.4], col3: [0.6, 0.85, 1.0], bright: 0.6 },
    tarantula: { kind: 4, col1: [1.0, 0.35, 0.5], col2: [0.55, 0.85, 0.9], col3: [1.0, 0.95, 0.9], bright: 1.2 },
    veil: { kind: 2, col1: [0.35, 0.75, 1.0], col2: [1.0, 0.35, 0.3], col3: [0, 0, 0], bright: 0.9, par: [0, 1, 0, 0] },
    helix: { kind: 1, col1: [0.35, 0.75, 0.9], col2: [0.5, 0.9, 0.7], col3: [1.0, 0.3, 0.25], bright: 0.5, par: [0, 0, 1, 0], tilt: 22 },
    m27: { kind: 1, col1: [0.4, 0.7, 1.0], col2: [0.45, 1.0, 0.5], col3: [1.0, 0.35, 0.3], bright: 0.5, tilt: 80 },
    catseye: { kind: 1, col1: [0.5, 0.85, 1.0], col2: [0.35, 1.0, 0.65], col3: [1.0, 0.4, 0.3], bright: 0.6, par: [0, 0, 0.5, 0], tilt: 35 },
    crabpsr: { kind: 6, col1: [0.75, 0.85, 1.0], col2: [0.5, 0.65, 1.0], col3: [0.55, 0.6, 1.0], bright: 1.0, par: [0, 0, 0, 6.0] },
    velapsr: { kind: 6, col1: [0.75, 0.85, 1.0], col2: [0.5, 0.65, 1.0], col3: [0.55, 0.6, 1.0], bright: 1.0, par: [0, 0, 0, 4.0] },
    geminga: { kind: 6, col1: [0.85, 0.75, 1.0], col2: [0.6, 0.55, 1.0], col3: [0.5, 0.5, 0.9], bright: 0.8, par: [0, 0, 0, 2.5] },
    psr1919: { kind: 6, col1: [0.75, 0.9, 1.0], col2: [0.45, 0.6, 1.0], col3: [0.4, 0.5, 0.9], bright: 0.7, par: [0, 0, 0, 1.0] },
    psr0437: { kind: 6, col1: [0.8, 0.9, 1.0], col2: [0.55, 0.7, 1.0], col3: [0.45, 0.55, 1.0], bright: 0.8, par: [0, 0, 0, 9.0] },
  };

  class Renderer {
    constructor(glc, scene) {
      this.glc = glc; this.gl = glc.gl; this.scene = scene;
      this.s = { renderScale: 1, bloom: 0.5, exposure: 1.0, constellations: true, grid: false, orbits: true, galaxyBright: 1, magLimit: 8.5, quality: 1, artistic: true, panorama: true, panoGain: 1.0 };
      this.width = 1; this.height = 1;
      this.compile();
      this.buildStatic();
      this.lineBuf = this.gl.createBuffer();
      this.lineVAO = this.makeLineVAO();
      this.nearBuf = glc.instanced(new Float32Array(7 * 64), [[1, 3], [2, 4]], this.gl.DYNAMIC_DRAW);
      this.stats = {};
    }
    compile() {
      const G = MW.GLSL, c = (n, vs, fs) => this.glc.program(n, vs, fs);
      this.pSky = c('sky', G.fullscreenVS, G.skyFS);
      this.pPart = c('particles', G.particleVS, G.particleFS);
      this.pDust = c('dust', G.particleVS, G.dustFS);
      this.pStar = c('stars', G.starVS, G.starFSprite);
      this.pLine = c('lines', G.lineVS, G.lineFS);
      this.pStarBody = c('starBody', G.impostorVS, G.starFS);
      // шейдер планет собирается в 4 вариантах (#define FAM): кратерированные, каменные/экзо, Земля, газовые/атмосферные —
      // каждый вариант содержит только свой код и компилируется в разы быстрее монолита
      this.pPlanetFam = [0, 1, 2, 3].map((k) => c('planet' + k, G.impostorVS, G.planetFS.replace('#version 300 es\n', '#version 300 es\n#define FAM ' + k + '\n')));
      this.pNebula = c('nebula', G.impostorVS, G.nebulaFS);
      this.pBH = c('blackhole', G.impostorVS, G.blackholeFS);
      this.pLens = c('lens', G.fullscreenVS, G.lensFS);
      this.pDown = c('down', G.fullscreenVS, G.downFS);
      this.pUp = c('up', G.fullscreenVS, G.upFS);
      this.pComp = c('composite', G.fullscreenVS, G.compositeFS);
      this.pBlit = c('blit', G.fullscreenVS, G.blitFS);
      this.pGas = c('gas', G.particleVS, G.gasFS);
      this.pProbe = c('probe', G.impostorVS, G.probeFS);
      this.pDSO = c('deepsky', G.dsoVS, G.dsoFS);
      this.pFlare = c('flare', G.fullscreenVS, G.flareFS);
      this.pLum = c('lum', G.fullscreenVS, G.lumFS);
    }
    makeLineVAO() {
      const gl = this.gl;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
      gl.bindVertexArray(null);
      return vao;
    }
    frameMat(x, y, z) { return f32([x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]]); }

    buildStatic() {
      const glc = this.glc, q = this.s.quality, L = [[1, 3], [2, 4]];
      const t0 = performance.now();
      const mw = MW.galaxy.buildMilkyWay(q);
      this.mwLum = glc.instanced(mw.lum, L); this.mwDust = glc.instanced(mw.dust, L); this.mwHalo = glc.instanced(mw.halo, L); this.mwGas = glc.instanced(mw.gas, L);
      const cat = MW.catalog, GB = MW.galaxy;
      // галактики Местной группы (M31, M33, Магеллановы Облака, карлики)
      this.extGal = [];
      for (const o of cat.dsos.filter((d) => d.vis === 'galaxy' && !d.lite && d.normal)) {
        const seed = MW.rng.hashStr(o.id) % 100000;
        let d, model;
        if (o.gal === 'spiral') {
          d = o.id === 'm31' ? GB.buildSpiral(31, 100000, 90000, q)
            : GB.buildSpiral(seed, o.radius, o.ext ? 3000 : 70000, q, { pitch: 24, bulge: o.ext ? 0.15 : 0.05, flocculent: 0.2, sizeK: o.ext ? 1 : 0.5, dust: false });
          const mz = o.normal, mx = v3.norm(v3.sub(o.major, v3.scale(mz, v3.dot(o.major, mz))));
          model = this.frameMat(mx, v3.cross(mz, mx), mz);
        } else {
          if (o.gal === 'irr') d = GB.buildIrregular(seed, o.radius, o.id === 'lmc' ? 30000 : o.id === 'smc' ? 14000 : o.ext ? 2500 : 9000, q, o.id === 'lmc' ? 0.35 : o.id === 'smc' ? 0.12 : 0.06);
          else if (o.gal === 'ell') d = GB.buildElliptical(seed, o.radius, o.ext ? 2500 : o.id === 'm32' ? 8000 : 12000, q, [1, 0.8, 0.7], false);
          else d = GB.buildElliptical(seed, o.radius, o.id === 'sgrdsph' ? 9000 : 3500, q, o.id === 'sgrdsph' ? [1, 0.35, 0.3] : [1, 0.75, 0.65], true);
          const fr = MW.solar.bodyFrame(o.normal);
          model = this.frameMat(fr.x, fr.y, fr.z);
        }
        this.extGal.push({ obj: o, lum: glc.instanced(d.lum, L), dust: d.dust.length ? glc.instanced(d.dust, L) : null, model, bright: o.gal === 'dsph' ? 0.7 : 1.0 });
      }
      // скопления: звёзды + интегральное свечение
      this.clusters = [];
      const addCl = (o, stars, glow) => this.clusters.push({ obj: o, stars: glc.instanced(stars, L), glow: glow ? glc.instanced(glow, L) : null });
      for (const o of cat.dsos.filter((d) => d.vis === 'globular' && !d.lite)) {
        const g = GB.buildGlobular(MW.rng.hashStr(o.id) % 100000, o.radius, o.id === 'omegacen' ? 40000 : o.id === 'm13' ? 28000 : o.ext ? 1500 : 9000);
        addCl(o, g.stars, g.glow);
      }
      // рассеянные скопления из OpenNGC (Мессье/NGC)
      for (const o of cat.dsos.filter((d) => d.ext && d.vis === 'cluster' && !d.lite)) {
        addCl(o, GB.buildOpenCluster(MW.rng.hashStr(o.id) % 100000, Math.max(o.radius, 1), Math.round(MW.util.clamp(o.radius * 6, 40, 220)), true));
      }
      // звёзды каталога HYG (~25 000)
      const hs = [];
      for (const s of cat.hygStars) hs.push(s.pos[0], s.pos[1], s.pos[2], s.color[0], s.color[1], s.color[2], s.absMag);
      this.hygBuf = glc.instanced(f32(hs), L);
      // нейтронные звёзды пульсаров
      for (const o of cat.dsos.filter((d) => d.vis === 'pulsar' && !d.lite && d.id !== 'crabpsr')) {
        const c = MW.color.blackbody(40000);
        addCl(o, f32([0, 0, 0, c[0], c[1], c[2], 4.0]));
      }
      addCl(cat.dsoById.rosette, GB.buildOpenCluster(2244, 6, 120, true));
      addCl(cat.dsoById.m45, MW.galaxy.buildOpenCluster(45, 9, 260, true));
      addCl(cat.dsoById.hyades, MW.galaxy.buildOpenCluster(46, 12, 200, false));
      const onc = Array.from(MW.galaxy.buildOpenCluster(42, 2.5, 160, false));
      // Трапеция Ориона: θ¹ Ori C, A, B, D
      for (const [x, y, z, T, M] of [[0.02, 0.01, 0, 39000, -5.5], [-0.03, 0.03, 0.01, 30000, -3.6], [0.0, -0.035, 0.02, 25000, -3.0], [0.04, -0.01, -0.02, 32000, -3.3]]) {
        const c = MW.color.blackbody(T); onc.push(x, y, z, c[0], c[1], c[2], M);
      }
      addCl(cat.dsoById.m42, f32(onc));
      // центральные звёзды туманностей: пульсар Краба, белый карлик M57
      const cb = (T, M) => { const c = MW.color.blackbody(T); return f32([0, 0, 0, c[0], c[1], c[2], M]); };
      addCl(cat.dsoById.m1, cb(30000, 2.0));
      addCl(cat.dsoById.m57, cb(120000, 1.5));
      // каталожные звёзды
      const cs = [];
      for (const s of cat.stars) cs.push(s.pos[0], s.pos[1], s.pos[2], s.color[0], s.color[1], s.color[2], s.absMag);
      this.catStars = glc.instanced(f32(cs), L);
      // туманности
      // типовые объёмные модели для туманностей OpenNGC
      const nebCfg = (o) => {
        if (NEB[o.id]) return NEB[o.id];
        if (!o.ext || o.lite) return null;
        // тусклые протяжённые туманности с оценочным расстоянием не рисуем объёмом (были бы «розовые шары»)
        if (!o.messier && (o.mag === null || o.mag === undefined || o.mag > 8)) return null;
        if (o.vis === 'planetary') return { kind: 1, col1: [0.35, 0.7, 1.0], col2: [0.4, 1.0, 0.55], col3: [1.0, 0.33, 0.25], bright: 0.5, tilt: (MW.rng.hashStr(o.id) % 70) };
        if (o.vis === 'snr') return { kind: 2, col1: [0.35, 0.75, 1.0], col2: [1.0, 0.35, 0.3], col3: [0, 0, 0], bright: 0.8, par: [0, 1, 0, 0] };
        if (o.vis === 'nebula') return /Отражательная/.test(o.type) ? { kind: 3, col1: [0.42, 0.58, 1.0], col2: [0, 0, 0], col3: [0, 0, 0], bright: 0.5 }
          : { kind: 4, col1: [1.0, 0.3, 0.38], col2: [0.95, 0.5, 0.55], col3: [0.55, 0.85, 1.0], bright: 0.6 };
        return null;
      };
      this.nebulae = cat.dsos.filter((o) => nebCfg(o)).map((o) => {
        const p = nebCfg(o);
        let z = v3.norm(o.pos);
        const fr = MW.solar.bodyFrame(z);
        let y = fr.y;
        if (p.tilt) { const t = p.tilt * MW.C.DEG; z = v3.rotAxis(z, fr.x, t); y = v3.rotAxis(fr.y, fr.x, t); }
        const R = MW.m3.fromCols(fr.x, y, z);
        const rot = MW.m3.toGL(MW.m3.transpose(R));
        return Object.assign({ obj: o, rot, seed: (MW.rng.hashStr(o.id) % 1000) / 1000, rb: 1.0, par: [0, 0, 0, 0] }, p);
      });
      this.buildDeepSky();
      // крупномасштабная структура Вселенной (синтетическая) и квазары
      const web = MW.cosmos.buildCosmicWeb(900000);
      this.webBuf = glc.instanced(web.web, L);
      this.qsoBuf = glc.instanced(web.qso, L);
      this.webInfo = web;
      // текстура Земли
      const cv = MW.earthMap.rasterize(Math.min(4096, glc.maxTex), Math.min(2048, glc.maxTex / 2));
      this.earthTex = glc.textureFromCanvas(cv);
      this.earthTexW = cv.width;
      // панорама неба ESO/NASA (галактические координаты) — грузится асинхронно из data:-URL (работает и с file://)
      this.panoTex = null;
      if (MW.skyPanorama) {
        const img = new Image();
        img.onload = () => {
          const gl = this.gl, t = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          const an = gl.getExtension('EXT_texture_filter_anisotropic');
          if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, 16);
          this.panoTex = t;
        };
        img.src = MW.skyPanorama.url;
      }
      this.buildTime = performance.now() - t0;
      this.particleCount = this.mwLum.count + this.mwDust.count + this.mwHalo.count + this.mwGas.count + this.extGal.reduce((s, g) => s + g.lum.count, 0) + this.clusters.reduce((s, c) => s + c.stars.count, 0)
        + this.webBuf.count + this.qsoBuf.count;
    }

    /* Глубокий космос: все объекты каталогов без детальной модели — одним инстансным буфером.
       Класс объекта выбирает модель во фрагментном шейдере (см. js/shaders/deepsky.js). */
    buildDeepSky() {
      const cat = MW.catalog;
      const dedicated = new Set([...this.extGal.map((g) => g.obj), ...this.clusters.map((c) => c.obj), ...this.nebulae.map((n) => n.obj)]);
      const COL = { 0: [0.9, 0.92, 1.0], 1: [1.0, 0.86, 0.68], 2: [0.72, 0.84, 1.0], 3: [0.45, 1.0, 0.9], 4: [1.0, 0.6, 0.5], 5: [1.0, 0.45, 0.55], 6: [0.55, 0.7, 1.0],
        7: [0.85, 0.9, 1.0], 8: [1.0, 0.9, 0.72], 11: [0.8, 0.86, 1.0], 12: [1.0, 0.9, 0.75], 13: [0.7, 0.85, 1.0], 14: [0.95, 0.9, 0.85] };
      const ABS = { 0: -19.5, 1: -19.5, 2: -17, 3: -1, 4: -3, 5: -5, 6: -3, 7: -5, 8: -8, 9: 5, 10: 5, 11: -26, 12: -24, 13: -6, 14: -20 };
      const clsOf = (o) => {
        switch (o.vis) {
          case 'galaxy': return /Пара|Триплет|Группа/.test(o.type) ? 14 : o.gal === 'spiral' ? 0 : o.gal === 'irr' ? 2 : 1;
          case 'planetary': return 3;
          case 'snr': return 4;
          case 'nebula': return /Отражательная/.test(o.type) ? 6 : 5;
          case 'cluster': return 7;
          case 'globular': return 8;
          case 'pulsar': return o.psrClass === 'magnetar' ? 10 : 9;
          case 'quasar': return 11;
          case 'galcluster': return 12;
          case 'xray': return 13;
          default: return -1;
        }
      };
      const out = [];
      this.dsoList = [];
      for (const o of cat.dsos) {
        if (!o.ext || dedicated.has(o)) continue;
        const cls = clsOf(o);
        if (cls < 0) continue;
        const h = MW.rng.mulberry32(MW.rng.hashStr(o.id));
        const nrm = o.normal || v3.norm([h.gauss(), h.gauss(), h.gauss()]);
        const absM = o.mag !== null && o.mag !== undefined && o.dist ? o.mag - 5 * Math.log10(o.dist / 32.6156) : ABS[cls];
        o.dsoCls = cls; o.dsoAbs = absM;
        let col = COL[cls] || [1, 1, 1];
        if (cls === 9 || cls === 10) col = [0, Math.min(1 / o.period, 2.5), 0];    // видимая частота вращения пучков
        const p = o.pos, hi = [Math.fround(p[0]), Math.fround(p[1]), Math.fround(p[2])];
        // остатки сверхновых: тип модели в сиде (0 молодой, 1 старый, 2 плерион)
        const snrTyp = cls !== 4 ? 0 : /^(m1|crab)/.test(o.id) || /Краб/.test(o.name) ? 2
          : /kepler|tycho|casa|cas_a|sn1987|sn1006|g1\.9/i.test(o.id) || /Кеплер|Тихо|Кассиопея|1987|1006/.test(o.name) ? 0 : 1;
        out.push(hi[0], hi[1], hi[2], p[0] - hi[0], p[1] - hi[1], p[2] - hi[2], nrm[0], nrm[1], nrm[2], col[0], col[1], col[2],
          Math.max(o.radius, 1e-4), cls, snrTyp * 10 + h(), absM);
        this.dsoList.push(o);
      }
      this.dsoBuf = this.glc.instanced(f32(out), [[1, 3], [2, 3], [3, 3], [4, 3], [5, 4]]);
    }
    // виден ли лёгкий объект каталога с текущей точки (для выбора кликом и подписей)
    dsoVisible(o, d) {
      if (o.dsoAbs === undefined) return true;
      if (this.pxRadius(o.radius, d) > 4) return true;
      return o.dsoAbs + 5 * Math.log10(Math.max(d, 1e-12) / 32.6156) < this.dsoMagLim - 1.5;
    }

    resize() {
      const gl = this.gl, cv = this.glc.canvas;
      const dpr = MW.dpr() * this.s.renderScale;
      const w = Math.max(64, Math.round(cv.clientWidth * dpr)), h = Math.max(64, Math.round(cv.clientHeight * dpr));
      if (w === this.width && h === this.height && this.tA) return;
      this.width = w; this.height = h;
      cv.width = w; cv.height = h;
      for (const t of [this.tA, this.tB, ...(this.mips || [])]) this.glc.deleteTarget(t);
      this.glc.deleteTarget(this.tHalf);
      this.tA = this.glc.target(w, h); this.tB = this.glc.target(w, h);
      this.tHalf = this.glc.target(Math.max(2, w >> 1), Math.max(2, h >> 1));
      this.mips = [];
      let mw = w, mh = h;
      for (let i = 0; i < 7; i++) { mw = Math.max(2, mw >> 1); mh = Math.max(2, mh >> 1); this.mips.push(this.glc.target(mw, mh)); }
      gl.viewport(0, 0, w, h);
    }

    setupFrame(cam) {
      const aspect = this.width / this.height;
      this.view = MW.m4.viewFromQuat(cam.q);
      this.proj = MW.m4.perspective(cam.fov, aspect, 1e-9);
      const r = cam.right, u = cam.up, f = cam.forward;
      this.camRot = f32([r[0], r[1], r[2], u[0], u[1], u[2], -f[0], -f[1], -f[2]]);
      this.tanHalf = Math.tan(cam.fov / 2);
      this.aspect = aspect;
      this.pxPerRad = (this.height / 2) / this.tanHalf;
      this.cam = cam;
      this.fwd = f;
    }
    common(p) {
      p.use();
      p.set('u_view', this.view); p.set('u_proj', this.proj); p.set('u_camRot', this.camRot);
      p.set('u_res', [this.width, this.height]); p.set('u_tanHalf', this.tanHalf); p.set('u_aspect', this.aspect);
      p.set('u_pxPerRad', this.pxPerRad); p.set('u_time', this.scene.realTime);
      return p;
    }
    relF(p) { const c = this.cam.pos; return f32([p[0] - c[0], p[1] - c[1], p[2] - c[2]]); }
    // видимость сферы (rel, радиус) в конусе обзора
    inView(rel, D, R) {
      if (D <= R) return true;
      const ang = Math.acos(MW.util.clamp(v3.dot(rel, this.fwd) / D, -1, 1));
      const half = Math.atan(this.tanHalf * Math.hypot(1, this.aspect));
      return ang < half + Math.asin(Math.min(1, R / D)) + 0.02;
    }
    // экранная проекция (CSS-пиксели) для подписей
    project(p) {
      const rel = v3.sub(p, this.cam.pos);
      const d = v3.len(rel);
      const r = this.cam.right, u = this.cam.up, f = this.fwd;
      const z = v3.dot(rel, f);
      if (z <= d * 1e-6) return null;
      const x = v3.dot(rel, r) / z / (this.tanHalf * this.aspect), y = v3.dot(rel, u) / z / this.tanHalf;
      const cv = this.glc.canvas;
      return { x: (x * 0.5 + 0.5) * cv.clientWidth, y: (0.5 - y * 0.5) * cv.clientHeight, d, onScreen: Math.abs(x) <= 1.05 && Math.abs(y) <= 1.05 };
    }
    pxRadius(R, D) { return Math.atan(R / Math.max(D, 1e-30)) * this.pxPerRad / (this.s.renderScale * MW.dpr()) ; }

    drawInst(buf) { const gl = this.gl; gl.bindVertexArray(buf.vao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, buf.count); }
    drawParticles(buf, origin, model, bright, nearFade, absorb, gas, fog) {
      if (!buf || !buf.count) return;
      const p = this.common(absorb ? this.pDust : gas ? this.pGas : this.pPart);
      p.set('u_art', !absorb && this.s.artistic ? 1 : 0);
      p.set('u_dustMask', absorb && buf === this.mwDust ? 1 : 0);
      p.set('u_bigFade', absorb || gas ? 1 : 0);
      const dpr = MW.dpr() * this.s.renderScale;
      p.set('u_model', model || f32([1, 0, 0, 0, 1, 0, 0, 0, 1]));
      p.set('u_origin', this.relF(origin));
      // ограничение экранного размера: светящиеся частицы не расплываются в «мыльные» пятна
      p.set('u_fog', fog || [0, 0]);
      p.set('u_bright', bright); p.set('u_minPx', 1.25 * dpr); p.set('u_maxPx', (absorb ? 80 : gas ? 140 : 36) * dpr); p.set('u_nearFade', nearFade);
      if (absorb) this.glc.blendAbsorb(); else this.glc.blendAdd();
      this.drawInst(buf);
    }
    drawStars(buf, origin, opts = {}) {
      if (!buf || !buf.count) return;
      const p = this.common(this.pStar);
      p.set('u_origin', this.relF(origin));
      p.set('u_magLimit', this.s.magLimit + (opts.magBoost || 0));
      p.set('u_scale', MW.dpr() * this.s.renderScale * (opts.scale || 1));
      p.set('u_fadeR', opts.fadeR || 0); p.set('u_bright', opts.bright || 1); p.set('u_innerR', 0);
      p.set('u_hide', opts.hide === undefined ? -1 : opts.hide);
      this.glc.blendAdd();
      this.drawInst(buf);
    }
    uploadLines(arr) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
    }

    buildLines() {
      const cam = this.cam.pos, out = [];
      const seg = (a, b, c) => out.push(a[0] - cam[0], a[1] - cam[1], a[2] - cam[2], c[0], c[1], c[2], c[3], b[0] - cam[0], b[1] - cam[1], b[2] - cam[2], c[0], c[1], c[2], c[3]);
      const sunD = v3.len(cam);
      if (this.s.constellations) {
        const a = 0.42 * (1 - MW.util.smoothstep(600, 5000, sunD));
        if (a > 0.005) for (const c of MW.catalog.constellations) {
          const col = c.asterism ? [0.9, 0.75, 0.35, a * 0.7] : [0.35, 0.6, 1.0, a];
          for (const [s1, s2] of c.segs) seg(s1.pos, s2.pos, col);
        }
      }
      if (this.s.orbits) {
        // рядом с крупным телом прочие орбиты приглушаются
        const anc = this.cam.anchor;
        const near = anc ? 1 - 0.75 * MW.util.smoothstep(40, 200, this.pxRadius(anc.radius, v3.dist(cam, anc.pos))) : 1;
        for (const sys of this.scene.systems) for (const b of sys.bodies) {
          const center = b.parentBody ? b.parentBody.pos : sys.star.pos;
          const rOrb = v3.dist(b.pos, center);
          const dCam = v3.dist(cam, center);
          let a = 0.5 * near * (1 - MW.util.smoothstep(rOrb * 60, rOrb * 400, dCam));
          if (b.kind === 'moon') a *= 0.55 * (1 - MW.util.smoothstep(rOrb * 15, rOrb * 60, dCam));
          if (a < 0.01) continue;
          const period = b.periodD || 365.25 * Math.pow(b.aAU || 1, 1.5);
          const N = b.kind === 'moon' ? 96 : 256;
          const col = b.kind === 'moon' ? [0.6, 0.6, 0.65, a] : [0.35, 0.55, 0.95, a];
          if (b === (this.selected && this.selected.obj)) { col[0] = 1.0; col[1] = 0.8; col[2] = 0.3; col[3] = Math.min(1, a * 1.8); }
          let prev = null;
          const off = b.parentBody ? b.parentBody.pos : sys.star.pos;
          for (let i = 0; i <= N; i++) {
            const o = b.orbitFn(this.scene.jd + (period * i) / N);
            const p = [off[0] + o[0], off[1] + o[1], off[2] + o[2]];
            if (prev) seg(prev, p, col);
            prev = p;
          }
        }
      }
      // пройденные траектории «Вояджеров»: Земля → Юпитер → Сатурн (→ Уран → Нептун) → межзвёздное пространство
      if (this.s.orbits) {
        const a = 0.75 * (1 - MW.util.smoothstep(3000 * AU, 30000 * AU, sunD));
        if (a > 0.01) for (const pr of this.scene.probes) {
          const pts = MW.probes.path(pr, this.scene.jd, 400);
          const sel = pr === (this.selected && this.selected.obj);
          const col = [pr.color[0], pr.color[1], pr.color[2], a * (sel ? 1 : 0.7)];
          for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i], col);
        }
      }
      if (this.s.grid) {
        const a = 0.22 * MW.util.smoothstep(1500, 15000, sunD);
        if (a > 0.005) {
          const gc = MW.C.GC_POS;
          for (let r = 10000; r <= 60000; r += 10000) {
            let prev = null;
            for (let i = 0; i <= 128; i++) {
              const t = (i / 128) * Math.PI * 2;
              const p = [gc[0] + r * Math.cos(t), gc[1] + r * Math.sin(t), gc[2]];
              if (prev) seg(prev, p, [0.3, 0.55, 0.9, a]);
              prev = p;
            }
          }
          for (let k = 0; k < 12; k++) {
            const t = (k / 12) * Math.PI * 2;
            seg(gc, [gc[0] + 60000 * Math.cos(t), gc[1] + 60000 * Math.sin(t), gc[2]], [0.3, 0.55, 0.9, a * 0.6]);
          }
          let prev = null;
          for (let i = 0; i <= 128; i++) {
            const t = (i / 128) * Math.PI * 2;
            const p = [gc[0] + 26000 * Math.cos(t), gc[1] + 26000 * Math.sin(t), gc[2]];
            if (prev) seg(prev, p, [1.0, 0.8, 0.3, a * 0.8]);
            prev = p;
          }
        }
      }
      return f32(out);
    }

    // точки-маркеры планет и Солнца (когда диск меньше пикселя)
    buildNearSprites() {
      const cam = this.cam.pos, out = [];
      const add = (pos, col, m) => { out.push(pos[0] - cam[0], pos[1] - cam[1], pos[2] - cam[2], col[0], col[1], col[2], m); };
      // маркеры планет: звёздная величина относительно точки отсчёта яркости спрайтов (6,5ᵐ)
      const absFor = (d, v) => 6.5 - v - 5 * Math.log10(Math.max(d, 1e-20) / 32.6156);
      for (const sys of this.scene.systems) {
        const st = sys.star;
        const D = v3.dist(cam, st.pos);
        {
          const pr = this.pxRadius(st.radius || (st.radiusSun || 1) * MW.C.RSUN_LY, D);
          if (pr < 3 && st.absMag !== undefined) add(st.pos, st.color || [1, 1, 1], st.absMag);
        }
        for (const b of sys.bodies) {
          const d = v3.dist(cam, b.pos);
          const pr = this.pxRadius(b.radius, d);
          if (pr > 2.5) continue;
          const dSys = v3.dist(cam, st.pos);
          let v = (b.kind === 'moon' ? 2.6 : 4.0) * (1 - MW.util.smoothstep(800 * AU, 6000 * AU, dSys));
          if (b.kind === 'moon') v *= 1 - MW.util.smoothstep(b.parentBody.radius * 300, b.parentBody.radius * 3000, d);
          if (v < 0.3) continue;
          const td = TYPE_DEFAULTS[b.type] || {};
          add(b.pos, td.dot || b.col1 || [0.8, 0.8, 0.8], absFor(d, v));
        }
      }
      // маркеры «Вояджеров», пока модель меньше пары пикселей
      for (const pr of this.scene.probes) {
        const d = v3.dist(cam, pr.pos);
        if (this.pxRadius(pr.radius, d) > 2) continue;
        const v = 3.2 * (1 - MW.util.smoothstep(2000 * AU, 20000 * AU, v3.len(cam)));
        if (v > 0.3) add(pr.pos, pr.color, absFor(d, v));
      }
      // компаньоны двойных звёзд (движутся по орбитам — рисуются динамически)
      for (const c of MW.catalog.binaries) {
        const d = v3.dist(cam, c.pos);
        if (this.pxRadius(c.radius, d) < 3) add(c.pos, c.color, c.absMag);
      }
      // свечение центра Галактики (Стрелец A* + ядерное скопление)
      const dBH = v3.dist(cam, this.scene.bh.pos);
      if (dBH > 0.05) add(this.scene.bh.pos, [1.0, 0.8, 0.55], -8.5 + 6 * (1 - MW.util.smoothstep(0.05, 2, dBH)));
      const arr = f32(out);
      this.glc.updateBuffer(this.nearBuf.buf, arr);
      this.nearBuf.count = out.length / 7;
    }

    drawStarBody(st, D, rel) {
      const vis = st._vis || (st._vis = MW.procsystem.starVisual(st));
      const R = st.radius || (st.radiusSun || 1) * MW.C.RSUN_LY;
      const Rb = R * 4.2;
      const p = this.common(this.pStarBody);
      p.set('u_c', f32([rel[0] / D, rel[1] / D, rel[2] / D])); p.set('u_r', R / D); p.set('u_rb', Rb / D); p.set('u_full', D < Rb * 1.05 ? 1 : 0);
      const ang = this.scene.realTime * vis.spin + vis.seed * 6.283;
      // ось вращения своя у каждой звезды (по сиду), у Солнца — к полюсу эклиптики
      const fr = st._frame || (st._frame = MW.solar.bodyFrame(st.isSun ? MW.coords.ECL_POLE : v3.norm([Math.sin(vis.seed * 91) , Math.cos(vis.seed * 57), 0.6 + Math.sin(vis.seed * 23)])));
      const c = Math.cos(ang), s = Math.sin(ang);
      const x = v3.add(v3.scale(fr.x, c), v3.scale(fr.y, s)), y = v3.add(v3.scale(fr.x, -s), v3.scale(fr.y, c));
      p.set('u_bodyRot', f32([x[0], y[0], fr.z[0], x[1], y[1], fr.z[1], x[2], y[2], fr.z[2]]));
      p.set('u_temp', st.temp || 5800); p.set('u_seed', vis.seed); p.set('u_bright', vis.bright);
      p.set('u_gran', vis.gran); p.set('u_activity', vis.activity); p.set('u_corona', vis.corona);
      p.set('u_kind', vis.kind); p.set('u_flat', vis.flat);
      p.set('u_rnd', f32(vis.rnd || [vis.seed, 0.5, 0.5, 0.5]));
      this.glc.blendPremul();
      this.gl.bindVertexArray(this.quadVAO || (this.quadVAO = this.glc.vao([], true)));
      this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    }

    /* Реальные карты поверхностей (js/data/tex/<id>.js с data:-URL): грузятся по требованию при подлёте —
       скрипт → Image → текстура с мип-уровнями. Цветные карты — в sRGB (в шейдере уже линейный цвет),
       служебные (маски, нормали) — линейные. Пока карта грузится, тело рисуется процедурно. */
    texGet(id, want) {
      if (!id) return null;
      const cache = this.texCache || (this.texCache = {});
      let e = cache[id];
      if (!e) {
        if (!want) return null;
        e = cache[id] = { state: 'loading', tex: null, ready: 0, w: 1, meta: null };
        const s = document.createElement('script');
        s.src = 'js/data/tex/' + id + '.js';
        s.onload = () => {
          const d = MW.texData && MW.texData[id];
          if (!d || !d.url) { e.state = 'failed'; return; }
          e.meta = d;
          const img = new Image();
          img.onload = () => {
            const gl = this.gl, t = gl.createTexture();
            const lin = /_(aux|nrm|mask)$/.test(id);
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texImage2D(gl.TEXTURE_2D, 0, lin ? gl.RGBA8 : gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, img.height === 1 ? gl.CLAMP_TO_EDGE : gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            e.tex = t; e.w = img.width; e.state = 'ready'; e.ready = performance.now();
            d.url = null;   // строка base64 больше не нужна — освобождаем память
          };
          img.onerror = () => { e.state = 'failed'; };
          img.src = d.url;
        };
        s.onerror = () => { e.state = 'failed'; };
        document.head.appendChild(s);
      }
      return e.state === 'ready' ? e : null;
    }
    // плавное появление карты поверх процедурной поверхности (без «щелчка»)
    texFade(e) { return e ? MW.util.smoothstep(0, 600, performance.now() - e.ready) : 0; }

    drawPlanet(b, D, rel) {
      const st = b.system.star;
      const td = TYPE_DEFAULTS[b.type] || {};
      const atmo = b.atmo || [0, 0, 0, 0];
      const ring = b.ring || [0, 0, 0, 0];
      const R = b.radius;
      const exo = b.exo || [0, 0, 0, 0];
      const Rb = R * Math.max(1.02 + atmo[3] * 1.05, ring[3] > 0 ? ring[1] * 1.02 : 0, exo[2] > 0 ? exo[2] * 3 + 2 : 0);
      const pr = this.pxRadius(R, D) * MW.dpr() * this.s.renderScale;
      const p = this.common(this.pPlanetFam[PLANET_FAM[b.type] ?? 3]);
      p.set('u_c', f32([rel[0] / D, rel[1] / D, rel[2] / D])); p.set('u_r', R / D); p.set('u_rb', Rb / D); p.set('u_full', D < Rb * 1.05 ? 1 : 0);
      const fr = b.frame, c = Math.cos(b.spin), s = Math.sin(b.spin);
      const x = v3.add(v3.scale(fr.x, c), v3.scale(fr.y, s)), y = v3.add(v3.scale(fr.x, -s), v3.scale(fr.y, c)), z = fr.z;
      p.set('u_bodyRot', f32([x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]]));
      p.set('u_pole', f32(z));
      const toStar = v3.sub(st.pos, b.pos), dS = v3.len(toStar);
      p.set('u_sunDir', f32(v3.scale(toStar, 1 / dS)));
      const flux = (st.lum || 1) / Math.pow(dS / AU, 2);
      // «адаптация глаза» и для Солнечной системы: дальние планеты (Уран, Нептун, Плутон) не тонут во мраке
      let inten = MW.util.clamp(1.2 * Math.pow(flux, 0.06), 0.8, 1.35);
      let sc = st.color || [1, 1, 1];
      if (b.exoReal) {
        // «адаптация глаза»: у тусклых красных карликов планеты не тонут в мутно-рыжем полумраке
        // потолок ниже порога bloom: освещённая сторона не пересвечивается в белое пятно
        inten = MW.util.clamp(1.1 * Math.pow(flux, 0.08), 0.9, 1.25);
        const m = Math.max(sc[0], sc[1], sc[2], 1e-6);
        sc = sc.map((c) => 0.6 * c / m + 0.4);
      }
      p.set('u_sunCol', f32(v3.scale(sc, inten)));
      p.set('u_exo', f32(exo)); p.set('u_rim', f32(b.rim || [0.5, 0.75, 1.0]));
      p.set('u_type', b.type); p.set('u_seed', b.seed || 0.5);
      const foot0 = Math.max(D - R, R * 1e-6) / (this.pxPerRad * R);
      p.set('u_oct', Math.round(MW.util.clamp(Math.max(Math.log2(Math.max(pr, 1) / 3) + 2, Math.log2(1 / foot0 / 3)), 3, 12)));
      p.set('u_bumpK', b.bump || td.bump || 0);
      // размер пикселя на поверхности (в долях радиуса): у самой поверхности угловой размер планеты
      // почти не растёт, а детализация должна — поэтому микрорельеф и шаг бампа считаются по нему
      const foot = Math.max(D - R, R * 1e-6) / (this.pxPerRad * R);
      p.set('u_bumpEps', MW.util.clamp(Math.min(0.5 / Math.max(pr, 1), foot), 2e-5, 0.01));
      p.set('u_foot', foot);
      p.set('u_micro', this.s.micro === false ? 0 : 1 - MW.util.smoothstep(1.5e-4, 1.2e-3, foot));
      p.set('u_ambient', b.type === 2 ? 0.0015 : b.exoReal ? 0.004 : 0.003);
      p.set('u_cloudRot', (this.scene.jd % 1000) * 0.35 + this.scene.realTime * 0.002);
      p.set('u_earthLod', Math.max(0, Math.log2((this.earthTexW / (2 * Math.PI)) / Math.max(pr, 1))));
      p.set('u_col1', f32(b.col1 || td.col1 || [0.5, 0.5, 0.5])); p.set('u_col2', f32(b.col2 || td.col2 || [0.6, 0.6, 0.6])); p.set('u_col3', f32(b.col3 || [0.4, 0.4, 0.4]));
      const par = b.par || [0, 0, 0, 0];
      p.set('u_par', f32([par[0], par[1], b.clouds !== undefined ? b.clouds : par[2], b.turb || par[3] || 0]));
      p.set('u_par2', f32([b.feature || 0, b.bands || 12, b.par2z || 0, 0]));
      p.set('u_rnd', f32(b.rnd || (b.rnd = MW.procsystem.objRnd(b))));
      p.set('u_atmo', f32(atmo)); p.set('u_atmoDens', b.atmoDens || 0);
      p.set('u_ring', f32(ring)); p.set('u_ringCol', f32(b.ringCol || [0.7, 0.65, 0.55]));
      p.tex('u_earth', this.earthTex);
      // реальные карты: цвет, служебная (облака/океаны/огни Земли, поверхность Венеры), нормали, профиль колец
      const want = pr > 3;
      const tC = this.texGet(b.tex, want), tA = this.texGet(b.texAux, want), tN = this.texGet(b.texNrm, want), tR = this.texGet(b.ringTex, want);
      const dummy = this.dummyTex || (this.dummyTex = this.glc.texture2D(1, 1, { internal: this.gl.RGBA8, type: this.gl.UNSIGNED_BYTE, data: new Uint8Array([128, 128, 255, 255]) }));
      const kC = this.texFade(tC);
      // уровень мип-карты: тексель ≈ пиксель на поверхности (в шейдере ещё поправка на наклон у лимба)
      const lodOf = (e) => (e ? Math.max(0, Math.log2(Math.max(foot, 0.5 / Math.max(pr, 1)) * e.w / (2 * Math.PI)) - 0.35) : 0);
      p.tex('u_tex', tC ? tC.tex : dummy); p.tex('u_aux', tA ? tA.tex : dummy); p.tex('u_nrm', tN ? tN.tex : dummy); p.tex('u_ringTex', tR ? tR.tex : dummy);
      p.set('u_texP', f32([kC, lodOf(tC), b.texH || 0, this.texFade(tA)]));
      const rm = tR && tR.meta ? tR.meta : { r0: 1, r1: 2 };
      p.set('u_texQ', f32([Math.max(D - R, 0) / R, this.texFade(tR), rm.r0, rm.r1]));
      p.set('u_nrmK', this.texFade(tN));
      // детальная карта: насколько тексель крупнее пикселя (при подлёте в упор) и частота дорисовываемого шума
      const rawLod = tC ? Math.log2(Math.max(foot, 0.5 / Math.max(pr, 1)) * tC.w / (2 * Math.PI)) : 0;
      p.set('u_detail', f32(tC ? [MW.util.clamp(-rawLod / 3, 0, 1) * kC, tC.w / (2 * Math.PI) * 2.5] : [0, 0]));
      // палитра снятой стороны мозаики — для достройки неотснятых районов
      const fill = tC && tC.meta && tC.meta.fill;
      if (fill) {
        const lin = (c) => f32(c.map((x) => Math.pow(x, 2.2)));
        p.set('u_col1', lin(fill[0])); p.set('u_col2', lin(fill[1]));
      }
      // дымка атмосферы над диском: у плотных атмосфер (Венера, Титан) — вся, у Земли — лёгкая, у остальных — только на лимбе
      p.set('u_hazeFloor', b.hazeFloor !== undefined ? b.hazeFloor : b.type === 1 || b.type === 11 ? 1.0 : b.type === 2 ? 0.3 : b.type === 3 ? 0.25 : 0.06);
      this.glc.blendPremul();
      this.gl.bindVertexArray(this.quadVAO || (this.quadVAO = this.glc.vao([], true)));
      this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    }

    // «Вояджер»: SDF-модель в импосторе (освещение — от Солнца, ослабленное «адаптацией глаза»)
    drawProbe(pr, D, rel) {
      const p = this.common(this.pProbe);
      const Rb = pr.radius;
      p.set('u_c', f32([rel[0] / D, rel[1] / D, rel[2] / D])); p.set('u_r', Rb / D); p.set('u_rb', Rb / D); p.set('u_full', D < Rb * 1.05 ? 1 : 0);
      p.set('u_rbM', pr.radiusM);
      const fr = pr.frame;
      p.set('u_bodyRot', f32([fr.x[0], fr.y[0], fr.z[0], fr.x[1], fr.y[1], fr.z[1], fr.x[2], fr.y[2], fr.z[2]]));
      p.set('u_sunDir', f32(v3.scale(pr.pos, -1 / v3.len(pr.pos))));
      p.set('u_sunCol', f32([1.25, 1.2, 1.12]));
      p.set('u_variant', pr.id === 'voyager2' ? 1 : 0);
      this.glc.blendPremul();
      this.gl.bindVertexArray(this.quadVAO || (this.quadVAO = this.glc.vao([], true)));
      this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    }

    drawDeepSky(cam, panoK) {
      if (!this.dsoBuf || !this.dsoBuf.count) return;
      const p = this.common(this.pDSO);
      const c = cam.pos, hi = [Math.fround(c[0]), Math.fround(c[1]), Math.fround(c[2])];
      p.set('u_camHi', f32(hi)); p.set('u_camLo', f32([c[0] - hi[0], c[1] - hi[1], c[2] - hi[2]]));
      // «длинная экспозиция» для глубокого космоса; пока видна фотопанорама неба — скромнее, чтобы не засорять её
      this.dsoMagLim = this.s.magLimit + 5 - 3 * panoK;   // предел звёзд по умолчанию 8,5ᵐ → объекты DSO как раньше
      p.set('u_magLim', this.dsoMagLim);
      p.set('u_scale', MW.dpr() * this.s.renderScale); p.set('u_bright', 1.0);
      p.set('u_bgShrink', this.focusK || 0);
      this.glc.blendAdd();
      this.drawInst(this.dsoBuf);
    }
    drawCosmos(cam, sunD, panoK) {
      const U = MW.util;
      // Паутина плавно проявляется при удалении от Местного сверхскопления (20 млн → 500 млн св. лет).
      // Её внутренний край размыт и перекрывается с реальными галактиками OpenNGC, палитра у них общая —
      // переход от каталога к процедурной структуре без скачка. Сферы реликтового излучения нет: за горизонтом
      // (46,5 млрд св. лет) — чёрный космос; дальние объекты гаснут туманом по расстоянию от камеры.
      const webK = U.smoothstep(2e7, 5e8, sunD);
      if (webK > 0.01) {
        // яркость растёт с расстоянием: издали видна вся сеть, а не отдельные точки
        const gain = webK * (0.55 + 1.2 * U.smoothstep(1e9, 8e9, sunD) + 2.2 * U.smoothstep(8e9, 3.5e10, sunD));
        const fog = [1.8e10, 8e10];
        this.drawParticles(this.webBuf, [0, 0, 0], null, 0.9 * gain, 2.0, false, false, fog);
        this.drawParticles(this.qsoBuf, [0, 0, 0], null, 1.6 * gain, 2.0, false, false, fog);
      }
    }

    drawNebula(n) {
      const o = n.obj;
      const rel = v3.sub(o.pos, this.cam.pos), D = v3.len(rel);
      // при фокусе на близкой планете большая фоновая туманность (напр. Розетка) рисуется в меньшем угловом
      // размере — иначе она нависает над планетой огромным пятном
      const ang0 = (o.radius * n.rb) / Math.max(v3.dist(o.pos, this.cam.pos), 1e-30);
      const shrink = 1 - 0.6 * (this.focusK || 0) * MW.util.smoothstep(0.03, 0.15, ang0);
      const Rb = o.radius * n.rb * shrink;
      if (!this.inView(rel, D, Rb)) return;
      if (this.pxRadius(Rb, D) < 0.7) return;
      const p = this.common(this.pNebula);
      p.set('u_c', f32([rel[0] / D, rel[1] / D, rel[2] / D])); p.set('u_rb', Rb / D); p.set('u_full', D < Rb * 1.05 ? 1 : 0);
      p.set('u_rot', n.rot); p.set('u_kind', n.kind); p.set('u_seed', n.seed); p.set('u_bright', n.bright);
      p.set('u_col1', f32(n.col1)); p.set('u_col2', f32(n.col2)); p.set('u_col3', f32(n.col3));
      p.set('u_par', f32(n.par));
      // крупная на экране туманность считается в половинном разрешении (в 4 раза меньше пикселей)
      const prPx = this.pxRadius(Rb, D) * MW.dpr() * this.s.renderScale;
      const half = D < Rb * 1.05 || prPx > this.height * 0.18;
      const gl = this.gl;
      p.set('u_steps', half ? 40 : 34);
      if (half) {
        this.glc.bindTarget(this.tHalf);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.clearColor(0, 0, 0, 1);
        p.set('u_res', [this.tHalf.w, this.tHalf.h]);
      }
      this.glc.blendPremul();
      gl.bindVertexArray(this.quadVAO || (this.quadVAO = this.glc.vao([], true)));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (half) {
        this.glc.bindTarget(this.curTarget);
        const b = this.pBlit.use();
        b.tex('u_src', this.tHalf.tex);
        this.glc.blendPremul();
        this.glc.fullscreen();
      }
      this.stats.nebHalf = (this.stats.nebHalf || 0) + (half ? 1 : 0);
    }

    render(cam, selected) {
      const gl = this.gl, sc = this.scene;
      this.selected = selected;
      this.resize();
      this.setupFrame(cam);
      const sunD = v3.len(cam.pos);
      let target = this.tA;
      this.curTarget = target;
      this.glc.bindTarget(target);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);

      // 1. небесная сфера
      this.glc.noBlend();
      const sky = this.common(this.pSky);
      sky.set('u_skyFade', 1 - MW.util.smoothstep(400, 5000, sunD));
      sky.set('u_grid', this.s.grid && sunD < 3000 ? 1 : 0);
      sky.set('u_pixAng', (2 * this.tanHalf) / this.height);
      sky.set('u_starField', 1); sky.set('u_art', this.s.artistic ? 1 : 0);
      // плавный cross-fade панорамы: снята с Земли, поэтому растворяется на 3–5 тыс. св. лет от Солнца
      const panoK = this.panoTex && this.s.panorama ? 1 - MW.util.smoothstep(3000, 5000, sunD) : 0;
      this.panoK = panoK;
      sky.set('u_panoK', panoK); sky.set('u_panoGain', this.s.panoGain);
      if (this.panoTex) sky.tex('u_pano', this.panoTex);
      sky.set('u_gal2eq', MW.m3.toGL(MW.coords.GAL2EQ));
      sky.set('u_gal2ecl', MW.m3.toGL(MW.m3.transpose(MW.coords.ECL2GAL)));
      this.glc.fullscreen();

      // 2. галактики
      // «адаптация глаза»: внутри плотных областей диска/балджа галактика приглушается
      const gc = MW.C.GC_POS, cp = cam.pos;
      const zr = Math.abs(cp[2] - gc[2]), Rr = Math.hypot(cp[0] - gc[0], cp[1] - gc[1]);
      const rhoC = MW.galaxy.stellarDensity(cp).rho;
      const inside = Math.exp(-zr / 2500) * (1 - MW.util.smoothstep(50000, 70000, Rr));
      // пока видна панорама (реальное небо), 3D-модель Галактики приглушена, чтобы полоса не двоилась
      const gb = this.s.galaxyBright * (1 / (1 + 0.08 * rhoC)) * (1 - 0.7 * inside) * (1 - 0.9 * panoK);
      this.stats.galaxyK = gb;
      const art = this.s.artistic;
      // объёмный газ: в художественном режиме — полноценная светящаяся подложка рукавов
      this.drawParticles(this.mwGas, MW.C.GC_POS, null, 0.065 * gb * (art ? 0.4 : 0.2), 5.0, false, true);
      this.drawParticles(this.mwLum, MW.C.GC_POS, null, 0.065 * gb, 8.0, false);
      // гало и шаровые скопления заметны, когда Галактика видна снаружи (вблизи Солнца они не засоряют небо)
      const outside = MW.util.smoothstep(12000, 45000, Math.hypot(zr * 2.2, Math.max(0, Rr - 30000)));
      if (outside > 0.01) this.drawParticles(this.mwHalo, MW.C.GC_POS, null, 0.065 * this.s.galaxyBright * outside, 6.0, false);
      // пока видна фотопанорама, галактики-соседи уже есть на ней — 3D-копии приглушены
      // Когда далёкая галактика занимает на экране несколько десятков пикселей, десятки тысяч её частиц
      // складываются в пересвеченное пятно, а bloom превращает его в «вату». Яркость приводим к постоянной
      // поверхностной яркости: не больше ~4 частиц на пиксель площади диска.
      for (const g of this.extGal) {
        const Dg = Math.max(v3.dist(cp, g.obj.pos), 1);
        const prG = Math.max(this.pxRadius(g.obj.radius * 1.1, Dg), 1);
        const kDens = MW.util.clamp(4 / (g.lum.count / (Math.PI * prG * prG)), 0.035, 1);
        this.drawParticles(g.lum, g.obj.pos, g.model, 0.05 * this.s.galaxyBright * g.bright * kDens * (1 - 0.9 * panoK), 6.0, false);
      }
      for (const c of this.clusters) if (c.glow) this.drawParticles(c.glow, c.obj.pos, null, 0.08 * this.s.galaxyBright, 3.0, false);
      // снаружи (вид на диск) пылевые прожилки контрастнее: они «прорезают» звёздные поля, как на снимках «Хаббла»
      this.drawParticles(this.mwDust, MW.C.GC_POS, null, 0.4 * (1 - 0.45 * inside) * (1 + 0.6 * outside) * (art ? 1.9 : 1.0) * (1 - 0.85 * panoK), 7.0, true);
      for (const g of this.extGal) if (g.dust) this.drawParticles(g.dust, g.obj.pos, g.model, 0.5, 6.0, true);

      // «фокус» на близком теле (планета, спутник, аппарат крупно в кадре): протяжённый фон уменьшается
      const anc = cam.anchor;
      this.focusK = anc ? MW.util.smoothstep(25, 160, this.pxRadius(anc.radius, v3.dist(cam.pos, anc.pos))) : 0;
      // 3. туманности (от дальних к ближним)
      const nebs = this.nebulae.slice().sort((a, b) => v3.dist(b.obj.pos, cam.pos) - v3.dist(a.obj.pos, cam.pos));
      for (const n of nebs) this.drawNebula(n);

      // 3b. Вселенная: космическая паутина, квазары, сфера реликтового излучения, объекты каталогов по классам
      this.drawCosmos(cam, sunD, panoK);
      this.drawDeepSky(cam, panoK);

      // 4. звёзды
      const act = sc.active;
      const actStar = act ? act.star : null;
      let hideCat = -1;
      const hideLocal = [-1, -1, -1];
      let hideHyg = -1;
      // Звезда активной системы (цель автопилота) не берётся из общих буферов: там позиции абсолютные во float32,
      // и на расстоянии ~1000 св. лет погрешность ~1e-4 св. года — при подлёте её свечение «скакало» по экрану.
      // Вместо этого она рисуется в буфере ближних спрайтов с координатами относительно камеры (double).
      if (actStar) {
        if (actStar.procedural) hideLocal[actStar.level] = actStar.index; else if (actStar.hyg) hideHyg = actStar.hygIdx; else if (actStar.idx !== undefined) hideCat = actStar.idx;
      }
      for (let i = 0; i < sc.local.levels.length; i++) {
        const L = sc.local.levels[i];
        if (L.gpu && L.count) this.drawStars(L.gpu, L.origin, { fadeR: L.cell * L.rCells, hide: hideLocal[i] });
      }
      this.drawStars(this.catStars, [0, 0, 0], { hide: hideCat });
      this.drawStars(this.hygBuf, [0, 0, 0], { hide: hideHyg });
      for (const c of this.clusters) this.drawStars(c.stars, c.obj.pos, {});
      this.buildNearSprites();
      if (this.nearBuf.count) this.drawStars(this.nearBuf, cam.pos, {});

      // 5. линии
      const lines = this.buildLines();
      if (lines.length) {
        this.uploadLines(lines);
        const p = this.common(this.pLine);
        this.glc.blendPremul();
        gl.bindVertexArray(this.lineVAO);
        gl.drawArrays(gl.LINES, 0, lines.length / 7);
      }

      // 6. Чёрная дыра: гравитационная линза + аккреционный диск. Из всех (Стрелец A*, ядра квазаров и
      //    радиогалактик, Лебедь X-1) берётся та, чьё эйнштейновское кольцо на экране больше.
      let bh = sc.bh, best = -1;
      for (const b of sc.blackHoles || [sc.bh]) { const th = Math.sqrt(2 * b.rs / Math.max(v3.dist(b.pos, cam.pos), 1e-30)); if (th > best) { best = th; bh = b; } }
      const relB = v3.sub(bh.pos, cam.pos), DB = v3.len(relB);
      const thetaE = Math.sqrt((2 * bh.rs) / DB);
      if (thetaE * this.pxPerRad > 1.5) {
        this.glc.bindTarget(this.tB);
        this.glc.noBlend();
        const pl = this.pLens.use();
        pl.tex('u_src', this.tA.tex);
        const bv = [v3.dot(relB, cam.right) / DB, v3.dot(relB, cam.up) / DB, -v3.dot(relB, this.fwd) / DB];
        pl.set('u_bhDir', f32(bv)); pl.set('u_thetaE', thetaE); pl.set('u_thetaSh', 2.6 * bh.rs / DB);
        pl.set('u_tanHalf', this.tanHalf); pl.set('u_aspect', this.aspect); pl.set('u_on', 1);
        this.glc.fullscreen();
        const Rb = bh.rs * 45;
        if (this.inView(relB, DB, Rb) && this.pxRadius(Rb, DB) > 1) {
          const p = this.common(this.pBH);
          p.set('u_c', f32(v3.scale(relB, 1 / DB))); p.set('u_rb', Rb / DB); p.set('u_full', DB < Rb * 1.05 ? 1 : 0);
          p.set('u_scale', DB / bh.rs);
          const fr = bh.frame;
          p.set('u_rot', MW.m3.toGL(MW.m3.transpose(MW.m3.fromCols(fr.x, fr.y, fr.z))));
          // ядра квазаров — сверхъяркий диск и джеты у основания; Стрелец A* — спокойный тусклый диск
          p.set('u_rIn', 3.0); p.set('u_rOut', 16.0); p.set('u_bright', bh.host ? (bh.mass > 1e5 ? 0.8 : 0.6) : 0.5); p.set('u_jet', bh.jet ? 1 : 0);
          p.tex('u_scene', this.tA.tex);
          this.glc.noBlend();
          gl.bindVertexArray(this.quadVAO || (this.quadVAO = this.glc.vao([], true)));
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        target = this.tB;
      }

      // 7. тела: звёзды и планеты (от дальних к ближним)
      const draw = [];
      for (const sys of sc.systems) {
        const st = sys.star;
        const rel = v3.sub(st.pos, cam.pos), D = v3.len(rel);
        const R = st.radius;
        if (this.pxRadius(R * 4.2, D) > 1.5 && this.inView(rel, D, R * 4.2)) draw.push({ D, f: () => this.drawStarBody(st, D, rel) });
        for (const b of sys.bodies) {
          const relb = v3.sub(b.pos, cam.pos), Db = v3.len(relb);
          const Rb = b.radius * Math.max(b.ring ? b.ring[1] : 1.1, b.exo && b.exo[2] ? b.exo[2] * 3 + 2 : 0);
          if (this.pxRadius(b.radius, Db) > 0.6 && this.inView(relb, Db, Rb)) draw.push({ D: Db, f: () => this.drawPlanet(b, Db, relb) });
        }
      }
      // реальные компаньоны кратной системы из HYG (общее поле base)
      const comps = sc.active && sc.active.star.companions ? sc.active.star.companions : [];
      for (const c of comps) {
        const rel = v3.sub(c.pos, cam.pos), D = v3.len(rel), R = (c.radiusSun || 1) * MW.C.RSUN_LY;
        if (this.pxRadius(R * 4.2, D) > 1.5 && this.inView(rel, D, R * 4.2)) draw.push({ D, f: () => this.drawStarBody(c, D, rel) });
      }
      for (const c of MW.catalog.binaries) {
        const rel = v3.sub(c.pos, cam.pos), D = v3.len(rel);
        if (this.pxRadius(c.radius * 4.2, D) > 1.5 && this.inView(rel, D, c.radius * 4.2)) draw.push({ D, f: () => this.drawStarBody(c, D, rel) });
      }
      for (const pr of sc.probes) {
        const rel = v3.sub(pr.pos, cam.pos), D = v3.len(rel);
        if (this.pxRadius(pr.radius, D) > 2 && this.inView(rel, D, pr.radius)) draw.push({ D, f: () => this.drawProbe(pr, D, rel) });
      }
      draw.sort((a, b) => b.D - a.D);
      for (const d of draw) d.f();
      this.stats.bodies = draw.length;

      // 8. оптика камеры (лучи и блики ярких звёзд), автоэкспозиция, bloom + композитинг
      this.drawLensEffects(target);
      this.updateExposure(target);
      this.bloomAndComposite(target);
    }

    /* Самые яркие точечные источники в кадре (Солнце, звезда системы, яркие звёзды каталога): экранная позиция,
       видимая яркость (по звёздной величине) и цвет. Источник за диском планеты/спутника не учитывается. */
    lensSources() {
      const cam = this.cam, cv = this.glc.canvas, out = [];
      const k = MW.dpr() * this.s.renderScale;
      const occl = [];
      for (const sys of this.scene.systems) for (const b of sys.bodies) {
        const rel = v3.sub(b.pos, cam.pos), d = v3.len(rel);
        if (this.pxRadius(b.radius, d) > 1.5) occl.push({ rel, d, r2: b.radius * b.radius });
      }
      const hidden = (rel, L) => { for (const o of occl) { if (o.d >= L) continue; const t = v3.dot(o.rel, rel) / L; if (t > 0 && o.d * o.d - t * t < o.r2) return true; } return false; };
      const add = (pos, color, absMag) => {
        if (absMag === undefined || absMag === null) return;
        const rel = v3.sub(pos, cam.pos), L = v3.len(rel);
        const m = absMag + 5 * Math.log10(Math.max(L, 1e-12) / 32.6156);
        if (m > 1.3) return;
        const pp = this.project(pos);
        if (!pp || !pp.onScreen || hidden(rel, L)) return;
        const I = Math.min(Math.pow(10, -0.4 * (m - 1.0)), 40);
        const c = color || [1, 1, 1], mx = Math.max(c[0], c[1], c[2], 1e-3);
        out.push({ x: pp.x * k, y: (cv.clientHeight - pp.y) * k, I, col: c.map((x) => 0.5 * x / mx + 0.5) });
      };
      for (const sys of this.scene.systems) add(sys.star.pos, sys.star.color, sys.star.absMag);
      for (const st of this.scene.catalog.stars) if (!st.isSun) add(st.pos, st.color, st.absMag);
      if (!this._brightHyg) this._brightHyg = this.scene.catalog.hygStars.filter((s) => s.absMag < 2.5 || s.proper);
      for (const st of this._brightHyg) add(st.pos, st.color, st.absMag);
      for (const c of MW.catalog.binaries) add(c.pos, c.color, c.absMag);
      // одна и та же звезда может быть в двух каталогах — убираем дубли по экранной позиции
      out.sort((a, b) => b.I - a.I);
      const res = [];
      for (const o of out) { if (res.some((r) => Math.abs(r.x - o.x) < 3 && Math.abs(r.y - o.y) < 3)) continue; res.push(o); if (res.length >= 16) break; }
      return res;
    }
    drawLensEffects(target) {
      if (this.s.lens === false) { this.lensPeak = 0; return; }
      const src = this.lensSources();
      this.lensPeak = src.length ? src[0].I : 0;
      this.stats.lens = src.length;
      if (!src.length) return;
      const a = new Float32Array(64), c = new Float32Array(48);
      src.forEach((o, i) => { a.set([o.x, o.y, o.I, 0.32], i * 4); c.set(o.col, i * 3); });
      const p = this.pFlare.use();
      p.set('u_res', [this.width, this.height]); p.set('u_n', src.length);
      p.set('u_src', a); p.set('u_scol', c);
      // блики объектива и анаморфная полоса — только от действительно ярких источников (Солнце, звезда рядом)
      p.set('u_ghost', MW.util.clamp((src[0].I - 3) / 25, 0, 1) * 0.35);
      this.glc.bindTarget(target);
      this.glc.blendAdd();
      this.glc.fullscreen();
    }
    /* Автоэкспозиция («адаптация глаза»): раз в несколько кадров меряем среднюю лог-яркость кадра и долю очень
       ярких пикселей; яркое Солнце в кадре плавно снижает экспозицию, тёмный глубокий космос — повышает
       (проявляются слабые звёзды и газ, как на длинной выдержке). Затемнение быстрее (~0,5 с), осветление ~1,6 с. */
    updateExposure(target) {
      const gl = this.gl, now = performance.now();
      const dt = Math.min(0.25, ((now - (this._expT || now)) / 1000) || 0.016);
      this._expT = now;
      if (this.autoExp === undefined) { this.autoExp = 1; this.expTarget = 1; }
      if (this.s.autoExposure === false) { this.autoExp = 1; return; }
      this._expFrame = (this._expFrame || 0) + 1;
      if (this._expFrame % 6 === 0) {
        if (!this.tLum) this.tLum = this.glc.target(32, 18, { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE });
        this.glc.bindTarget(this.tLum);
        this.glc.noBlend();
        const p = this.pLum.use();
        p.tex('u_src', target.tex);
        p.set('u_cell', [1 / 32, 1 / 18]);
        this.glc.fullscreen();
        const px = this._lumPx || (this._lumPx = new Uint8Array(32 * 18 * 4));
        gl.readPixels(0, 0, 32, 18, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let lg = 0, br = 0;
        for (let i = 0; i < 32 * 18; i++) { lg += px[i * 4] / 255 * 22 - 16; br += px[i * 4 + 1] / 255; }
        lg /= 32 * 18; br /= 32 * 18;
        this.stats.lumLog = lg; this.stats.brightFrac = br;
        const key = MW.util.clamp(Math.pow(2, (this.expKeyLog ?? -6.5) - lg), 0.05, 50);
        // Солнце/яркая звезда в кадре занимает доли процента площади — экспозицию снижаем и по яркости источника
        this.expTarget = MW.util.clamp(Math.pow(key, 0.3), 0.62, 1.4) / (1 + 6 * br) / (1 + 0.15 * Math.log2(1 + Math.max(0, (this.lensPeak || 0) - 8) / 2));   // яркие звёзды неба (Сириус ~10) не в счёт
        this.glc.bindTarget(target);
      }
      const tau = this.expTarget < this.autoExp ? 0.5 : 1.6;
      this.autoExp += (this.expTarget - this.autoExp) * (1 - Math.exp(-dt / tau));
      this.stats.autoExp = this.autoExp;
    }

    bloomAndComposite(src) {
      const gl = this.gl;
      this.glc.noBlend();
      let prev = src;
      for (let i = 0; i < this.mips.length; i++) {
        const t = this.mips[i];
        this.glc.bindTarget(t);
        const p = this.pDown.use();
        p.tex('u_src', prev.tex);
        p.set('u_texel', [1 / prev.w, 1 / prev.h]);
        p.set('u_threshold', 1.1); p.set('u_first', i === 0 ? 1 : 0);
        this.glc.fullscreen();
        prev = t;
      }
      this.glc.blendAdd();
      for (let i = this.mips.length - 1; i > 0; i--) {
        const from = this.mips[i], to = this.mips[i - 1];
        this.glc.bindTarget(to);
        const p = this.pUp.use();
        p.tex('u_src', from.tex);
        p.set('u_texel', [1 / from.w, 1 / from.h]); p.set('u_radius', 1.0);
        this.glc.fullscreen();
      }
      this.glc.noBlend();
      this.glc.bindTarget(null);
      const c = this.pComp.use();
      c.tex('u_scene', src.tex); c.tex('u_bloom', this.mips[0].tex);
      // на галактических масштабах bloom слабее: звёздные россыпи резкие, без мутного ореола
      const sd = v3.len(this.cam.pos);
      const galScale = MW.util.smoothstep(4000, 40000, sd) * (1 - MW.util.smoothstep(3e7, 2e8, sd));
      c.set('u_bloomStr', this.s.bloom * (1 - 0.6 * galScale)); c.set('u_exposure', this.s.exposure * (this.autoExp || 1));
      c.set('u_time', this.scene.realTime); c.set('u_vignette', 0.35); c.set('u_art', this.s.artistic ? 1 : 0);
      this.glc.fullscreen();
    }
  }

  MW.Renderer = Renderer;
})();
