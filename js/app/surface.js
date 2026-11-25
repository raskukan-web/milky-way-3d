'use strict';
/* =====================================================================
 *  Режим «На поверхности» (посадка на твёрдые планеты и спутники).
 *
 *  Состояние наблюдателя хранится в системе координат тела (метры, double): позиция P и ориентация qb.
 *  Тело вращается и движется по орбите — мировая позиция камеры каждый кадр выводится заново, поэтому
 *  при ускорении времени Солнце и луны честно ходят по небу, а Юпитер над Европой стоит на месте
 *  (приливный захват). Ниже границы атмосферы (или 5 % радиуса) горизонт плавно выравнивается по
 *  местной вертикали, камера не опускается ниже ~2 м над рельефом (высота под камерой — запросом к GPU,
 *  той же функцией, что строит сетку).
 *
 *  Физический профиль тела (атмосфера, рельеф, события) выводится из его параметров: состава и
 *  плотности атмосферы, Tэкв, массы, приливного захвата, расстояния до звезды и её спектра.
 * ===================================================================== */
(function () {
  const MW = window.MW;
  const v3 = MW.v3, Q = MW.q, U = MW.util;
  const LY_M = MW.C.LY_KM * 1000;
  const PM = 65536;
  const EYE = 2.0;
  const DEG = Math.PI / 180;
  const LANDABLE = new Set([0, 1, 2, 3, 8, 9, 10, 11, 12, 13, 15, 16]);
  // «Погрузиться в атмосферу»: гиганты и мини-нептуны (полёт у облачной палубы), океаны магмы и воды (зависание),
  // Венера (спуск сквозь облака на раскалённую равнину — режим посадки со своей атмосферой)
  const DIVE = new Set([1, 4, 5, 6, 7, 14, 17, 15, 12]);
  const EARTH_R = [5.8e-6, 13.5e-6, 33.1e-6];
  const EARTH_O3 = [0.65e-6, 1.88e-6, 0.085e-6];
  const sc3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const f32 = (a) => new Float32Array(a);

  function bodyAxes(b) {
    const fr = b.frame, c = Math.cos(b.spin), s = Math.sin(b.spin);
    return { x: v3.add(v3.scale(fr.x, c), v3.scale(fr.y, s)), y: v3.add(v3.scale(fr.x, -s), v3.scale(fr.y, c)), z: fr.z };
  }
  const toBody = (ax, w) => [v3.dot(ax.x, w), v3.dot(ax.y, w), v3.dot(ax.z, w)];
  // перестановка осей: грань куба f (0..5 = +x, −x, +y, −y, +z, −z) → «+z» (как toF в шейдере ландшафта)
  const toFace = (v, f) => [[v[1], v[2], v[0]], [-v[1], v[2], -v[0]], [v[2], v[0], v[1]], [-v[2], v[0], -v[1]], [v[0], v[1], v[2]], [-v[0], v[1], -v[2]]][f];
  const toWorld = (ax, b) => [ax.x[0] * b[0] + ax.y[0] * b[1] + ax.z[0] * b[2], ax.x[1] * b[0] + ax.y[1] * b[1] + ax.z[1] * b[2], ax.x[2] * b[0] + ax.y[2] * b[1] + ax.z[2] * b[2]];

  /* ---------- физический профиль тела ---------- */
  function profile(b) {
    const id = b.id, t = b.type;
    const R = (b.radiusKm || b.radius * MW.C.LY_KM) * 1000;
    const T = b.temp || b.teq || 0;
    const exo = b.exo || [0, 0, 0, 0];
    const M = b.massE || null;
    const P = {
      R, style: 0, relief: 3000, hill: 150, terr: [0.6, 0, 0.6, 0.6], terr2: [0, 0, 0, 0],
      col1: b.col1 || [0.35, 0.33, 0.31], col2: b.col2 || [0.55, 0.52, 0.48], col3: b.col3 || [0.1, 0.2, 0.35],
      atm: null, cloud: null, wind: 5, frost: 0, heat: 0, lava: 0, aurora: false, vents: null, devils: 0, ash: 0, shimmer: 0,
      locked: !!(b.locked || b.kind === 'moon'), T, notes: [],
    };
    const lin = (c) => c.map((x) => Math.pow(x, 2.2));
    const earthLike = (k, clouds) => ({ bR: sc3(EARTH_R, k), bMs: [2.0e-5, 2.0e-5, 2.0e-5], bMa: [2.2e-6, 2.2e-6, 2.2e-6], bO: sc3(EARTH_O3, k), g: [0.76, 0.76, 0.76], HR: 8000, HM: 1200, top: 100000 });
    // ---- Солнечная система ----
    if (id === 'earth') {
      Object.assign(P, { style: 2, relief: 3500, hill: 260, terr: [0, 0, 0.12, 0.8], terr2: [1, 0, 0, 1], wind: 9, aurora: true });
      P.atm = earthLike(1); P.cloud = { cov: 0.42, alt: 2200, scale: 9000, col: [1, 1, 1] };
      P.notes.push('Азотно-кислородная атмосфера 1 бар: рэлеевское рассеяние окрашивает небо в голубой, на закате свет проходит ~40 толщ воздуха — остаются красные лучи; озон добавляет сумеречную синеву.');
    } else if (id === 'mars') {
      Object.assign(P, { style: 1, relief: 3500, hill: 140, terr: [0.35, 0.8, 0.9, 0.3], wind: 7, devils: 0.6 });
      // CO₂ 0,6 % земного давления (рэлеевская толща ~3 % земной) и пыль τ≈0,5: частицы ~1,5 мкм рассеивают синий
      // сильнее вперёд (вокруг Солнца) и поглощают его в остальном небе — днём охра, на закате голубой ореол.
      const ext = 0.5 / 11000;
      // альбедо однократного рассеяния пыли ~0,96 / 0,8 / 0,63 (красный/зелёный/синий); синий рассеивается в узкий
      // конус вперёд (g≈0,82 против 0,64 у красного) — у Солнца синий избыток, в остальном небе синий поглощён
      P.atm = { bR: sc3(EARTH_R, 0.029), bMs: [ext * 0.96, ext * 0.8, ext * 0.63], bMa: [ext * 0.04, ext * 0.2, ext * 0.37], bO: [0, 0, 0], g: [0.64, 0.7, 0.82], HR: 11000, HM: 11000, top: 120000 };
      P.cloud = { cov: 0.0, alt: 22000, scale: 26000, col: [0.95, 0.92, 0.9] };
      P.notes.push('Пыль τ≈0,5 в разреженной CO₂-атмосфере: днём охристо-розовое небо, на закате — голубое сияние вокруг Солнца (снимки Spirit, Curiosity).');
    } else if (id === 'titan') {
      Object.assign(P, { style: 5, relief: 900, hill: 120, terr: [0.04, 1, 0.5, 0.3], terr2: [2, 0, 0, 0], wind: 1 });
      const H = 60000;
      P.atm = { bR: sc3(EARTH_R, 4.4), bMs: [2.5 / H * 0.97, 4 / H * 0.9, 7 / H * 0.7], bMa: [2.5 / H * 0.03, 4 / H * 0.1, 7 / H * 0.3], bO: [0, 0, 0], g: [0.65, 0.65, 0.66], HR: 20000, HM: H, top: 450000 };
      P.cloud = { cov: 0.1, alt: 25000, scale: 40000, col: [0.95, 0.72, 0.45] };
      P.col1 = [0.12, 0.08, 0.05]; P.col2 = [0.3, 0.2, 0.12]; P.texGain = 4;
      P.notes.push('Азот 1,5 бар и толстая дымка толинов (τ 3–7): небо оранжево-янтарное, Солнце — тусклое размытое пятно.');
    } else if (id === 'pluto') {
      Object.assign(P, { style: 9, relief: 2500, hill: 150, terr: [0.3, 0, 0.4, 0.6], terr2: [0, 0, 0.5, 0], frost: 1 });
      P.atm = { bR: [0, 0, 0], bMs: [0.6e-7, 0.85e-7, 1.3e-7], bMa: [0, 0, 0], bO: [0, 0, 0], g: [0.5, 0.5, 0.5], HR: 30000, HM: 30000, top: 200000 };
      P.vents = { n: 3, h: 6000, w: 400, col: [0.7, 0.72, 0.75], dark: false };
    } else if (id === 'europa') {
      Object.assign(P, { style: 3, relief: 500, hill: 60, terr: [0.08, 0, 0.3, 0.3], terr2: [0, 0, 1, 0], frost: 1 });
      P.vents = { n: 3, h: 160000, w: 9000, col: [0.85, 0.92, 1.0], dark: false };
    } else if (id === 'enceladus') {
      Object.assign(P, { style: 9, relief: 900, hill: 60, terr: [0.3, 0, 0.3, 0.4], terr2: [0, 0, 1, 0], frost: 1.3 });
      P.vents = { n: 5, h: 180000, w: 6000, col: [0.85, 0.92, 1.0], dark: false };
    } else if (id === 'triton') {
      Object.assign(P, { style: 9, relief: 800, hill: 80, terr: [0.1, 0, 0.3, 0.4], terr2: [0, 0, 0.6, 0], frost: 1 });
      P.vents = { n: 4, h: 8000, w: 500, col: [0.12, 0.11, 0.1], dark: true };
    } else if (id === 'venus' || t === 1) {
      // CO₂ 92 бар и сплошные облака серной кислоты на 48–70 км: свет рассеян много раз, диска Солнца не видно;
      // синий поглощён (сернистые соединения) — у поверхности густой оранжево-жёлтый полумрак, +465 °C
      Object.assign(P, { style: 7, relief: 1600, hill: 90, terr: [0, 0, 0.5, 0.5], wind: 1, shimmer: 0.9, heat: 0 });
      const Hc = 22000;
      P.atm = { bR: sc3(EARTH_R, 9), bMs: [5.6 / Hc * 0.97, 5.0 / Hc * 0.9, 4.6 / Hc * 0.6], bMa: [5.6 / Hc * 0.03, 5.0 / Hc * 0.1, 4.6 / Hc * 0.4], bO: [0, 0, 0], g: [0.72, 0.72, 0.74], HR: 15900, HM: Hc, top: 120000 };
      P.cloud = { cov: 1.0, alt: 52000, scale: 30000, col: [1.0, 0.86, 0.52] };
      P.col1 = [0.2, 0.16, 0.12]; P.col2 = [0.36, 0.3, 0.24];
      P.descentDur = 16;
      P.diff = [0.05, 0.03, 0.008];          // ~3 % солнечного света доходит до дна рассеянным, синий поглощён
      P.notes.push('CO₂ 92 бар и облака серной кислоты (48–70 км): диска Солнца не видно, у поверхности — густой оранжевый полумрак и +465 °C.');
    } else if (id === 'io') {
      Object.assign(P, { style: 4, relief: 3000, hill: 200, terr: [0, 0, 0.4, 0.6] });
    } else if (id === 'moon' || id === 'mercury') {
      Object.assign(P, { style: 0, relief: id === 'moon' ? 4500 : 3500, hill: 260, terr: [1, 0, 0.9, 0.55] });
    } else if (id === 'phobos' || id === 'deimos') {
      Object.assign(P, { style: 0, relief: R * 0.08, hill: R * 0.006, terr: [1, 0, 0.6, 0.3] });
    } else if (t === 0 || t === 8) {
      Object.assign(P, { style: 0, relief: 3000, hill: 220, terr: [0.9, 0, 0.7, 0.5] });
    } else if (t === 9) {
      Object.assign(P, { style: 4, relief: 2500, hill: 160, terr: [0, 0, 0.4, 0.6] });
    } else if (t === 10) {
      Object.assign(P, { style: 3, relief: 600, hill: 60, terr: [0.1, 0, 0.3, 0.3], terr2: [0, 0, 1, 0], frost: 1 });
    } else if (t === 11) {
      Object.assign(P, { style: 5, relief: 900, hill: 120, terr: [0.05, 1, 0.5, 0.3], terr2: [2, 0, 0, 0], wind: 1 });
      P.atm = { bR: sc3(EARTH_R, 4.4), bMs: [4e-5, 6.5e-5, 1.1e-4], bMa: [1.5e-6, 7e-6, 3.5e-5], bO: [0, 0, 0], g: [0.65, 0.65, 0.66], HR: 20000, HM: 60000, top: 450000 };
    }
    // ---- экзопланеты (тип и облик уже выведены из реальных параметров в procsystem.classify) ----
    if (b.exoReal || (!b.system.isSolar && b.kind === 'planet')) {
      const light = M !== null && M < 1.2, superE = M !== null && M >= 2;
      // гравитация задаёт рельеф: лёгкие миры — резкие высокие горы, суперземли — сглаженные
      const relief = light ? 7000 : superE ? 1800 : 3800;
      const dens = b.atmoDens || 0;
      const Tss = Math.round(T * Math.SQRT2);
      P.relief = relief; P.hill = relief * 0.05;
      if (t === 15) {
        // лавовый мир: кора плавится, под звездой — магматическое озеро; тонкая дымка испарённых силикатов
        Object.assign(P, { style: 8, terr: [0, 0, 0.4, 0.6], lava: Math.max(exo[1] || 1, 0.6), ash: 0.6, shimmer: 1 });
        P.terr2 = [0, 0.975 - 0.035 * U.clamp((exo[1] || 1) - 0.4, 0, 1), 0, 0];
        P.atm = { bR: [0, 0, 0], bMs: [3e-6, 2.1e-6, 1.2e-6], bMa: [0.3e-6, 0.6e-6, 1.2e-6], bO: [0, 0, 0], g: [0.7, 0.7, 0.7], HR: 15000, HM: 15000, top: 150000 };
        P.notes.push('Tэкв ' + Math.round(T) + ' K: базальт плавится; над поверхностью — пары натрия и SiO, марево раскалённого воздуха и пепел.');
      } else if (t === 13) {
        const hotLock = exo[0] === 5;
        Object.assign(P, { style: 7, terr: [0.2, 0.3, 0.8, 0.6] });
        if (hotLock) { P.heat = U.clamp((Tss - 700) / 500, 0, 1.4); P.ash = Tss > 800 ? 0.6 : 0.2; P.shimmer = 1; }
        else if (T > 450) P.shimmer = 0.6;
        const tau = 0.12 * dens;
        P.atm = { bR: sc3(EARTH_R, dens / 8 * 0.6), bMs: [tau / 8000 * 0.95, tau / 8000 * 0.85, tau / 8000 * 0.6], bMa: [tau / 8000 * 0.05, tau / 8000 * 0.15, tau / 8000 * 0.4], bO: [0, 0, 0], g: [0.7, 0.7, 0.75], HR: 9000, HM: 8000, top: 110000 };
      } else if (t === 12) {
        const eyeball = exo[0] === 6;
        Object.assign(P, { style: 6, terr: [0, 0, 0.4, 0.7], terr2: [1, 0, eyeball ? (b.par ? b.par[0] : 0.5) + 1 : 0, 0], aurora: true });
        const k = U.clamp(dens / 8, 0.3, 2.5);
        P.atm = earthLike(k);
        P.cloud = { cov: U.clamp(0.28 + (b.clouds || 0.14) * 1.2, 0.2, 0.6), alt: 2500, scale: 10000, col: [1, 1, 1] };
        P.wind = 10;
        P.col1 = [0.18, 0.2, 0.1]; P.col2 = [0.42, 0.36, 0.26];
      } else if (t === 3) {
        Object.assign(P, { style: 1, terr: [0.4, 0.8, 0.9, 0.7], devils: 0.5 });
        const k = U.clamp(dens / 1.6, 0.3, 3), ext = 0.45 * k / 11000;
        P.atm = { bR: sc3(EARTH_R, 0.03 * k), bMs: [ext * 0.97, ext * 0.86, ext * 0.6], bMa: [ext * 0.03, ext * 0.14, ext * 0.4], bO: [0, 0, 0], g: [0.6, 0.66, 0.86], HR: 11000, HM: 11000, top: 120000 };
        P.col1 = [0.35, 0.17, 0.08]; P.col2 = [0.6, 0.35, 0.2];
      } else if (t === 16) {
        Object.assign(P, { style: 9, terr: [0.4, 0, 0.4, 0.5], terr2: [0, 0, 0.6, 0], frost: 1 });
        P.col1 = [0.62, 0.66, 0.72]; P.col2 = [0.85, 0.88, 0.92];
      } else if (t === 0) {
        Object.assign(P, { style: 0, terr: [0.9, 0, 0.7, 0.5] });
      }
      // приливный захват: на терминаторе ураганный ветер с дневной стороны на ночную
      if (b.locked && P.atm && t !== 15) {
        P.wind = 150; P.devils = Math.max(P.devils, 0.9);
        P.notes.push('Приливный захват: ветер с дневной стороны на ночную ~150 м/с — у терминатора несутся облачные фронты и пылевые вихри.');
      }
    }
    if (t === 15 && !P.atm) P.style = 8;
    P.terr[0] = MW.craterFactor(b);     // кратеры — по той же планетологической оценке, что и с орбиты
    P.col1 = P.col1 && P.col1.length === 3 ? P.col1 : [0.4, 0.38, 0.36];
    // освещённость звездой: цвет фотосферы + «адаптация глаза» к потоку (как у дисков планет)
    const st = b.system.star;
    const dS = v3.dist(st.pos, b.pos) / MW.C.AU_LY;
    const flux = (st.lum || 1) / (dS * dS);
    const c = st.color || [1, 1, 1], mx = Math.max(c[0], c[1], c[2], 1e-6);
    P.sunCol = c.map((x) => x / mx);
    P.sunE = U.clamp(1.2 * Math.pow(flux, 0.06), 0.8, 1.35) * Math.PI;
    P.sunAng = Math.atan(((st.radius || (st.radiusSun || 1) * MW.C.RSUN_LY)) / Math.max(v3.dist(st.pos, b.pos), 1e-30));
    P.lin = lin;
    // свечение ночного неба и звёздный фон: чем плотнее атмосфера (колонка рэлеевского рассеяния относительно
    // земной), тем ярче слой airglow (O I 557,7 нм, OH, Na — зеленовато-бирюзовый) и рассеянный свет ночью
    if (P.atm) {
      const tau = (P.atm.bR[1] * P.atm.HR) / (EARTH_R[1] * 8000);
      P.glow = { k: U.clamp(Math.sqrt(tau), 0.35, 2.2), alt: U.clamp(P.atm.HR * 11, 40000, 250000),
        col: P.atm.HM > 4000 && P.atm.bMa[2] > P.atm.bMa[0] ? [0.95, 0.75, 0.45] : [0.5, 1.0, 0.62] };
    }
    return P;
  }

  /* ---------- профиль погружения: облачные ярусы, дымка, цвета, ветер, молнии (по данным планеты и звезды) ---------- */
  function aeroProfile(b, P) {
    const t = b.type, id = b.id, T = b.temp || b.teq || 0, exo = b.exo || [0, 0, 0, 0];
    const lin = (c) => c.map((x) => Math.pow(Math.max(x, 0), 2.2));
    const mix = (a, c, k) => a.map((x, i) => x + (c[i] - x) * k);
    const col1 = b.col1 || [0.85, 0.8, 0.7], col2 = b.col2 || [0.6, 0.45, 0.32], col3 = b.col3 || col2;
    const hot = (t === 14 && (exo[0] === 2 || T > 1000));
    const A = { style: 0, H: 27, deck: [0.1, 0.75, 0.15, 2.6], deck2: [-1.6, -0.85, 0.9, 0], hazeK: 0.06, tau0: 0.6, glow: 0, wind: 0.12,
      camAlt: -0.3, zMin: -1.9, lightning: 0, ring: null, ext: [0.8, 1.0, 1.3] };
    A.c2 = lin(mix(col1, [1, 1, 1], 0.3)); A.c1 = lin(col2); A.c3 = lin(col2).map((x) => x * 0.35);
    A.skyC = [0.3, 0.5, 1.0]; A.haze = [0.95, 0.82, 0.62];
    if (t === 15) {
      // океан магмы: чёрные плиты базальтовой корки дрейфуют по расплаву; дым, пепел и искры
      Object.assign(A, { style: 3, H: 8, deck: [0.0, 0.9, -1, 1], deck2: [0, 0, 0, 0], hazeK: 0.22, tau0: 0.35, glow: U.clamp(exo[1] || 1, 0.6, 1.6), wind: 0.002,
        camAlt: 0.03, zMin: 0.0025, ext: [0.9, 1.0, 1.25], skyC: [0.4, 0.33, 0.3], haze: [0.42, 0.3, 0.24] });
      A.c1 = A.c2 = A.c3 = [0.2, 0.18, 0.16];
      A.title = 'океаном магмы';
    } else if (t === 12) {
      // водный мир: бескрайний океан, кучевые облака, солнечная дорожка; небо — по спектру звезды
      const sc = P.sunCol;
      Object.assign(A, { style: 4, H: 8, deck: [0.16, 0.55, 0.22, 0.3], deck2: [0, 0, 0, 0], hazeK: 0.1, tau0: 0.25, wind: 0.01,
        camAlt: 0.06, zMin: 0.003, ext: [0.55, 1.0, 2.0] });
      A.skyC = [0.3 * (0.6 + 0.4 * sc[0]), 0.55 * (0.7 + 0.3 * sc[1]), 1.0 * (0.5 + 0.5 * sc[2])];
      A.haze = [0.85, 0.9, 1.0]; A.c1 = [0.82, 0.84, 0.88]; A.c2 = [0.95, 0.95, 0.96]; A.c3 = [0.4, 0.42, 0.46];
      A.title = 'океаном';
    } else if (hot) {
      // горячий юпитер: раскалённая стратосфера, облака из силикатов и железа несутся со скоростью км/с
      const glow = U.clamp((T - 900) / 1000, 0.2, 1.3);
      Object.assign(A, { style: 2, H: U.clamp(27 * T / 165, 60, 450), deck: [0.0, 0.55, 0.02, 0.35], deck2: [-1.2, -0.55, 0.0, 3.5], hazeK: 0.045, tau0: 0.4,
        glow: glow * 0.5, wind: 2.5, camAlt: 0.8, zMin: -1.8, ext: [0.6, 1.15, 2.0], skyC: [1.0, 0.28, 0.1], haze: [1.0, 0.48, 0.18] });
      A.c2 = [1.0, 0.62, 0.26]; A.c1 = [0.5, 0.12, 0.05]; A.c3 = [0.2, 0.04, 0.02];
    } else if (t === 6 || t === 7 || t === 17) {
      // ледяные гиганты и мини-нептуны: метан гасит красный — бирюзовая/кобальтовая дымка, высокие перистые облака
      const atm = (b.atmo && b.atmo.length >= 3) ? b.atmo.slice(0, 3) : [0.45, 0.7, 1.0];
      const warm = t === 17 && T > 330;
      // Ледяные гиганты — как раньше; мини-нептуны и субнептуны (t = 17): не сплошная дымка на 1–3 бар, а
      // многоярусный облачный ландшафт — волнистый облачный «океан» внизу, кучевые башни по сторонам,
      // редкие перистые выше и прозрачное верхнее небо
      const mini = t === 17;
      Object.assign(A, { style: 1, H: t === 6 ? 27.7 : t === 7 ? 19.7 : U.clamp(25 * Math.max(T, 60) / 70, 20, 220),
        deck: mini ? [0.95, 1.2, -0.35, 3.2] : [0.5, 0.85, 0.28, 3.0], deck2: mini ? [-1.35, -0.55, 0.45, 0.0] : [-1.4, -0.9, 0.0, 4.0],
        hazeK: mini ? (warm ? 0.012 : 0.009) : warm ? 0.16 : 0.08, tau0: mini ? (warm ? 0.3 : 0.25) : warm ? 1.1 : 0.9, wind: t === 7 ? 0.5 : 0.25,
        camAlt: mini ? 0.2 : 0.15, zMin: -1.6, ext: warm ? [0.9, 1.0, 1.2] : [1.7, 0.85, 0.55], lightning: mini ? 0.5 : 0.15 });
      A.skyC = lin(atm).map((x) => x * 1.4); A.haze = lin(mix(atm, [1, 1, 1], 0.35));
      A.c2 = [0.95, 0.97, 1.0]; A.c1 = lin(mix(col1, [1, 1, 1], 0.4)); A.c3 = lin(col2).map((x) => x * 0.5);
    } else {
      // газовые гиганты: аммиачные облака (верхний ярус), NH₄SH (ниже), башни конвекции, молнии в водяных облаках
      const H = id === 'jupiter' ? 27 : id === 'saturn' ? 59.5 : U.clamp(27 * Math.max(T, 100) / 165, 25, 160);
      Object.assign(A, { H, lightning: 1, wind: id === 'saturn' ? 0.4 : 0.15 });
      if (id === 'saturn') { A.hazeK = 0.1; A.tau0 = 1.0; A.haze = [1.0, 0.88, 0.6]; }
      if (T > 150 && T <= 350 && t === 14) { A.c2 = [0.95, 0.96, 1.0]; A.skyC = [0.3, 0.5, 1.0]; }       // облака водяного льда
      else if (T > 350 && t === 14) { A.deck[2] = -0.25; A.hazeK = 0.04; A.skyC = [0.25, 0.42, 1.0]; A.ext = [1.2, 1.0, 0.9]; }  // чистое синее небо
    }
    if (b.ring && A.style <= 1) A.ring = { ri: b.ring[0], ro: b.ring[1], a: Math.min(b.ring[2] || 0.5, 1) * 0.85, col: lin(b.ringCol || [0.8, 0.72, 0.6]) };
    A.zMax = A.style >= 3 ? 400 : 40;      // выше — выход в космос (в H)
    A.wisp = A.style >= 3 ? 0 : A.style === 2 ? 0.25 : 0.35;   // пряди конденсата по ветру
    return A;
  }

  /* ---------- атмосфера на CPU (та же модель, что в шейдере неба): пропускание к звезде, свет неба ---------- */
  function raySph(o, d, c, r) {
    const oc = v3.sub(o, c), b = v3.dot(oc, d), cc = v3.dot(oc, oc) - r * r, h = b * b - cc;
    if (h < 0) return [1e20, -1e20];
    const s = Math.sqrt(h); return [-b - s, -b + s];
  }
  function atmoEval(A, camR, Rg, Rt, rd, sunL, sunE) {
    const C = [0, 0, -camR];
    const dens = (z) => [Math.exp(-z / A.HR), Math.exp(-z / A.HM), Math.max(0, 1 - Math.abs(z - 25000) / 15000)];
    const ext = (d) => [0, 1, 2].map((i) => A.bR[i] * d[0] + (A.bMs[i] * (1 - A.g[i] * A.g[i]) + A.bMa[i]) * d[1] + A.bO[i] * d[2]);
    const sunOD = (p) => {
      const hs = raySph(p, sunL, C, Rt), hg = raySph(p, sunL, C, Rg - 50);
      if (hg[0] > 0 && hg[0] < hg[1]) return [1e4, 1e4, 1e4];
      const L = Math.max(hs[1], 0), dt = L / 4, od = [0, 0, 0];
      for (let i = 0; i < 4; i++) {
        const q = v3.madd(p, sunL, dt * (i + 0.5));
        const z = Math.max(v3.len(v3.sub(q, C)) - Rg, 0), e = ext(dens(z));
        for (let k = 0; k < 3; k++) od[k] += e[k] * dt;
      }
      return od;
    };
    const ht = raySph([0, 0, 0], rd, C, Rt), hg = raySph([0, 0, 0], rd, C, Rg);
    const ground = hg[0] > 0 && hg[0] < hg[1];
    const L = ground ? hg[0] : Math.max(ht[1], 0);
    const mu = v3.dot(rd, sunL);
    const pR = 0.0596831 * (1 + mu * mu);
    const pM = A.g.map((g) => 0.1193662 * (1 - g * g) * (1 + mu * mu) / ((2 + g * g) * Math.pow(Math.max(1 + g * g - 2 * g * mu, 1e-4), 1.5)));
    const N = 10, dt = L / N, In = [0, 0, 0], od = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      const p = v3.scale(rd, dt * (i + 0.5));
      const z = Math.max(v3.len(v3.sub(p, C)) - Rg, 0), d = dens(z), e = ext(d), so = sunOD(p);
      for (let k = 0; k < 3; k++) {
        const tr = Math.exp(-(od[k] + e[k] * dt * 0.5) - so[k]);
        In[k] += tr * (A.bR[k] * 2.6 * d[0] * pR + A.bMs[k] * d[1] * pM[k]) * dt;
        od[k] += e[k] * dt;
      }
    }
    // кратное рассеяние — то же приближение, что в шейдере неба
    const sunUp = U.smoothstep(-0.12, 0.05, sunL[2]);
    const tauDust = [0, 1, 2].reduce((s, k) => s + (A.bMs[k] + A.bMa[k]) * A.HM, 0) / 3;
    const msK = U.clamp(tauDust / 0.4, 0, 1);
    for (let k = 0; k < 3; k++) {
      const alb = (A.bR[k] + A.bMs[k]) / Math.max(A.bR[k] + A.bMs[k] + A.bMa[k], 1e-12);
      const tauV = A.bR[k] * A.HR + (A.bMs[k] * (1 - A.g[k] * A.g[k]) + A.bMa[k]) * A.HM;
      const Ts = Math.exp(-tauV / Math.max(sunL[2] + 0.15, 0.05));
      In[k] += (1 - Math.exp(-od[k])) * alb * alb * 0.1 * sunUp * (0.25 + 0.75 * U.clamp(sunL[2] * 2, 0, 1)) * (0.3 + 0.7 * Ts) * msK;
    }
    return { In: In.map((x, k) => x * sunE[k]), T: od.map((x) => Math.exp(-x)), sunT: sunOD([0, 0, 0]).map((x) => Math.exp(-x)) };
  }

  class Surface {
    constructor(app) {
      this.app = app;
      this.active = false;
      this.body = null;
      this.P = [0, 0, 1];
      this.qb = Q.ident();
      this.vel = [0, 0, 0];
      this.hG = 0; this.hValid = false;
      this.nudge = [0, 0, 0];
      this.descent = null; this.pending = null;
      this.sunT = [1, 1, 1]; this.veil = 1; this.amb = [0, 0, 0];
      this.ready = false;
      this.mode = 'land'; this.aero = null; this.aeroMix = 0; this.flashes = []; this.altCmd = 0;
    }
    isDivable(b) { return !!b && (b.kind === 'planet' || b.kind === 'moon') && DIVE.has(b.type) && (b.type !== 12 || !b.system.isSolar); }
    // тело под камерой не рисуется обычным рендером, пока его полностью заменяет ландшафт/атмосфера
    hidesBody() { return this.mode !== 'aero' || this.aeroMix > 0.985; }
    isLandable(b) { return !!b && (b.kind === 'planet' || b.kind === 'moon') && LANDABLE.has(b.type) && !(b.type === 13 && b.exo && b.exo[0] === 2); }
    enterAlt(b) {
      const R = (b.radiusKm || b.radius * MW.C.LY_KM) * 1000;
      const p = this.prof && this.body === b ? this.prof : null;
      return Math.max(0.05 * R, p && p.atm ? Math.min(p.atm.top, 0.3 * R) : 0);
    }

    /* ---------- программы GPU (компилируются при первой посадке, не задерживают запуск) ---------- */
    initGL(r) {
      if (this.progs) return;
      const G = MW.GLSL, glc = r.glc;
      this.progs = {
        terrain: glc.program('terrain', G.terrainVS, G.terrainFS),
        sky: glc.program('surfSky', G.fullscreenVS, G.surfSkyFS),
        comp: glc.program('surfComp', G.fullscreenVS, G.surfCompFS),
        query: glc.program('terrQuery', G.fullscreenVS, G.terrQueryFS),
        post: glc.program('surfPost', G.fullscreenVS, G.surfPostFS),
        aero: glc.program('aero', G.fullscreenVS, G.aeroFS),
        aeroComp: glc.program('aeroComp', G.fullscreenVS, G.aeroCompFS),
        copy: glc.program('surfCopy', G.fullscreenVS, G.surfCopyFS),
      };
      this.ext = r.gl.getExtension('KHR_parallel_shader_compile');
    }
    glReady() {
      if (!this.progs) return false;
      if (this.ready) return true;
      const list = Object.values(this.progs);
      if (list.every((p) => p.done(this.ext))) { list.forEach((p) => p.finish()); this.ready = true; }
      return this.ready;
    }
    buildMesh(r) {
      const T = MW.Q.terrain || { az: 192, rings: 96 };
      const NA = T.az, NR = T.rings, gl = r.gl;
      const vert = new Float32Array((NR + 1) * (NA + 1) * 2);
      let k = 0;
      for (let j = 0; j <= NR; j++) for (let a = 0; a <= NA; a++) { vert[k++] = j; vert[k++] = a; }
      const idx = new (((NR + 1) * (NA + 1) > 65535) ? Uint32Array : Uint16Array)(NR * NA * 6);
      let m = 0;
      const id = (j, a) => j * (NA + 1) + a;
      // от дальних колец к ближним: ближний рельеф рисуется поверх дальнего
      for (let j = NR - 1; j >= 0; j--) for (let a = 0; a < NA; a++) {
        idx[m++] = id(j, a); idx[m++] = id(j + 1, a); idx[m++] = id(j + 1, a + 1);
        idx[m++] = id(j, a); idx[m++] = id(j + 1, a + 1); idx[m++] = id(j, a + 1);
      }
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, vert, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      this.mesh = { vao, count: idx.length, type: idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, NA, NR };
    }
    skyTargets(r) {
      const gl = r.gl, div = (MW.Q.terrain && MW.Q.terrain.skyDiv) || 2;
      const w = Math.max(16, Math.round(r.width / div)), h = Math.max(16, Math.round(r.height / div));
      if (this.sky && this.sky.w === w && this.sky.h === h) return this.sky;
      if (this.sky) { gl.deleteFramebuffer(this.sky.fbo); gl.deleteTexture(this.sky.tIn); gl.deleteTexture(this.sky.tT); }
      const mk = () => r.glc.texture2D(w, h, {});
      const tIn = mk(), tT = mk();
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tIn, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, tT, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.sky = { fbo, tIn, tT, w, h };
      return this.sky;
    }

    /* ---------- вход/выход ---------- */
    enter(b) {
      const cam = this.app.cam;
      this.body = b; this.prof = profile(b);
      this.initGL(this.app.renderer);
      const ax = bodyAxes(b);
      this.P = v3.scale(toBody(ax, v3.sub(cam.pos, b.pos)), LY_M);
      this.qb = Q.norm(Q.mul(Q.conj(Q.fromBasis(ax.x, ax.y, ax.z)), cam.q));
      this.vel = [0, 0, 0];
      this.hValid = false; this.hG = 0;
      this.active = true;
      this.app.scene.surfaceBody = b;
      this.makeVents();
      this.devils = [];
      this.sunT = [1, 1, 1]; this.veil = 1;
      this.mode = 'land'; this.aero = null; this.aeroMix = 1; this.horizonSun = undefined;
      if (this.app.ui) this.app.ui.onSurface(true);
    }
    exit() {
      if (!this.active) return;
      this.active = false; this.descent = null; this.mode = 'land'; this.aero = null;
      this.app.scene.surfaceBody = null;
      this.app.cam.vel = [0, 0, 0];
      if (this.app.ui) this.app.ui.onSurface(false);
    }
    takeoff() {
      const b = this.body;
      this.exit();
      this.pending = null;
      if (b && this.app.ui) { this.app.ui.flyTo(b); this.app.ui.toast('🚀 Взлёт на орбиту ' + b.name); }
    }
    // точки извержений — у горизонта места посадки (на 20–120 км), видны их верхушки
    makeVents() {
      const p = this.prof, vs = [];
      if (p.vents) {
        const n0 = v3.norm(this.P), E = v3.norm(v3.len(v3.cross([0, 0, 1], n0)) < 1e-6 ? [1, 0, 0] : v3.cross([0, 0, 1], n0)), N = v3.cross(n0, E);
        const rnd = MW.rng.mulberry32(MW.rng.hashStr(this.body.id + ':' + Math.round(n0[0] * 50) + ':' + Math.round(n0[1] * 50)));
        for (let i = 0; i < p.vents.n; i++) {
          const az = rnd() * Math.PI * 2, d = Math.min(p.R * 0.6, (p.vents.h > 50000 ? 40000 : 4000) + rnd() * (p.vents.h > 50000 ? 120000 : 14000));
          const dir = v3.add(v3.scale(E, Math.cos(az)), v3.scale(N, Math.sin(az)));
          const ang = d / p.R;
          vs.push({ n: v3.norm(v3.add(v3.scale(n0, Math.cos(ang)), v3.scale(dir, Math.sin(ang)))), h: p.vents.h * (0.5 + rnd() * 0.7), w: p.vents.w * (0.6 + rnd() * 0.8), ph: rnd() * 100, per: 60 + rnd() * 90 });
        }
      }
      this.vents = vs;
    }

    /* ---------- посадка ---------- */
    chooseSite(b, opts) {
      const p = profile(b), ax = bodyAxes(b);
      const sunB = toBody(ax, v3.norm(v3.sub(b.system.star.pos, b.pos)));
      const par = b.parentBody ? toBody(ax, v3.norm(v3.sub(b.parentBody.pos, b.pos))) : null;
      const want = (opts && opts.sunElev !== undefined ? opts.sunElev : p.style === 8 ? 45 : p.atm ? 5 : 16) * DEG;
      const rnd = MW.rng.mulberry32((Date.now() & 0xffff) ^ MW.rng.hashStr(b.id));
      let best = null, bs = -1e9;
      for (let i = 0; i < 4000; i++) {
        const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z);
        const n = [s * Math.cos(a), s * Math.sin(a), z];
        const el = Math.asin(U.clamp(v3.dot(n, sunB), -1, 1));
        let sc = -Math.abs(el - want) / DEG;
        const lat = Math.asin(z) / DEG;
        if (Math.abs(lat) > 62) sc -= 30;
        if (opts && opts.lat !== undefined) sc -= Math.abs(Math.abs(lat) - opts.lat) * 0.5;
        if (par && b.radius < b.parentBody.radius) {
          const ep = Math.asin(U.clamp(v3.dot(n, par), -1, 1)) / DEG;
          sc -= Math.abs(ep - 30) * 0.4;
        }
        if (opts && opts.parentElev !== undefined && par) sc -= Math.abs(Math.asin(U.clamp(v3.dot(n, par), -1, 1)) / DEG - opts.parentElev) * 0.6;
        if (sc > bs) { bs = sc; best = n; }
      }
      return best;
    }
    land(b, opts) {
      if (!this.isLandable(b)) return false;
      const cam = this.app.cam, ui = this.app.ui;
      this.initGL(this.app.renderer);
      // уже рядом (на поверхности или низко над ней) — садимся прямо под собой
      const altR = v3.dist(cam.pos, b.pos) / b.radius - 1;
      if ((this.active && this.body === b) || (cam.anchor === b && altR < 0.35 && !opts)) {
        if (!this.active || this.body !== b) this.enter(b);
        this.startDescent(v3.norm(this.P));
        return true;
      }
      this.exit();
      const site = this.chooseSite(b, opts);
      const target = {
        obj: b, body: b, name: b.name, getPos: () => b.pos, arrive: b.radius * 1.7,
        get viewDir() { return toWorld(bodyAxes(b), site); },
      };
      this.app.scene.lastCam = cam.pos;
      cam.flyTo(target);
      this.pending = { body: b, site };
      if (ui) ui.toast('🛬 Посадка на ' + b.name + ': выход на точку над местом посадки…');
      return true;
    }
    // мгновенная посадка в точку (без перелёта): для тестов и «Приземлиться» на месте
    placeAt(b, opts) {
      const site = (opts && opts.site) || this.chooseSite(b, opts);
      const ax = bodyAxes(b), R = (b.radiusKm || b.radius * MW.C.LY_KM) * 1000;
      this.app.cam.cancelAuto();
      this.app.cam.pos = v3.add(b.pos, v3.scale(toWorld(ax, site), (R + 20000) / LY_M));
      this.app.cam.lookAt(b.pos, toWorld(ax, [0, 0, 1]));
      this.exit(); this.pending = null;
      this.enter(b);
      this.startDescent(site);
      this.descent.dur = (opts && opts.dur) || 0.05;
      return site;
    }
    startDescent(site) {
      const b = this.body, p = this.prof;
      const ax = bodyAxes(b);
      const r0 = v3.len(this.P);
      this.P = v3.scale(site, r0);
      const up = site;
      const sunB = toBody(ax, v3.norm(v3.sub(b.system.star.pos, b.pos)));
      let fh = v3.sub(sunB, v3.scale(up, v3.dot(sunB, up)));
      if (v3.len(fh) < 1e-3) fh = v3.cross(up, [1, 0, 0]);
      fh = v3.norm(fh);
      // смотрим чуть левее звезды и немного вверх — в кадре и горизонт, и закатное небо
      const side = v3.norm(v3.cross(fh, up));
      const f = v3.norm(v3.add(v3.add(v3.scale(fh, Math.cos(18 * DEG)), v3.scale(side, -Math.sin(18 * DEG))), v3.scale(up, 0.06)));
      const qEnd = Q.lookRotation(f, up);
      this.descent = { t: 0, dur: p.descentDur || 7.5, alt0: Math.max(r0 - p.R - (this.hValid ? this.hG : 0), EYE * 2), q0: this.qb.slice(), qEnd, site };
      this.hValid = false;
      if (this.app.ui) this.app.ui.toast('🛬 Снижение: ' + b.name);
    }

    /* ---------- кадр: управление наблюдателем ---------- */
    update(dt) {
      const app = this.app, cam = app.cam;
      if (this.pending) {
        const b = this.pending.body;
        if (!cam.auto) {
          if (cam.anchor === b && v3.dist(cam.pos, b.pos) < b.radius * 3) {
            if (this.pending.aero) this.enterAero(b, this.pending.site);
            else { this.enter(b); this.startDescent(this.pending.site); }
          }
          this.pending = null;
        }
      }
      if (!this.active) {
        if (cam.auto) return false;
        const b = cam.anchor;
        if (b && this.isLandable(b)) {
          const altM = (v3.dist(cam.pos, b.pos) - b.radius) * LY_M;
          const R = (b.radiusKm || b.radius * MW.C.LY_KM) * 1000;
          const p = b === this.body && this.prof ? this.prof : profile(b);
          if (altM < Math.max(0.05 * R, p.atm ? Math.min(p.atm.top, 0.3 * R) : 0)) this.enter(b);
        } else if (b && this.isDivable(b) && !this.isLandable(b)) {
          // гигант без поверхности: ниже ~2 % радиуса камера сама переходит в полёт в атмосфере
          const altM = (v3.dist(cam.pos, b.pos) - b.radius) * LY_M;
          if (altM < 0.02 * (b.radiusKm || b.radius * MW.C.LY_KM) * 1000) {
            const A = aeroProfile(b, profile(b));
            if (altM < A.zMax * 0.75 * A.H * 1000) this.enterAero(b, null);
          }
        }
        if (!this.active) return false;
      }
      if (cam.auto) { this.exit(); return false; }
      if (this.mode === 'aero') return this.updateAero(dt);
      const b = this.body, p = this.prof, R = p.R;
      const ax = bodyAxes(b), qBody = Q.fromBasis(ax.x, ax.y, ax.z);
      let P = this.P;
      const up = v3.norm(P);
      const hG = this.hValid ? this.hG : (this.lastHG || 0);
      const alt = v3.len(P) - R - hG;
      const k = cam.keys;
      if (this.descent) {
        const d = this.descent;
        d.t += dt;
        const s = Math.min(d.t / d.dur, 1), e = s * s * s * (s * (s * 6 - 15) + 10);
        const a = Math.exp(Math.log(d.alt0) + (Math.log(EYE) - Math.log(d.alt0)) * e);
        P = v3.scale(d.site, R + hG + a);
        this.qb = Q.slerp(d.q0, d.qEnd, U.smoothstep(0.2, 1, s));
        cam.mouseLook = [0, 0];
        if ((s >= 1 && this.hValid) || (k.size && d.t > 0.5)) {
          this.descent = null;
          if (s >= 1 && app.ui) app.ui.toast('Посадка: ' + b.name + '. WASD / два пальца — идти, мышь / палец — осмотр');
        }
      } else {
        // ---- осмотр: рысканье вокруг местной вертикали, тангаж вокруг правой оси камеры ----
        const sens = cam.fov / 60 * 0.0028 * 60 * 0.0166;
        const mx = cam.mouseLook[0] * sens, my = cam.mouseLook[1] * sens;
        cam.mouseLook = [0, 0]; cam.orbitDelta = [0, 0]; cam.panDelta = [0, 0];
        const kr = 1.2 * dt;
        let yaw = -mx, pitch = -my;
        if (k.has('ArrowLeft')) yaw += kr;
        if (k.has('ArrowRight')) yaw -= kr;
        if (k.has('ArrowUp') && !k.has('ShiftLeft')) pitch += kr;
        if (k.has('ArrowDown') && !k.has('ShiftLeft')) pitch -= kr;
        let qb = this.qb;
        if (yaw) qb = Q.mul(Q.axisAngle(up, yaw), qb);
        if (pitch) {
          const rt = Q.rot(qb, [1, 0, 0]);
          const q2 = Q.mul(Q.axisAngle(rt, pitch), qb);
          if (Math.abs(v3.dot(Q.rot(q2, [0, 0, -1]), up)) < 0.985) qb = q2;
        }
        // ---- перемещение вдоль поверхности ----
        const f = Q.rot(qb, [0, 0, -1]);
        let fh = v3.sub(f, v3.scale(up, v3.dot(f, up)));
        fh = v3.len(fh) < 1e-4 ? Q.rot(qb, [0, 1, 0]) : v3.norm(fh);
        const rh = v3.norm(v3.cross(fh, up));
        const inp = [0, 0, 0];
        if (k.has('KeyW')) inp[0] += 1;
        if (k.has('KeyS')) inp[0] -= 1;
        if (k.has('KeyD')) inp[1] += 1;
        if (k.has('KeyA')) inp[1] -= 1;
        if (k.has('KeyR') || k.has('Space')) inp[2] += 1;
        if (k.has('KeyF') || k.has('KeyC')) inp[2] -= 1;
        const boost = k.has('ShiftLeft') || k.has('ShiftRight') ? 8 : 1;
        const speed = Math.max(3, alt * 0.9) * cam.throttle * boost;
        const tgt = v3.add(v3.add(v3.scale(fh, inp[0] * speed), v3.scale(rh, inp[1] * speed)), v3.scale(up, inp[2] * speed));
        // без ввода инерция гаснет за ~0,15 с (три постоянные времени по 0,05 с) и ниже 1e-4 м/с обнуляется
        // жёстко — грунт замирает сразу, без медленного «доползания»
        const moving = inp[0] || inp[1] || inp[2];
        const bl = 1 - Math.exp(-dt / (moving ? 0.25 : 0.05));
        this.vel = v3.lerp(this.vel, tgt, bl);
        if (!moving && v3.len(this.vel) < 1e-4) this.vel = [0, 0, 0];
        P = v3.add(P, v3.scale(this.vel, dt));
        // касания: два пальца (щипок — вперёд/назад, сдвиг — вбок/вверх), масштаб — высота над рельефом
        if (this.nudge[0] || this.nudge[1] || this.nudge[2]) {
          const sc = Math.max(alt, 8);
          P = v3.add(P, v3.add(v3.add(v3.scale(fh, this.nudge[0] * sc), v3.scale(rh, this.nudge[1] * sc)), v3.scale(up, this.nudge[2] * sc)));
          this.nudge = [0, 0, 0];
        }
        // ---- горизонт: «вверх» камеры к местной вертикали, сильнее у земли ----
        const thr = this.enterAlt(b);
        const tau = alt < thr * 0.25 ? 0.1 : 0.5;
        const f2 = Q.rot(qb, [0, 0, -1]);
        if (Math.abs(v3.dot(f2, up)) < 0.995) qb = Q.slerp(qb, Q.lookRotation(f2, up), 1 - Math.exp(-dt / tau));
        this.qb = Q.norm(qb);
        if (alt > thr * 1.15) { this.sync(b, ax, qBody, P, alt); this.exit(); return true; }
      }
      // у земли (ниже ~40 м, без подъёма R/Space) наблюдатель плавно «оседает» на рельеф — идёт по нему
      if (!this.descent && this.hValid && !(k.has('KeyR') || k.has('Space'))) {
        const a2 = v3.len(P) - R - hG;
        if (a2 > EYE && a2 < 40 && v3.dot(this.vel, up) <= 0.5) P = v3.scale(P, (R + hG + EYE + (a2 - EYE) * Math.exp(-dt / 0.35)) / v3.len(P));
      }
      if (this.descent && this.hValid) this.descent.hG = hG;
      // не ниже уровня глаз над рельефом
      const rr = v3.len(P), minR = R + hG + EYE;
      if (rr < minR) { P = v3.scale(P, minR / rr); const vr = v3.dot(this.vel, up); if (vr < 0) this.vel = v3.sub(this.vel, v3.scale(up, vr)); }
      this.P = P;
      this.sync(b, ax, qBody, P, v3.len(P) - R - hG);
      return true;
    }
    /* ---------- погружение в атмосферу ---------- */
    dive(b) {
      if (!this.isDivable(b)) return false;
      // Венера и венероподобные: спуск сквозь облака на раскалённую равнину — режим посадки с их атмосферой
      if (b.type === 1) return this.land(b);
      const cam = this.app.cam, ui = this.app.ui;
      this.initGL(this.app.renderer);
      const altR = v3.dist(cam.pos, b.pos) / b.radius - 1;
      if ((this.active && this.body === b) || (cam.anchor === b && altR < 0.35)) {
        if (!(this.active && this.body === b && this.mode === 'aero')) { this.exit(); this.enterAero(b, null); }
        this.startAeroDescent(v3.norm(this.P));
        return true;
      }
      this.exit();
      const prof = profile(b), aer = aeroProfile(b, prof);
      const site = this.chooseSite(b, { sunElev: aer.style === 2 ? 40 : aer.style >= 3 ? 18 : 22, lat: aer.ring ? 25 : undefined });
      const target = { obj: b, body: b, name: b.name, getPos: () => b.pos, arrive: b.radius * 1.7, get viewDir() { return toWorld(bodyAxes(b), site); } };
      this.app.scene.lastCam = cam.pos;
      cam.flyTo(target);
      this.pending = { body: b, site, aero: true };
      if (ui) ui.toast('🪂 Погружение в атмосферу: ' + b.name + ' — выход на точку входа…');
      return true;
    }
    enterAero(b, site) {
      this.enter(b);
      this.mode = 'aero';
      this.aero = aeroProfile(b, this.prof);
      this.flashes = [];
      this.sunVis = 1;
      this.horizonSun = -90;
      this.aeroMix = 0;
      if (site) this.startAeroDescent(site);
      if (this.app.ui) this.app.ui.onSurface(true);
    }
    // взгляд у горизонта, чуть в сторону от звезды; спуск по логарифму высоты до облачной палубы
    startAeroDescent(site) {
      const b = this.body, A = this.aero, R = this.prof.R, Hm = A.H * 1000;
      const ax = bodyAxes(b);
      const r0 = v3.len(this.P);
      const sunB = toBody(ax, v3.norm(v3.sub(b.system.star.pos, b.pos)));
      let fh = v3.sub(sunB, v3.scale(site, v3.dot(sunB, site)));
      if (v3.len(fh) < 1e-3) fh = v3.cross(site, [1, 0, 0]);
      fh = v3.norm(fh);
      const side = v3.norm(v3.cross(fh, site)), ang = (A.style === 2 ? 8 : 28) * DEG;
      const f = v3.norm(v3.add(v3.add(v3.scale(fh, Math.cos(ang)), v3.scale(side, -Math.sin(ang))), v3.scale(site, A.style >= 3 ? -0.08 : A.style === 2 ? 0.12 : 0.04)));
      this.descent = { aero: true, t: 0, dur: A.style >= 3 ? 9 : 11, alt0: r0 - R, alt1: A.camAlt * Hm, q0: this.qb.slice(), qEnd: Q.lookRotation(f, site), site };
      if (this.app.ui) this.app.ui.toast('🪂 Спуск сквозь атмосферу: ' + b.name);
    }
    updateAero(dt) {
      const app = this.app, cam = app.cam, k = cam.keys;
      const b = this.body, A = this.aero, R = this.prof.R, Hm = A.H * 1000;
      const ax = bodyAxes(b), qBody = Q.fromBasis(ax.x, ax.y, ax.z);
      let P = this.P;
      const up = v3.norm(P);
      if (this.descent) {
        const d = this.descent;
        d.t += dt;
        const s = Math.min(d.t / d.dur, 1), e = s * s * s * (s * (s * 6 - 15) + 10);
        const off = 3 * Hm - Math.min(A.zMin * Hm, 0);
        const a = Math.exp(Math.log(d.alt0 + off) + (Math.log(d.alt1 + off) - Math.log(d.alt0 + off)) * e) - off;
        P = v3.scale(d.site, R + a);
        this.qb = Q.slerp(d.q0, d.qEnd, U.smoothstep(0.15, 0.9, s));
        cam.mouseLook = [0, 0];
        if (s >= 1 || (k.size && d.t > 0.5)) {
          this.descent = null;
          if (s >= 1 && app.ui) app.ui.toast(b.name + ': полёт в атмосфере. WASD — лететь, R/F или ▲▼ — выше/ниже, мышь — осмотр');
        }
      } else {
        const sens = cam.fov / 60 * 0.0028 * 60 * 0.0166;
        const mx = cam.mouseLook[0] * sens, my = cam.mouseLook[1] * sens;
        cam.mouseLook = [0, 0]; cam.orbitDelta = [0, 0]; cam.panDelta = [0, 0];
        const kr = 1.2 * dt;
        let yaw = -mx, pitch = -my;
        if (k.has('ArrowLeft')) yaw += kr;
        if (k.has('ArrowRight')) yaw -= kr;
        if (k.has('ArrowUp') && !k.has('ShiftLeft')) pitch += kr;
        if (k.has('ArrowDown') && !k.has('ShiftLeft')) pitch -= kr;
        let qb = this.qb;
        if (yaw) qb = Q.mul(Q.axisAngle(up, yaw), qb);
        if (pitch) {
          const rt = Q.rot(qb, [1, 0, 0]);
          const q2 = Q.mul(Q.axisAngle(rt, pitch), qb);
          if (Math.abs(v3.dot(Q.rot(q2, [0, 0, -1]), up)) < 0.985) qb = q2;
        }
        const f = Q.rot(qb, [0, 0, -1]);
        let fh = v3.sub(f, v3.scale(up, v3.dot(f, up)));
        fh = v3.len(fh) < 1e-4 ? Q.rot(qb, [0, 1, 0]) : v3.norm(fh);
        const rh = v3.norm(v3.cross(fh, up));
        const inp = [0, 0, this.altCmd];
        if (k.has('KeyW')) inp[0] += 1;
        if (k.has('KeyS')) inp[0] -= 1;
        if (k.has('KeyD')) inp[1] += 1;
        if (k.has('KeyA')) inp[1] -= 1;
        if (k.has('KeyR') || k.has('Space')) inp[2] += 1;
        if (k.has('KeyF') || k.has('KeyC')) inp[2] -= 1;
        const alt = v3.len(P) - R;
        const boost = k.has('ShiftLeft') || k.has('ShiftRight') ? 8 : 1;
        // аэростат над жидкостью — метры в секунду; у облачной палубы гиганта — доли шкалы высот
        const sp = (A.style >= 3 ? Math.max(15, alt * 0.6) : Hm * 0.04 + Math.max(0, alt) * 0.3) * cam.throttle * boost;
        const tgt = v3.add(v3.add(v3.scale(fh, inp[0] * sp), v3.scale(rh, inp[1] * sp)), v3.scale(up, inp[2] * sp * (A.style >= 3 ? 1 : 0.6)));
        const bl = 1 - Math.exp(-dt / (inp[0] || inp[1] || inp[2] ? 0.35 : 0.25));
        this.vel = v3.lerp(this.vel, tgt, bl);
        P = v3.add(P, v3.scale(this.vel, dt));
        if (this.nudge[0] || this.nudge[1] || this.nudge[2]) {
          const sc = A.style >= 3 ? Math.max(alt, 20) : Hm * 0.3;
          P = v3.add(P, v3.add(v3.add(v3.scale(fh, this.nudge[0] * sc), v3.scale(rh, this.nudge[1] * sc)), v3.scale(up, this.nudge[2] * sc)));
          this.nudge = [0, 0, 0];
        }
        const f2 = Q.rot(qb, [0, 0, -1]);
        if (Math.abs(v3.dot(f2, up)) < 0.995) qb = Q.slerp(qb, Q.lookRotation(f2, up), 1 - Math.exp(-dt / 0.3));
        this.qb = Q.norm(qb);
        if (alt > A.zMax * Hm) { this.sync(b, ax, qBody, P, alt); this.exit(); return true; }
      }
      // не глубже нижнего яруса (давление там уже сотни бар) и не ниже ~20 м над жидкостью
      const rr = v3.len(P), minR = R + A.zMin * Hm;
      if (rr < minR) { P = v3.scale(P, minR / rr); const vr = v3.dot(this.vel, up); if (vr < 0) this.vel = v3.sub(this.vel, v3.scale(up, vr)); }
      this.P = P;
      this.sync(b, ax, qBody, P, v3.len(P) - R);
      this.updateFlashes(dt);
      return true;
    }
    // Молнии: грозовые ячейки в глубине облачных каньонов. Раз в 1,5–4 с (у гигантов) в поле зрения или рядом
    // вспыхивает ячейка — серия из 2–4 мерцающих разрядов в одной точке (как у Юпитера на снимках «Юноны»);
    // между ними — редкие одиночные вспышки в стороне. t < 0 — разряд серии ещё не начался.
    updateFlashes(dt) {
      const A = this.aero;
      this.flashes = this.flashes.filter((f) => (f.t += dt) < f.dur);
      if (!A.lightning) return;
      const rnd = Math.random;
      const n0 = v3.norm(this.P), E = v3.perp(n0), N = v3.cross(n0, E);
      const spawn = (az, dist, depth, delay, I) => {
        const base = v3.add(v3.scale(E, Math.cos(az) * dist), v3.scale(N, Math.sin(az) * dist));
        this.flashes.push({ pB: v3.add(v3.scale(n0, this.prof.R + depth), base), t: -delay, dur: 0.12 + rnd() * 0.3, I, ph: rnd() * 50 });
      };
      this._ltNext = (this._ltNext ?? 1) - dt;
      if (this._ltNext <= 0 && this.flashes.length < 3) {
        this._ltNext = (1.5 + rnd() * 2.5) / A.lightning;
        // азимут взгляда (в базисе E, N вокруг n0) ± 50°
        const f = Q.rot(this.qb, [0, 0, -1]);
        const az = Math.atan2(v3.dot(f, N), v3.dot(f, E)) + (rnd() - 0.5) * 1.75;
        const dist = A.H * (1.5 + rnd() * 5.5) * 1000, depth = (A.deck2[0] - 0.1 + rnd() * 0.35) * A.H * 1000;
        const n = 2 + Math.floor(rnd() * 3);
        let del = 0;
        for (let i = 0; i < n && this.flashes.length < 3; i++) { spawn(az, dist, depth, del, 1.2 + rnd() * 2.2); del += 0.08 + rnd() * 0.3; }
      } else if (this.flashes.length < 3 && rnd() < dt * 0.25 * A.lightning) {
        spawn(rnd() * Math.PI * 2, A.H * (1.2 + rnd() * 8) * 1000, (A.deck2[0] + 0.2 + rnd() * 0.4) * A.H * 1000, 0, 0.5 + rnd());
      }
    }
    aeroTargets(r, div) {
      const gl = r.gl;
      const w = Math.max(16, Math.round(r.width / div)), h = Math.max(16, Math.round(r.height / div));
      if (this.aT && this.aT.w === w && this.aT.h === h) return this.aT;
      if (this.aT) { gl.deleteFramebuffer(this.aT.fbo); gl.deleteTexture(this.aT.tIn); gl.deleteTexture(this.aT.tT); }
      const tIn = r.glc.texture2D(w, h, {}), tT = r.glc.texture2D(w, h, {});
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tIn, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, tT, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.aT = { fbo, tIn, tT, w, h };
      return this.aT;
    }
    renderAero(r, target) {
      const gl = r.gl, glc = r.glc, A = this.aero, b = this.body, p = this.prof, sc = this.app.scene;
      const ax = bodyAxes(b);
      const P = this.P, camR = v3.len(P), n0 = v3.scale(P, 1 / camR);
      let E = v3.cross([0, 0, 1], n0);
      E = v3.len(E) < 1e-6 ? [1, 0, 0] : v3.norm(E);
      const N = v3.cross(n0, E);
      const altKm = (camR - p.R) / 1000, H = A.H;
      // переход: с высоты ~40 H видна обычная планета, к ~15 H — облака вокруг
      this.aeroMix = 1 - U.smoothstep(15 * H, 40 * H, altKm);
      if (this.aeroMix < 0.003) return target;
      const sunB = toBody(ax, v3.norm(v3.sub(b.system.star.pos, b.pos)));
      const sunL = [v3.dot(sunB, E), v3.dot(sunB, N), v3.dot(sunB, n0)];
      const sunE = p.sunCol.map((c) => c * p.sunE);
      const hn = altKm / H;
      // пропускание к звезде (для бликов и «дневного» неба) — та же оценка, что в шейдере
      const tauS = A.tau0 * Math.exp(-Math.max(hn, -3) * 0.9) / Math.max(sunL[2] + 0.12, 0.08);
      this.sunT = A.ext.map((e) => Math.exp(-tauS * e) * U.smoothstep(-0.05, 0.05, sunL[2]));
      const day = U.smoothstep(-0.2, 0.08, sunL[2]);
      this.veil = 1 / (1 + 30 * day * (1 - Math.exp(-A.tau0 * Math.exp(-Math.max(hn, -3) * 0.9))));
      const Tq = MW.Q.terrain || {};
      const div = A.style >= 3 ? (MW.QUALITY === 'ultra' ? 1 : 2) : (Tq.skyDiv || 2);
      const tg = this.aeroTargets(r, div);
      gl.bindFramebuffer(gl.FRAMEBUFFER, tg.fbo); gl.viewport(0, 0, tg.w, tg.h);
      glc.noBlend();
      const s = r.common(this.progs.aero);
      s.set('u_res', [tg.w, tg.h]);
      const Ew = toWorld(ax, E), Nw = toWorld(ax, N), Uw = toWorld(ax, n0);
      s.set('u_w2l', f32([Ew[0], Nw[0], Uw[0], Ew[1], Nw[1], Uw[1], Ew[2], Nw[2], Uw[2]]));
      s.set('u_style', A.style);
      s.set('u_R', p.R / 1000); s.set('u_alt', altKm); s.set('u_H', H);
      s.set('u_sunL', f32(sunL)); s.set('u_sunE', f32(sunE));
      s.set('u_c1', f32(A.c1)); s.set('u_c2', f32(A.c2)); s.set('u_c3', f32(A.c3));
      s.set('u_skyC', f32(A.skyC)); s.set('u_haze', f32(A.haze)); s.set('u_ext', f32(A.ext));
      s.set('u_hazeK', A.hazeK); s.set('u_tau0', A.tau0);
      s.set('u_deck', f32(A.deck)); s.set('u_deck2', f32(A.deck2));
      const rt = sc.realTime;
      // ветер вдоль параллели (на восток = +x локально); видимая скорость усилена для наглядности
      const wk = A.wind * rt * 4;
      s.set('u_wind', f32([-wk, 0]));
      s.set('u_t', rt);
      if (A.ring) {
        s.set('u_ring', f32([A.ring.ri, A.ring.ro, A.ring.a, 1]));
        s.set('u_ringN', f32([E[2], N[2], n0[2]])); s.set('u_ringC', f32(A.ring.col));
      } else s.set('u_ring', f32([0, 0, 0, 0]));
      const fl = new Float32Array(12);
      this.flashes.forEach((f, i) => {
        if (i > 2) return;
        const d = v3.scale(v3.sub(f.pB, P), 1 / 1000);
        const fk = f.t < 0 ? 0 : Math.pow(Math.max(0, Math.sin(Math.min(f.t / f.dur, 1) * Math.PI)), 0.5) * (0.6 + 0.4 * Math.sin(f.t * 90 + f.ph));
        fl.set([v3.dot(d, E), v3.dot(d, N), v3.dot(d, n0), f.I * fk * p.sunE * 0.6], i * 4);
      });
      s.set('u_fl', fl);
      s.set('u_glow', A.glow);
      s.set('u_wisp', A.wisp || 0);
      s.set('u_probe', f32([0, 0, 0, 0]));
      const st = Tq.skySteps || 12;
      s.set('u_steps', Math.min(96, Math.round(A.style >= 3 ? st * 2 : st * 5)));
      s.set('u_lightN', st >= 10 ? 2 : 1);
      s.set('u_pixAng', 2 * r.tanHalf / tg.h);
      gl.bindVertexArray(glc.emptyVAO); gl.drawArrays(gl.TRIANGLES, 0, 3);
      // проба: тот же шейдер, один луч строго на звезду → пропускание облаков и дымки к ней (асинхронно, через PBO).
      // По нему гаснут блики объектива, когда звезда за облачным валом
      this.probeSun(r, s, sunL);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const other = (t) => (t === r.tA ? r.tB : r.tA);
      let src = target;
      const dst = other(src);
      glc.bindTarget(dst); glc.noBlend();
      const c = this.progs.aeroComp.use();
      c.tex('u_src', src.tex); c.tex('u_skyIn', tg.tIn); c.tex('u_skyT', tg.tT);
      c.set('u_veil', this.veil); c.set('u_mixK', this.aeroMix); c.set('u_blur', A.style >= 3 ? 0.6 : 1.0);
      glc.fullscreen();
      src = dst;
      // океан магмы: марево раскалённого воздуха, пепел и искры
      if (A.style === 3) {
        const d2 = other(src);
        glc.bindTarget(d2); glc.noBlend();
        const q = this.progs.post.use();
        q.tex('u_src', src.tex);
        q.set('u_time', rt); q.set('u_heat', 1); q.set('u_ash', 0.7); q.set('u_aspect', r.aspect); q.set('u_tanHalf', r.tanHalf);
        const cr = r.cam.right, cu = r.cam.up, cb = v3.scale(r.cam.forward, -1);
        q.set('u_upV', f32([v3.dot(cr, Uw), v3.dot(cu, Uw), v3.dot(cb, Uw)]));
        glc.fullscreen();
        src = d2;
      }
      this.sunUp = U.smoothstep(-0.05, 0.15, sunL[2]);
      return src;
    }
    probeSun(r, s, sunL) {
      const gl = r.gl, glc = r.glc;
      if (!this.pT) {
        const tIn = glc.texture2D(1, 1, {}), tT = glc.texture2D(1, 1, {});
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tIn, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, tT, 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        const pbo = gl.createBuffer();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, 16, gl.STREAM_READ); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        this.pT = { fbo, tIn, tT, pbo, fence: null, buf: new Float32Array(4) };
      }
      const q = this.pT;
      if (q.fence) {
        const st = gl.clientWaitSync(q.fence, 0, 0);
        if (st !== gl.ALREADY_SIGNALED && st !== gl.CONDITION_SATISFIED) return;
        gl.deleteSync(q.fence); q.fence = null;
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, q.pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, q.buf); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        const v = 0.2126 * q.buf[0] + 0.7152 * q.buf[1] + 0.0722 * q.buf[2];
        if (Number.isFinite(v)) this.sunVis = U.clamp(v, 0, 1);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, q.fbo); gl.viewport(0, 0, 1, 1);
      s.set('u_probe', f32([sunL[0], sunL[1], sunL[2], 1]));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      s.set('u_probe', f32([0, 0, 0, 0]));
      gl.readBuffer(gl.COLOR_ATTACHMENT1);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, q.pbo);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      q.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    }
    sync(b, ax, qBody, P, alt) {
      const cam = this.app.cam;
      cam.pos = v3.add(b.pos, v3.scale(toWorld(ax, P), 1 / LY_M));
      cam.q = Q.norm(Q.mul(qBody, this.qb));
      cam.anchor = b; cam.vel = [0, 0, 0]; cam.angVel = [0, 0, 0];
      cam.dEff = Math.max(alt, 1) / LY_M;
      cam.speed = v3.len(this.vel) / LY_M;
      this.alt = alt;
    }
    touchMove(fwd, right, upK) { this.nudge[0] += fwd; this.nudge[1] += right; this.nudge[2] += upK; }

    // высота звезды над горизонтом, °
    sunElev() {
      if (!this.active) return 0;
      const b = this.body, ax = bodyAxes(b);
      const s = toBody(ax, v3.norm(v3.sub(b.system.star.pos, b.pos)));
      return Math.asin(U.clamp(v3.dot(s, v3.norm(this.P)), -1, 1)) / DEG;
    }

    /* ---------- отрисовка: небо, ландшафт, марево ---------- */
    render(r, target) {
      if (!this.active || !this.glReady()) return target;
      if (this.mode === 'aero') return this.renderAero(r, target);
      const gl = r.gl, glc = r.glc, p = this.prof, b = this.body, sc = this.app.scene;
      if (!this.mesh) this.buildMesh(r);
      // карта альбедо орбитального шейдера (один раз на тело / при загрузке реальной карты)
      const albMap = r.albedoMap(this.body);
      const ax = bodyAxes(b);
      const P = this.P, camR = v3.len(P), n0 = v3.scale(P, 1 / camR);
      let E = v3.cross([0, 0, 1], n0);
      E = v3.len(E) < 1e-6 ? [1, 0, 0] : v3.norm(E);
      const N = v3.cross(n0, E);
      const R = p.R, camAlt = camR - R;
      const hG = this.hValid ? this.hG : (this.lastHG || 0);
      const sunB = toBody(ax, v3.norm(v3.sub(b.system.star.pos, b.pos)));
      const sunL = [v3.dot(sunB, E), v3.dot(sunB, N), v3.dot(sunB, n0)];
      this._sunB = sunB;
      const g0 = v3.scale(n0, R);
      // Relative-to-Eye: локальные координаты шума делятся в Float64 на старшую часть (кратна 512 м, меняется редко)
      // и малую младшую — в шейдер идут обе, сумма никогда не округляется во float32
      const pmodFull = g0.map((x) => ((x % PM) + PM) % PM);
      const locHi = pmodFull.map((x) => Math.floor(x / 512) * 512);
      const pmod = pmodFull.map((x, i) => x - locHi[i]);
      // якорь крупного рельефа: направление, неподвижное на планете; сменяется, лишь когда наблюдатель ушёл на ~2 км
      if (!this._anc || this._ancBody !== b || v3.dist(this._anc, n0) * R > 2000) { this._anc = n0.slice(); this._ancBody = b; }
      const anc = this._anc, n0a = v3.sub(n0, anc);
      const Tq = MW.Q.terrain || {};
      // ветер: у захваченных миров — с дневной стороны на ночную, иначе — с запада на восток
      let windB = E;
      if (p.wind > 50) { const w = v3.sub(v3.scale(n0, v3.dot(sunB, n0)), sunB); if (v3.len(w) > 1e-4) windB = v3.norm(w); }
      const jd = sc.jd, wt = ((jd - 2460000) * 86400) % 2e5;
      // ---- общие uniform рельефа ----
      const setTerr = (pr) => {
        pr.set('u_R', R); pr.set('u_relief', p.relief); pr.set('u_hill', p.hill);
        pr.set('u_terr', f32(p.terr)); pr.set('u_terr2', f32(p.terr2)); pr.set('u_style', p.style);
        pr.set('u_SP', f32([(b.seed || 0.5) * 17.0, (b.seed || 0.5) * 7.3, (b.seed || 0.5) * 3.1]));
        pr.set('u_sunB', f32(sunB)); pr.set('u_windB', f32(windB));
        pr.set('u_locHi', f32(locHi)); pr.set('u_anc', f32(anc)); pr.set('u_n0a', f32(n0a));
        const tA = b.texAux && p.terr2[3] ? r.texGet(b.texAux, true) : null;
        pr.tex('u_aux', tA ? tA.tex : r.dummyTex || (r.dummyTex = glc.texture2D(1, 1, { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE, data: new Uint8Array([128, 128, 255, 255]) })));
        pr.set('u_auxK', tA ? 1 : 0);
        if (p.terr2[3] && !tA) pr.set('u_terr2', f32([p.terr2[0], p.terr2[1], p.terr2[2], 0]));
      };
      this._setTerr = setTerr;
      // ---- запрос высоты рельефа под камерой (асинхронное чтение через PBO, без остановки конвейера) ----
      this.queryHeight(r, n0, pmod);
      // ---- атмосфера: освещённость, пропускание к звезде, свет неба (CPU, раз в несколько кадров) ----
      const Rg = R + hG, Rt = R + (p.atm ? p.atm.top : 0);
      const sunE = p.sunCol.map((c) => c * p.sunE);
      this._f = (this._f || 0) + 1;
      if (p.atm && (this._f % 5 === 1 || !this._amb)) {
        const ev = (dir) => atmoEval(p.atm, camR, Rg, Rt, v3.norm(dir), sunL, sunE);
        const z = ev([0, 0, 1]);
        const hs = [[1, 0, 0.25], [-1, 0, 0.25], [0, 1, 0.25], [0, -1, 0.25]].map(ev);
        const avg = [0, 1, 2].map((i) => 0.4 * z.In[i] + 0.15 * hs.reduce((s, h) => s + h.In[i], 0));
        this._amb = avg.map((x, i) => x * Math.PI * 1.6 + (p.diff ? p.diff[i] * sunE[i] * Math.PI * 4.0 : 0));
        this.sunT = z.sunT;
        const lz = 0.2126 * z.In[0] + 0.7152 * z.In[1] + 0.0722 * z.In[2] + (p.diff ? 0.2126 * p.diff[0] * sunE[0] + 0.7152 * p.diff[1] * sunE[1] : 0);
        this.veil = 1 / (1 + 600 * lz);
        this.skyLum = lz;
      } else if (!p.atm) {
        // без атмосферы: чёрное небо; тени подсвечивает лишь свет от освещённого грунта вокруг
        const sUp = U.smoothstep(-0.02, 0.1, sunL[2]);
        this._amb = sunE.map((c) => c * 0.035 * sUp + 0.0012);
        this.sunT = sunL[2] > -0.01 ? [1, 1, 1] : [0, 0, 0];
        this.veil = 1; this.skyLum = 0;
      }
      const sunC = sunE.map((c, i) => c * this.sunT[i]);
      // ночь: рельеф подсвечен свечением неба (airglow) и звёздным фоном — у плотной атмосферы заметно, а не чёрная пустота
      const night = 1 - U.smoothstep(-0.21, -0.02, sunL[2]);
      const ambN = p.glow && night > 0.001 ? [0, 1, 2].map((i) => (0.12 * p.glow.col[i] + 0.09 * [0.75, 0.85, 1.0][i]) * p.glow.k * night) : [0, 0, 0];
      // отражённый свет планеты-хозяина (Юпитер на ночной стороне Европы)
      let parL = [0, 0, 1], parC = [0, 0, 0];
      if (b.parentBody) {
        const pb = b.parentBody, d = v3.dist(pb.pos, b.pos);
        parL = toBody(ax, v3.norm(v3.sub(pb.pos, b.pos)));
        const ph = (1 + v3.dot(v3.norm(v3.sub(b.system.star.pos, pb.pos)), v3.norm(v3.sub(b.pos, pb.pos)))) / 2;
        const kk = 0.5 * Math.pow(pb.radius / d, 2) * ph * Math.PI;
        parC = sunE.map((c) => c * kk);
      }
      // ---- 1. небо (уменьшенное разрешение, две карты) ----
      let src = target;
      const other = (t) => (t === r.tA ? r.tB : r.tA);
      const sky = p.atm ? this.skyTargets(r) : null;
      const Ew = toWorld(ax, E), Nw = toWorld(ax, N), Uw = toWorld(ax, n0);
      if (sky) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, sky.fbo); gl.viewport(0, 0, sky.w, sky.h);
        glc.noBlend();
        const s = r.common(this.progs.sky);
        s.set('u_res', [sky.w, sky.h]);
        s.set('u_w2l', f32([Ew[0], Nw[0], Uw[0], Ew[1], Nw[1], Uw[1], Ew[2], Nw[2], Uw[2]]));
        s.set('u_l2b', f32([...E, ...N, ...n0]));
        s.set('u_camB', f32(P));
        s.set('u_camR', camR); s.set('u_Rg', Rg); s.set('u_Rt', Rt);
        const A = p.atm;
        s.set('u_bR', f32(A.bR)); s.set('u_bMs', f32(A.bMs)); s.set('u_bMa', f32(A.bMa)); s.set('u_bO', f32(A.bO)); s.set('u_gM', f32(A.g));
        s.set('u_H', f32([A.HR, A.HM]));
        s.set('u_sunL', f32(sunL)); s.set('u_sunE', f32(sunE)); s.set('u_sunAng', p.sunAng);
        s.set('u_steps', Tq.skySteps || 12);
        const cl = p.cloud;
        s.set('u_cloud', f32(cl ? [cl.cov, cl.alt, 600, cl.scale] : [0, 0, 0, 1]));
        s.set('u_cloudC', f32(cl ? cl.col : [1, 1, 1]));
        s.set('u_windL', f32(v3.scale(windB, p.wind)));
        s.set('u_wt', wt);
        // полярное сияние: ночью, в высоких (магнитных) широтах
        const lat = Math.abs(Math.asin(U.clamp(n0[2], -1, 1))) / DEG;
        const aur = p.aurora ? U.smoothstep(50, 64, lat) * U.smoothstep(-4, -12, Math.asin(U.clamp(sunL[2], -1, 1)) / DEG) : 0;
        s.set('u_aur', f32([aur * (this.auroraBoost || 1), sc.realTime, 0, 0]));
        // свечение ночного неба: ночью (звезда ниже −1…−12°), у всех тел с атмосферой; яркость — с запасом над
        // «носком» кривой ACES (иначе слабый слой тонет в чёрном)
        s.set('u_glow', f32(night > 0.001 && p.glow ? [...p.glow.col.map((c) => c * 0.0045 * p.glow.k * night), p.glow.alt] : [0, 0, 0, 0]));
        s.set('u_diff', f32(p.diff ? p.diff.map((d, i) => d * sunE[i] * U.smoothstep(-0.25, 0.1, sunL[2])) : [0, 0, 0]));
        this.setPlumes(s, p, n0, E, N, windB, sunL);
        gl.bindVertexArray(glc.emptyVAO); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        // ---- 2. наложение неба на сцену ----
        const dst = other(src);
        glc.bindTarget(dst); glc.noBlend();
        const c = this.progs.comp.use();
        c.tex('u_src', src.tex); c.tex('u_skyIn', sky.tIn); c.tex('u_skyT', sky.tT);
        c.set('u_veil', this.veil);
        glc.fullscreen();
        src = dst;
      } else if (this.vents.length) {
        // гейзеры без атмосферы — тоже через проход неба (только столбы)
        const sk = this.skyTargets(r);
        gl.bindFramebuffer(gl.FRAMEBUFFER, sk.fbo); gl.viewport(0, 0, sk.w, sk.h);
        glc.noBlend();
        const s = r.common(this.progs.sky);
        s.set('u_res', [sk.w, sk.h]);
        s.set('u_w2l', f32([Ew[0], Nw[0], Uw[0], Ew[1], Nw[1], Uw[1], Ew[2], Nw[2], Uw[2]]));
        s.set('u_l2b', f32([...E, ...N, ...n0])); s.set('u_camB', f32(P));
        s.set('u_camR', camR); s.set('u_Rg', Rg); s.set('u_Rt', Rg + 1);
        s.set('u_bR', f32([0, 0, 0])); s.set('u_bMs', f32([0, 0, 0])); s.set('u_bMa', f32([0, 0, 0])); s.set('u_bO', f32([0, 0, 0])); s.set('u_gM', f32([0.5, 0.5, 0.5]));
        s.set('u_H', f32([8000, 8000])); s.set('u_sunL', f32(sunL)); s.set('u_sunE', f32(sunE)); s.set('u_steps', 1);
        s.set('u_cloud', f32([0, 0, 0, 1])); s.set('u_aur', f32([0, 0, 0, 0])); s.set('u_glow', f32([0, 0, 0, 0])); s.set('u_wt', wt); s.set('u_diff', f32([0, 0, 0]));
        this.setPlumes(s, p, n0, E, N, windB, sunL);
        gl.bindVertexArray(glc.emptyVAO); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const dst = other(src);
        glc.bindTarget(dst); glc.noBlend();
        const c = this.progs.comp.use();
        c.tex('u_src', src.tex); c.tex('u_skyIn', sk.tIn); c.tex('u_skyT', sk.tT);
        c.set('u_veil', 1);
        glc.fullscreen();
        src = dst;
      }
      // ---- 3. ландшафт ----
      // 4x MSAA (Ультра/Среднее): сетка рисуется в мультисэмпловый буфер поверх копии неба, затем resolve —
      // горизонт и гребни без «лесенки»
      const ms = this.msaaTarget(r, src);
      if (ms) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, ms.fbo); gl.viewport(0, 0, ms.w, ms.h);
        glc.noBlend();
        const cp = this.progs.copy.use();
        cp.tex('u_src', src.tex);
        glc.fullscreen();
      } else glc.bindTarget(src);
      glc.noBlend();
      const t = this.progs.terrain.use();
      setTerr(t);
      t.set('u_NR', this.mesh.NR); t.set('u_NA', this.mesh.NA);
      // кольца: s(j) = s1·(e^(c·j) − 1)/c — у ног шаг s1 (≈ 0,25 м, решётка высот 0,5 м), к горизонту шаг плавно
      // растёт; c подбирается так, чтобы последнее кольцо легло на дальность горизонта smax
      const s1 = Math.max(0.25, (camAlt - hG) * 0.12);
      const reach = Math.max(p.relief * 1.2, 50);
      const smax = Math.max(Math.min(Math.sqrt(2 * R * Math.max(camAlt + reach, 5)) + Math.sqrt(2 * R * reach), R * Math.PI * 0.6), s1 * 20);
      const NRm = this.mesh.NR;
      let cLo = 1e-6, cHi = 3;
      for (let it = 0; it < 48; it++) { const cm = 0.5 * (cLo + cHi); if (s1 * Math.expm1(cm * NRm) / cm > smax) cHi = cm; else cLo = cm; }
      t.set('u_s1', s1); t.set('u_c', 0.5 * (cLo + cHi));
      // камера в картах граней куба (гномоника R·(x/z, y/z)) — в double, по модулю 4096 и 2^24 м: узлы решётки
      // рельефа считаются в шейдере относительно камеры без потери точности float32
      const fc = new Float32Array(24);
      for (let f = 0; f < 6; f++) {
        const c = toFace(n0, f);
        if (c[2] <= 0.1) continue;
        const u = R * c[0] / c[2], v = R * c[1] / c[2];
        const md = (x, m) => ((x % m) + m) % m;
        fc.set([md(u, 4096), md(v, 4096), md(u, 16777216), md(v, 16777216)], f * 4);
      }
      t.set('u_faceC', fc);
      t.set('u_n0', f32(n0)); t.set('u_E', f32(E)); t.set('u_Nn', f32(N));
      t.set('u_camAlt', camAlt); t.set('u_pmod', f32(pmod));
      const cr = r.cam.right, cu = r.cam.up, cb = v3.scale(r.cam.forward, -1);
      const axs = [ax.x, ax.y, ax.z];
      const b2v = [];
      for (let j = 0; j < 3; j++) b2v.push(v3.dot(cr, axs[j]), v3.dot(cu, axs[j]), v3.dot(cb, axs[j]));
      t.set('u_b2v', f32(b2v));
      t.set('u_proj', r.proj);
      t.set('u_shSteps', Tq.shadow ?? 6);
      t.set('u_pen', Math.max(p.sunAng, p.atm ? 0.01 : 0.003));
      const tc = b.tex ? r.texGet(b.tex, true) : null;
      t.tex('u_albMap', albMap); t.set('u_albK', 1);
      t.tex('u_tex', tc ? tc.tex : r.dummyTex);
      t.set('u_texP', f32([tc ? r.texFade(tc) : 0, tc ? tc.w : 1, p.texGain || 1, 0]));
      const lc = (c) => f32(c);
      t.set('u_col1', lc(p.col1)); t.set('u_col2', lc(p.col2)); t.set('u_col3', lc(p.col3));
      t.set('u_sunC', f32(sunC)); t.set('u_amb', f32((this._amb || [0, 0, 0]).map((a, i) => a + ambN[i])));
      t.set('u_upB', f32(n0)); t.set('u_parL', f32(parL)); t.set('u_parC', f32(parC));
      t.set('u_pixAng', 2 * r.tanHalf / r.height);
      t.set('u_time', sc.realTime); t.set('u_micro', Tq.micro ?? 1); t.set('u_microOct', Tq.microOct || 12);
      const sunUp = U.smoothstep(-0.05, 0.15, sunL[2]);
      t.set('u_ev', f32([p.frost, p.heat, 1, p.lava]));
      t.set('u_res', [r.width, r.height]);
      t.set('u_atm', f32([sky ? 1 : 0, Rg, Rt, camR]));
      t.set('u_b2l', f32([E[0], N[0], n0[0], E[1], N[1], n0[1], E[2], N[2], n0[2]]));
      if (sky) { t.tex('u_skyIn', sky.tIn); t.tex('u_skyT', sky.tT); } else { t.tex('u_skyIn', r.dummyTex); t.tex('u_skyT', r.dummyTex); }
      gl.bindVertexArray(this.mesh.vao);
      gl.drawElements(gl.TRIANGLES, this.mesh.count, this.mesh.type, 0);
      gl.bindVertexArray(null);
      if (ms) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, ms.fbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, src.fbo);
        gl.blitFramebuffer(0, 0, ms.w, ms.h, 0, 0, ms.w, ms.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
        glc.bindTarget(src);
      }
      // ---- 4. марево и пепел на раскалённых мирах (дневная сторона) ----
      const heat = p.shimmer * U.smoothstep(-0.05, 0.2, sunL[2]);
      const ash = p.ash * (p.style === 8 ? 1 : sunUp);
      if (heat > 0.01 || ash > 0.01) {
        const dst = other(src);
        glc.bindTarget(dst); glc.noBlend();
        const q = this.progs.post.use();
        q.tex('u_src', src.tex);
        q.set('u_time', sc.realTime); q.set('u_heat', heat); q.set('u_ash', ash); q.set('u_aspect', r.aspect); q.set('u_tanHalf', r.tanHalf);
        const upW = toWorld(ax, n0);
        q.set('u_upV', f32([v3.dot(cr, upW), v3.dot(cu, upW), v3.dot(cb, upW)]));
        glc.fullscreen();
        src = dst;
      }
      this.sunUp = sunUp;
      return src;
    }
    // гейзеры и пылевые вихри → массивы uniform столбов (локальные координаты относительно камеры)
    setPlumes(s, p, n0, E, N, windB, sunL) {
      const pl = new Float32Array(24), pc = new Float32Array(24);
      let i = 0;
      const t = this.app.scene.realTime;
      for (const v of this.vents || []) {
        if (i >= 6) break;
        const d = v3.sub(v3.scale(v.n, p.R), v3.scale(n0, p.R));
        // редкие выбросы: каждая струя активна ~40 % времени, вспышка нарастает и опадает
        const a = Math.pow(Math.max(0, Math.sin((t + v.ph) / v.per * Math.PI * 2)), 1.5);
        pl.set([v3.dot(d, E), v3.dot(d, N), v.h * (0.6 + 0.4 * a), v.w], i * 4);
        pc.set([...p.vents.col, a * (p.vents.dark ? 0.9 : 0.75)], i * 4);
        i++;
      }
      // пылевые вихри: у терминатора захваченных миров и днём на Марсе
      const el = Math.asin(U.clamp(sunL[2], -1, 1)) / DEG;
      const want = p.devils > 0 ? (p.wind > 50 ? U.smoothstep(-3, 2, el) * (1 - U.smoothstep(18, 30, el)) : U.smoothstep(10, 30, el)) * p.devils : 0;
      if (want > 0.01) {
        const rnd = this._drnd || (this._drnd = MW.rng.mulberry32(77));
        while (this.devils.length < 3) this.devils.push({ x: (rnd() - 0.5) * 6000, y: 800 + rnd() * 4000, h: 300 + rnd() * 900, w: 25 + rnd() * 50, life: 0, max: 20 + rnd() * 40 });
        const wE = v3.dot(windB, E), wN = v3.dot(windB, N), sp = Math.min(p.wind, 30);
        for (const dv of this.devils) {
          dv.life += 1 / 60;
          dv.x += wE * sp / 60; dv.y += wN * sp / 60;
          if (dv.life > dv.max || Math.hypot(dv.x, dv.y) > 9000) Object.assign(dv, { x: (rnd() - 0.5) * 6000, y: (rnd() - 0.2) * 5000, life: 0, max: 20 + rnd() * 40 });
          if (i >= 6) break;
          const fade = U.smoothstep(0, 3, dv.life) * (1 - U.smoothstep(dv.max - 3, dv.max, dv.life));
          pl.set([dv.x, dv.y, dv.h, dv.w], i * 4);
          pc.set([0.62, 0.45, 0.3, fade * want * 0.55], i * 4);
          i++;
        }
      }
      s.set('u_pl', pl); s.set('u_plC', pc);
    }
    // мультисэмпловый буфер того же формата, что и основной таргет (RGBA16F) — для resolve через blitFramebuffer
    msaaTarget(r, src) {
      const want = MW.Q.msaa || 0;
      if (!want || this._noMsaa || r.s.msaa === false) return null;
      const gl = r.gl;
      if (this.msT && this.msT.w === src.w && this.msT.h === src.h) return this.msT;
      if (this.msT) { gl.deleteFramebuffer(this.msT.fbo); gl.deleteRenderbuffer(this.msT.rb); this.msT = null; }
      const sup = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES);
      const n = sup && sup.length ? Math.min(want, Math.max(...sup)) : 0;
      if (n < 2) { this._noMsaa = true; return null; }
      const rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, n, gl.RGBA16F, src.w, src.h);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      if (!ok) { gl.deleteFramebuffer(fbo); gl.deleteRenderbuffer(rb); this._noMsaa = true; return null; }
      this.msT = { fbo, rb, w: src.w, h: src.h, samples: n };
      return this.msT;
    }
    queryHeight(r, n0, pmod) {
      const gl = r.gl, glc = r.glc;
      if (!this.qT) {
        const tex = glc.texture2D(8, 1, { internal: gl.RGBA32F, type: gl.FLOAT, filter: gl.NEAREST });
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const pbo = gl.createBuffer();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, 128, gl.STREAM_READ); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        this.qT = { tex, fbo, pbo, fence: null, buf: new Float32Array(32) };
      }
      const q = this.qT;
      // результат предыдущего запроса готов?
      if (q.fence) {
        const st = gl.clientWaitSync(q.fence, 0, 0);
        if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED) {
          gl.deleteSync(q.fence); q.fence = null;
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, q.pbo);
          gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, q.buf);
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
          if (Number.isFinite(q.buf[0])) {
            this.hG = q.buf[0]; this.lastHG = this.hG; this.hValid = true;
            // высота горизонта в сторону звезды: максимум угла на рельеф (с поправкой на кривизну)
            let hz = -90;
            const eye = q.cam;
            for (let i = 1; i < 8; i++) {
              const d = 30 * Math.pow(4, i - 1);
              hz = Math.max(hz, Math.atan2(q.buf[i * 4] - eye - d * d / (2 * this.prof.R), d) / DEG);
            }
            this.horizonSun = hz;
          }
        } else return;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, q.fbo); gl.viewport(0, 0, 8, 1);
      q.cam = v3.len(this.P) - this.prof.R;
      glc.noBlend();
      const pr = this.progs.query.use();
      this._setTerr(pr);
      pr.set('u_n0', f32(n0)); pr.set('u_pmod', f32(pmod));
      const sb = this._sunB || [1, 0, 0];
      let st = v3.sub(sb, v3.scale(n0, v3.dot(sb, n0)));
      st = v3.len(st) < 1e-6 ? v3.perp(n0) : v3.norm(st);
      pr.set('u_sunTan', f32(st));
      gl.bindVertexArray(glc.emptyVAO); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, q.pbo);
      gl.readPixels(0, 0, 8, 1, gl.RGBA, gl.FLOAT, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      q.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  MW.Surface = Surface;
  MW.surfaceProfile = profile;
})();
