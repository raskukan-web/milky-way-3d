'use strict';
/* =====================================================================
 *  Модель Млечного Пути: 4 логарифмических спиральных рукава + рукав
 *  Ориона, бар (перемычка), балдж, диск, пылевые полосы, гало, шаровые
 *  скопления. Также M31, Магеллановы Облака и звёзды скоплений.
 *  Частицы хранятся относительно центра своей системы (Float32).
 * ===================================================================== */
(function () {
  const MW = window.MW;
  const TAU = Math.PI * 2;
  const PITCH = 12.5 * MW.C.DEG, TANP = Math.tan(PITCH), SINP = Math.sin(PITCH);
  const R_REF = 21500;
  const BAR_ANGLE = Math.PI - 27 * MW.C.DEG;
  const ARMS = [
    { name: 'Рукав Стрельца–Киля', strength: 0.65, rStart: 9500 },
    { name: 'Рукав Щита–Центавра', strength: 1.0, rStart: 12500 },
    { name: 'Рукав Наугольника / Внешний', strength: 0.6, rStart: 9000 },
    { name: 'Рукав Персея', strength: 1.0, rStart: 12500 },
  ];
  const SUN_G = [-MW.C.GC_POS[0], -MW.C.GC_POS[1], -MW.C.GC_POS[2]]; // Солнце в системе центра Галактики

  const armPhi = (k, r) => Math.PI + k * Math.PI / 2 + Math.log(r / R_REF) / TANP;
  const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

  // Плавный 2D-шум (value noise) и векторное поле искажения координат в двух масштабах (domain warping):
  // рукава изгибаются, рвутся на звёздные облака и ветвятся вместо ровных «труб». Крупный масштаб
  // (~7000 св. лет, ±1100) меняет форму рукава, мелкий (~2200, ±380) рвёт его кромки. Положения рукавов
  // в среднем остаются прежними (модель Reid et al. 2019 / Vallée 2017).
  function hash2(i, j) { let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function vnoise2(x, y) {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
  }
  function warp0(x, y) {
    const s1 = 1 / 7000, s2 = 1 / 2200;
    return [1100 * vnoise2(x * s1 + 3.1, y * s1 + 7.7) + 380 * vnoise2(x * s2 + 11.3, y * s2 + 1.9),
            1100 * vnoise2(x * s1 + 17.2, y * s1 + 5.3) + 380 * vnoise2(x * s2 + 2.7, y * s2 + 13.4)];
  }
  // двухуровневое искажение (искажение искажённых координат) — вихревые изгибы, как у завихрённого поля
  function warp(x, y) {
    const w = warp0(x, y);
    const v = warp0(x + 0.6 * w[0], y + 0.6 * w[1]);
    // у ядра искажение гаснет: бар и балдж остаются ровными
    const k = MW.util.smoothstep(5000, 11000, Math.hypot(x, y));
    return [v[0] * k, v[1] * k];
  }

  // Плотность рукавов в точке (x,y — относительно центра Галактики)
  function armField(x0, y0) {
    const wv = warp(x0, y0);
    const x = x0 - wv[0], y = y0 - wv[1];
    const R = Math.hypot(x, y);
    if (R < 1) return { dens: 0, k: -1, perp: 1e9 };
    const phi = Math.atan2(y, x);
    const d0 = wrap(phi - armPhi(0, R));
    let q = Math.round(d0 / (Math.PI / 2));
    const dphi = d0 - q * Math.PI / 2;
    let k = ((q % 4) + 4) % 4;
    const perp = Math.abs(dphi) * R * SINP * 1.0;
    const arm = ARMS[k];
    const w = 1300 + R * 0.02;
    let dens = arm.strength * Math.exp(-(perp * perp) / (w * w)) * MW.util.smoothstep(arm.rStart * 0.75, arm.rStart * 1.1, R);
    // рукав Ориона (местный отрог)
    const dx = x - SUN_G[0], dy = y - SUN_G[1];
    const sp = wrap(Math.atan2(y, x) - Math.PI);
    const spurR = 26150 * Math.exp((sp - 0.04) * Math.tan(14 * MW.C.DEG));
    const spurPerp = Math.abs(R - spurR) * Math.cos(14 * MW.C.DEG);
    const spurLen = Math.exp(-Math.pow((sp - 0.08) / 0.32, 2));
    const spur = 0.45 * Math.exp(-(spurPerp * spurPerp) / (900 * 900)) * spurLen;
    if (spur > dens) { dens = spur; k = 4; }
    return { dens, k, perp, R, spur, dx, dy };
  }

  // Относительная звёздная плотность (1 ≈ окрестности Солнца). pos — мировые координаты (от Солнца)
  function stellarDensity(pos) {
    const x = pos[0] - MW.C.GC_POS[0], y = pos[1] - MW.C.GC_POS[1], z = pos[2] - MW.C.GC_POS[2];
    const R = Math.hypot(x, y);
    const af = armField(x, y);
    const disk = Math.exp(-(R - 26000) / 11000) * Math.exp(-Math.abs(z) / 900) * (0.55 + 0.9 * af.dens);
    const cb = Math.cos(BAR_ANGLE), sb = Math.sin(BAR_ANGLE);
    const bx = x * cb + y * sb, by = -x * sb + y * cb;
    const bar = 18 * Math.exp(-Math.sqrt((bx / 4500) ** 2 + (by / 1600) ** 2 + (z / 1300) ** 2));
    const nuc = 400 * Math.exp(-Math.hypot(x, y, z) / 120);
    const halo = 0.002 * Math.pow(1 + Math.hypot(x, y, z) / 3000, -3) * 30;
    const thick = 0.12 * Math.exp(-(R - 26000) / 12500) * Math.exp(-Math.abs(z) / 1150);
    return { rho: disk + thick + bar + nuc + halo, arm: af.dens, young: af.dens * Math.exp(-Math.abs(z) / 300) };
  }

  function buildMilkyWay(q) {
    const rnd = MW.rng.mulberry32(20261122);
    const g = rnd.gauss;
    const N = (n) => Math.round(n * q);
    const lum = [], dust = [];
    const push = (arr, x, y, z, r, gg, b, s) => arr.push(x, y, z, r, gg, b, s);
    const cb = Math.cos(BAR_ANGLE), sb = Math.sin(BAR_ANGLE);
    const coreFade = (x, y) => MW.util.smoothstep(1800, 5000, Math.hypot(x, y)); // пыль не перекрывает ядро
    const gas = [];

    // 1. Балдж и перемычка: компактный балдж, длинный плотный бар (~13 000 × 2 600 св. лет) и ядро —
    //    тёплые золотисто-кремовые старые звёзды с резким переходом в сине-белые рукава
    for (let i = 0, n = N(150000); i < n; i++) {
      let u, v, z;
      const t = rnd();
      if (t < 0.42) { u = g() * 2100; v = g() * 1350; z = g() * 1100; }
      else if (t < 0.9) { u = g() * 6600; v = g() * 640; z = g() * 430; }
      else {
        const r = -600 * Math.log(rnd() * rnd() + 1e-9);
        const th = Math.acos(2 * rnd() - 1), ph = rnd() * TAU;
        u = r * Math.sin(th) * Math.cos(ph); v = r * Math.sin(th) * Math.sin(ph) * 0.8; z = r * Math.cos(th) * 0.7;
      }
      const x = u * cb - v * sb, y = u * sb + v * cb;
      const rr = Math.hypot(u / 6600, v / 1350, z / 1100);
      const c = 0.85 + 0.15 * rnd();
      const br = 0.34 + 0.3 * Math.exp(-rr * 1.6);
      const warm = rnd() < 0.2 ? 0.82 : 1.0;
      push(lum, x, y, z, 1.0 * br * c, 0.8 * br * c * warm, 0.5 * br * c * warm * warm, 70 + 160 * rnd());
    }
    // 1b. Толстый диск: старые звёзды, гауссова высота σ≈1150 св. лет — мелкие точки, а не туман
    for (let i = 0, n = N(110000); i < n;) {
      const R = 1500 + (-12500 * Math.log(rnd() * rnd() + 1e-12));
      if (R > 70000) continue;
      i++;
      const ph = rnd() * TAU;
      const z = g() * (1150 + R * 0.012);
      const c = 0.85 + 0.15 * rnd();
      const br = 0.32 * (0.6 + 0.4 * rnd());
      push(lum, R * Math.cos(ph), R * Math.sin(ph), z, 1.0 * br * c, 0.86 * br * c, 0.7 * br * c, 110 + 200 * rnd());
    }
    // ядро: ядерное звёздное скопление
    for (let i = 0, n = N(6000); i < n; i++) {
      const r = -140 * Math.log(rnd() + 1e-9);
      const th = Math.acos(2 * rnd() - 1), ph = rnd() * TAU;
      push(lum, r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th) * 0.6, 0.6, 0.46, 0.3, 25 + 60 * rnd());
    }
    // 2. Тонкий диск с модуляцией рукавами (плотность — по искажённым рукавам)
    for (let i = 0, n = N(150000); i < n;) {
      const R = 2500 + (-10500 * Math.log(rnd() * rnd() + 1e-12));
      if (R > 72000) continue;
      const ph = rnd() * TAU;
      const x = R * Math.cos(ph), y = R * Math.sin(ph);
      const af = armField(x, y);
      if (rnd() > 0.12 + 0.88 * af.dens) continue;
      i++;
      const flare = 1 + Math.max(0, R - 30000) / 25000;
      const z = g() * 700 * flare;
      const t = af.dens;
      const r0 = 1.0 - 0.22 * t, g0 = 0.88 - 0.02 * t, b0 = 0.74 + 0.24 * t;
      const br = 0.38 * (0.5 + 0.5 * rnd());
      push(lum, x, y, z, r0 * br, g0 * br, b0 * br, 120 + 220 * rnd());
    }
    // 3. Рукава: точка на гребне рукава k на радиусе r — с искажением координат
    const armSample = (k) => {
      const a = ARMS[k];
      let r;
      do { r = a.rStart + (-15000 * Math.log(rnd() + 1e-12)); } while (r > 62000);
      return { r, phi: armPhi(k, r) };
    };
    const onArm = (k, r, off) => {
      const phi = armPhi(k, r), rr = r + off;
      const x = rr * Math.cos(phi), y = rr * Math.sin(phi);
      const w = warp(x, y);
      return [x + w[0], y + w[1]];
    };
    const pickArm = () => (rnd() < 0.62 ? (rnd() < 0.5 ? 1 : 3) : (rnd() < 0.5 ? 0 : 2));
    // 3a. Рассеянные молодые звёзды рукавов — мелкие резкие точки
    for (let i = 0, n = N(60000); i < n; i++) {
      const k = pickArm();
      const { r } = armSample(k);
      const [x, y] = onArm(k, r, (900 + r * 0.016) * g());
      const c = rnd();
      const br = (0.75 + 0.7 * rnd()) * ARMS[k].strength;
      push(lum, x + g() * 160, y + g() * 160, g() * 200, (0.62 + 0.25 * c) * br, (0.76 + 0.15 * c) * br, 1.0 * br, 70 + 130 * rnd());
    }
    // 3b. OB-ассоциации и звёздные облака вдоль гребней рукавов: плотные рои ярких голубых звёзд
    for (let a = 0, n = N(3200); a < n; a++) {
      const k = pickArm();
      const { r } = armSample(k);
      const [cx, cy] = onArm(k, r, g() * (500 + r * 0.008));
      const cz = g() * 90;
      const sz = 60 + 220 * rnd(), m = 10 + ((rnd() * 40) | 0);
      const rich = 1.4 + 1.6 * rnd();
      for (let j = 0; j < m; j++) {
        const c = rnd();
        push(lum, cx + g() * sz, cy + g() * sz, cz + g() * sz * 0.4, (0.66 + 0.2 * c) * rich, (0.8 + 0.12 * c) * rich, 1.1 * rich, 45 + 90 * rnd());
      }
    }
    // рукав Ориона
    for (let i = 0, n = N(9000); i < n; i++) {
      const sp = Math.PI + 0.08 + g() * 0.3;
      const R = 26150 * Math.exp((sp - Math.PI - 0.04) * Math.tan(14 * MW.C.DEG)) + g() * 700;
      push(lum, R * Math.cos(sp), R * Math.sin(sp), g() * 200, 0.6, 0.72, 1.0, 70 + 150 * rnd());
    }
    // 3c. Шпоры и перья: короткие ветви, отходящие от рукавов наружу под большим углом закрутки (~40–60°),
    //     со звёздами, узлами H II и пылью — как на снимках «Хаббла» и иллюстрации NASA/JPL (R. Hurt)
    const spurs = [];
    for (let k = 0; k < 4; k++) {
      const ns = Math.round(N(16) * (ARMS[k].strength > 0.8 ? 1.3 : 0.9));
      for (let s = 0; s < ns; s++) {
        const r0 = ARMS[k].rStart * 0.9 + rnd() * (52000 - ARMS[k].rStart);
        const tp = Math.tan((38 + 22 * rnd()) * MW.C.DEG);
        const len = 2500 + 6500 * rnd();
        spurs.push({ k, r0, phi0: armPhi(k, r0), tp, len, feather: rnd() < 0.45 });
      }
    }
    const spurPt = (sp, f) => {
      const r = sp.r0 + f * sp.len;
      const phi = sp.phi0 + Math.log(r / sp.r0) / sp.tp;
      const x = r * Math.cos(phi), y = r * Math.sin(phi);
      const w = warp(x, y);
      return [x + w[0], y + w[1], r];
    };
    for (const sp of spurs) {
      if (sp.feather) continue;
      const nst = Math.round(N(260) * sp.len / 6000);
      for (let i = 0; i < nst; i++) {
        const f = Math.pow(rnd(), 1.3);
        const [x, y] = spurPt(sp, f);
        const fade = 1 - 0.7 * f;
        const c = rnd(), br = (0.8 + 1.2 * rnd()) * fade;
        push(lum, x + g() * 140, y + g() * 140, g() * 120, (0.64 + 0.22 * c) * br, (0.78 + 0.14 * c) * br, 1.05 * br, 50 + 100 * rnd());
      }
    }
    // 4. Области H II: сотни компактных рубиново-розовых узлов вдоль гребней рукавов и на шпорах.
    //    Цвет насыщенный (мало зелёного), яркость умеренная — при сложении узлы не выгорают в белый.
    const hii = (cx, cy, cz, w) => {
      const sz = 90 + 180 * rnd();
      push(gas, cx, cy, cz, 1.1 * w, 0.12 * w, 0.62 * w, sz * 2.0);
      const m = 10 + ((rnd() * 12) | 0);
      for (let j = 0; j < m; j++) push(lum, cx + g() * sz * 0.4, cy + g() * sz * 0.4, cz + g() * sz * 0.2, 2.4 * w, 0.3 * w, 1.5 * w, 60 + 90 * rnd());
      for (let j = 0, nb = 2 + ((rnd() * 4) | 0); j < nb; j++) push(lum, cx + g() * sz * 0.35, cy + g() * sz * 0.35, cz + g() * 25, 1.8, 2.1, 2.8, 22 + 30 * rnd());
    };
    for (let c = 0, n = N(780); c < n; c++) {
      const k = pickArm();
      const { r } = armSample(k);
      const [cx, cy] = onArm(k, r, 260 + g() * 260);
      hii(cx, cy, g() * 70, 0.7 + 0.8 * rnd());
    }
    for (const sp of spurs) {
      if (sp.feather) continue;
      for (let j = 0, nh = 1 + ((rnd() * 4) | 0); j < nh; j++) { const [x, y] = spurPt(sp, rnd() * 0.7); hii(x, y, g() * 60, 0.6 + 0.6 * rnd()); }
    }
    // 5. Пыль. Общая клочковатая пыль диска (немного — без мутной пелены)
    for (let i = 0, n = N(30000); i < n;) {
      const R = 2500 + (-10500 * Math.log(rnd() * rnd() + 1e-12));
      if (R > 60000) continue;
      i++;
      const ph = rnd() * TAU, x = R * Math.cos(ph), y = R * Math.sin(ph);
      const o = (0.02 + 0.04 * rnd() * rnd()) * coreFade(x, y);
      push(dust, x + g() * 300, y + g() * 300, g() * 180, o * 0.75, o, o * 1.35, 250 + 300 * rnd());
    }
    // 5a. Тонкие резкие ветвящиеся прожилки пыли по внутренним (вогнутым) кромкам рукавов — тёмно-бурые
    //     (сильнее поглощают синий), «прорезают» светящиеся звёздные поля
    const lane = (x0, y0, z0, dirx, diry, steps, o0, w0) => {
      let x = x0, y = y0, dx = dirx, dy = diry, o = o0;
      for (let s = 0; s < steps; s++) {
        const ang = g() * 0.12; const ca = Math.cos(ang), sa = Math.sin(ang);
        const ndx = dx * ca - dy * sa, ndy = dx * sa + dy * ca; dx = ndx; dy = ndy;
        x += dx * 85; y += dy * 85;
        const cf = coreFade(x, y);
        const oo = o * (0.6 + 0.6 * rnd()) * cf;
        if (oo > 0.004) {
          // тёмно-бурый тон: синий поглощается сильнее всего, красный — слабее
          push(dust, x + g() * 25, y + g() * 25, z0 + g() * 25, oo * 0.36, oo * 0.68, oo * 1.4, w0 * (0.7 + 0.6 * rnd()));
          push(dust, x + dx * 42, y + dy * 42, z0 + g() * 25, oo * 0.36, oo * 0.68, oo * 1.4, w0 * (0.7 + 0.6 * rnd()));
          // второй, более узкий жгут рядом — полоса выглядит волокнистой, а не ровной
          const px = -dy, py = dx, so = w0 * (0.5 + 0.4 * rnd()) * (rnd() < 0.5 ? 1 : -1);
          if (rnd() < 0.4) push(dust, x + px * so, y + py * so, z0 + g() * 25, oo * 0.25, oo * 0.48, oo * 1.0, w0 * (0.4 + 0.4 * rnd()));
        }
        // ветвление
        if (rnd() < 0.025 && steps - s > 8) lane(x, y, z0, dx * 0.7 - dy * 0.7 * (rnd() < 0.5 ? 1 : -1), dy * 0.7 + dx * 0.7, (steps - s) >> 1, o * 0.7, w0 * 0.8);
      }
    };
    for (let l = 0, nl = N(2200); l < nl; l++) {
      const k = pickArm();
      const { r } = armSample(k);
      const off = -560 - Math.abs(g()) * 300;
      const [x0, y0] = onArm(k, r, off);
      const [x1, y1] = onArm(k, r + 120, off);
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      lane(x0, y0, g() * 50, (x1 - x0) / len, (y1 - y0) / len, 20 + ((rnd() * 45) | 0), 0.2 + 0.22 * rnd(), 170 + 130 * rnd());
    }
    // 5b. Пылевые «перья»: тонкие тёмные полосы, отходящие от пылевой кромки наружу поперёк рукава
    for (const sp of spurs) {
      const steps = Math.round(sp.len / 70);
      for (let s = 0; s < steps; s++) {
        const f = s / steps;
        const [x, y] = spurPt(sp, f);
        const o = (sp.feather ? 0.32 : 0.2) * (1 - f) * (0.6 + 0.6 * rnd()) * coreFade(x, y);
        if (o > 0.004) push(dust, x + g() * 30, y + g() * 30, g() * 30, o * 0.36, o * 0.68, o * 1.4, 140 + 110 * rnd());
      }
    }
    // реальные пылевые комплексы вокруг Солнца: [l°, b°, расстояние св. лет, протяжённость по l°, по b°, число сгустков]
    const LOCAL_CLOUDS = [
      [75, 1, 2200, 26, 4, 70],    // Великий разлом Лебедя
      [30, 3, 850, 22, 8, 60],     // разлом Орла
      [355, 17, 450, 12, 9, 40],   // облака ρ Змееносца
      [0, 5, 450, 9, 3, 25],       // туманность Трубка
      [172, -15, 450, 16, 11, 45], // облака Тельца
      [210, -19, 1350, 12, 9, 40], // молекулярные облака Ориона A/B
      [301, -1, 600, 6, 5, 25],    // Угольный Мешок
      [340, 12, 500, 11, 7, 30],   // облака Волка
      [300, -16, 520, 8, 6, 20],   // облака Хамелеона
      [160, -20, 1000, 7, 5, 22],  // облако Персея
      [110, 15, 1000, 11, 7, 25],  // «вспышка» Цефея
    ];
    for (const [L0, B0, D0, wl, wb, cnt] of LOCAL_CLOUDS) {
      for (let c = 0; c < cnt; c++) {
        const l = (L0 + g() * wl * 0.45) * MW.C.DEG, b = (B0 + g() * wb * 0.45) * MW.C.DEG, d = D0 * (0.85 + 0.3 * rnd());
        const wx = d * Math.cos(b) * Math.cos(l), wy = d * Math.cos(b) * Math.sin(l), wz = d * Math.sin(b);
        const cx = wx - MW.C.GC_POS[0], cy = wy - MW.C.GC_POS[1], cz = wz - MW.C.GC_POS[2];
        const dens = 0.35 + 0.65 * Math.pow(rnd(), 1.2);
        const sz = d * 0.035;
        for (let j = 0; j < 7; j++) {
          const o = dens * (0.5 + 0.8 * rnd());
          push(dust, cx + g() * sz * 1.4, cy + g() * sz * 1.4, cz + g() * sz * 0.6, o * 0.75, o * 0.92, o * 1.3, sz * (0.7 + 0.8 * rnd()));
        }
      }
    }
    // 5c. Пылевые полосы на ведущих кромках бара: тонкие, резкие, тёмно-бурые, с ответвлениями
    for (const s of [1, -1]) {
      for (let l = 0; l < N(60); l++) {
        const u0 = (rnd() * 2 - 1) * 8500;
        const v0 = s * (1250 + Math.abs(u0) * 0.07) + g() * 150;
        const f = MW.util.smoothstep(1500, 4000, Math.abs(u0));
        if (f < 0.05) continue;
        const x0 = u0 * cb - v0 * sb, y0 = u0 * sb + v0 * cb;
        const dir = rnd() < 0.5 ? 1 : -1;
        lane(x0, y0, g() * 40, cb * dir, sb * dir, 20 + ((rnd() * 30) | 0), (0.3 + 0.3 * rnd()) * f, 180 + 140 * rnd());
      }
    }
    // 6. Подложка светящегося газа — заметно слабее и мельче (без мутной пелены): сапфировый газ гребней
    //    рукавов и золотистое свечение бара
    for (let i = 0, n = N(9000); i < n; i++) {
      const k = pickArm();
      const { r } = armSample(k);
      const [x, y] = onArm(k, r, g() * 500);
      const c = rnd();
      const b = (0.12 + 0.08 * rnd()) * ARMS[k].strength;
      push(gas, x + g() * 200, y + g() * 200, g() * 200, (0.3 + 0.2 * c) * b, (0.55 + 0.2 * c) * b, 1.0 * b, 450 + 600 * rnd());
    }
    for (let i = 0, n = N(4000); i < n; i++) {
      const u = g() * 4200, v = g() * 1100, z = g() * 900;
      const b = 0.2 + 0.15 * rnd();
      push(gas, u * cb - v * sb, u * sb + v * cb, z, 1.0 * b, 0.72 * b, 0.38 * b, 900 + 1200 * rnd());
    }
    // 7. Сферическое гало: старые звёзды, плотность ∝ r⁻³ (3 000 … 95 000 св. лет), без сплющивания
    // (гало и шаровые скопления — отдельный буфер: их яркость зависит от того, смотрим ли мы на Галактику снаружи)
    const halo = [];
    const sphere = (r) => { const ct = 2 * rnd() - 1, st = Math.sqrt(1 - ct * ct), ph = rnd() * TAU; return [r * st * Math.cos(ph), r * st * Math.sin(ph), r * ct]; };
    for (let i = 0, n = N(26000); i < n; i++) {
      const r = 4000 * Math.pow(95000 / 4000, Math.pow(rnd(), 1.15));
      const [x, y, z] = sphere(r);
      const k = 1.6 + 4 * rnd() * rnd();
      push(halo, x, y, z, k, k * 0.84, k * 0.6, 60 + 110 * rnd());
    }
    // 72 шаровых скопления: компактные сгустки старых звёзд, в основном высоко над и под диском
    const globs = [];
    for (let c = 0; c < 72; c++) {
      const r = 6000 * Math.pow(85000 / 6000, Math.pow(rnd(), 1.4));
      let p;
      do { p = sphere(r); } while (Math.abs(p[2]) < r * 0.3 && rnd() < 0.75);
      const Rc = 35 + 70 * rnd();
      globs.push({ pos: [p[0] + MW.C.GC_POS[0], p[1] + MW.C.GC_POS[1], p[2] + MW.C.GC_POS[2]], radius: Rc });
      push(halo, p[0], p[1], p[2], 60, 50, 36, Rc * 1.4);
      for (let j = 0; j < 90; j++) {
        const u = Math.max(rnd(), 1e-3);
        const rr = Math.min(Rc * 0.25 / Math.sqrt(Math.pow(u, -2 / 3) - 1), Rc * 2);
        const q2 = sphere(rr);
        const w = 0.9 + 0.6 * rnd();
        push(halo, p[0] + q2[0], p[1] + q2[1], p[2] + q2[2], 30 * w, 26 * w, 19 * w, 3 + 6 * rnd());
      }
    }
    MW.galaxy.globulars = globs;
    return { lum: new Float32Array(lum), dust: new Float32Array(dust), halo: new Float32Array(halo), gas: new Float32Array(gas) };
  }

  // Спиральная галактика (M31, M33) в локальной системе диска (z — нормаль)
  function buildSpiral(seed, R, n, q, opts = {}) {
    const rnd = MW.rng.mulberry32(seed), g = rnd.gauss;
    const lum = [], dust = [];
    const tp = Math.tan((opts.pitch || 19) * MW.C.DEG);
    const bulge = opts.bulge === undefined ? 0.3 : opts.bulge;
    const floc = opts.flocculent || 0;
    const sk = opts.sizeK || 1;
    for (let i = 0, m = Math.round(n * bulge * q); i < m; i++) {
      const r = -R * 0.06 * Math.log(rnd() * rnd() + 1e-9);
      const th = Math.acos(2 * rnd() - 1), ph = rnd() * TAU;
      const b = 0.7 + 0.8 * Math.exp(-r / (R * 0.03));
      lum.push(r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th) * 0.65, b, 0.8 * b, 0.55 * b, (R * 0.005 + R * 0.007 * rnd()) * sk);
    }
    for (let i = 0, m = Math.round(n * (1 - bulge) * q); i < m; i++) {
      const arm = rnd() < 0.5 ? 0 : 1;
      let r = R * 0.12 + (-R * 0.22 * Math.log(rnd() + 1e-9));
      if (r > R * 1.1) r = R * rnd();
      const inArm = rnd() < 0.6;
      const ph = inArm ? arm * Math.PI + Math.log(r / (R * 0.12)) / tp + g() * (0.22 + floc) + 0.25 * Math.sin(r / R * 9 + arm) : rnd() * TAU;
      const x = r * Math.cos(ph), y = r * Math.sin(ph), z = g() * R * 0.012;
      if (inArm && opts.dust !== false && rnd() < 0.4) dust.push(x * 0.97, y * 0.97, z * 0.5, 0.1, 0.16, 0.26, (R * 0.006 + R * 0.006 * rnd()) * sk);
      const blue = inArm ? 0.25 + 0.5 * rnd() : 0;
      const b = (inArm ? 0.85 : 0.45) * (0.6 + 0.6 * rnd());
      lum.push(x, y, z, (1 - 0.35 * blue) * b, (0.88 - 0.05 * blue) * b, (0.72 + 0.35 * blue) * b, (R * 0.004 + R * 0.007 * rnd()) * sk);
      if (inArm && rnd() < 0.04) lum.push(x, y, z, 1.6, 0.25, 1.0, R * 0.003 * sk);
    }
    return { lum: new Float32Array(lum), dust: new Float32Array(dust) };
  }

  // Эллиптическая / карликовая сфероидальная галактика (трёхосный профиль, старые звёзды)
  function buildElliptical(seed, R, n, q, axes, faint) {
    const rnd = MW.rng.mulberry32(seed);
    const lum = [];
    const a = axes || [1, 0.8, 0.7];
    for (let i = 0, m = Math.round(n * q); i < m; i++) {
      const r = -R * 0.28 * Math.log(rnd() * rnd() + 1e-9);
      if (r > R * 1.6) continue;
      const ct = 2 * rnd() - 1, st = Math.sqrt(1 - ct * ct), ph = rnd() * TAU;
      const b = (faint ? 0.35 : 0.8) * (0.6 + 0.6 * rnd()) * (1 + 1.5 * Math.exp(-r / (R * 0.08)));
      lum.push(r * st * Math.cos(ph) * a[0], r * st * Math.sin(ph) * a[1], r * ct * a[2], b, 0.84 * b, 0.6 * b, R * (faint ? 0.012 : 0.006) + R * 0.01 * rnd());
    }
    return { lum: new Float32Array(lum), dust: new Float32Array(0) };
  }

  // Неправильная галактика с баром (Магеллановы Облака)
  function buildIrregular(seed, R, n, q, barFrac) {
    const rnd = MW.rng.mulberry32(seed), g = rnd.gauss;
    const lum = [];
    for (let i = 0, m = Math.round(n * q); i < m; i++) {
      let x, y, z;
      if (rnd() < barFrac) { x = g() * R * 0.35; y = g() * R * 0.09; z = g() * R * 0.08; }
      else { const r = -R * 0.35 * Math.log(rnd() + 1e-9); const ph = rnd() * TAU + 0.6 * Math.sin(r / R * 4); x = r * Math.cos(ph) * 1.15; y = r * Math.sin(ph); z = g() * R * 0.12; }
      const blue = rnd() < 0.35 ? 0.6 : 0.1;
      const b = 0.6 + 0.6 * rnd();
      lum.push(x, y, z, (1 - 0.3 * blue) * b, (0.88 - 0.02 * blue) * b, (0.75 + 0.35 * blue) * b, R * 0.007 + R * 0.014 * rnd());
    }
    // туманность Тарантул (только в БМО — barFrac > 0.3)
    if (barFrac > 0.3) for (let i = 0; i < 400 * q; i++) lum.push(R * 0.32 + g() * R * 0.03, R * 0.12 + g() * R * 0.03, g() * R * 0.02, 2.4, 0.7, 0.9, R * 0.012 + R * 0.01 * rnd());
    return { lum: new Float32Array(lum), dust: new Float32Array(0) };
  }

  // Звёзды шарового скопления (профиль Пламмера): [x,y,z, r,g,b, absMag]
  function buildGlobular(seed, R, n) {
    const rnd = MW.rng.mulberry32(seed);
    const stars = [], glow = [];
    const a = R * 0.18;
    for (let i = 0; i < n; i++) {
      const u = Math.max(rnd(), 1e-4);
      let r = a / Math.sqrt(Math.pow(u, -2 / 3) - 1);
      if (r > R * 1.4) r = R * 1.4 * rnd();
      const th = Math.acos(2 * rnd() - 1), ph = rnd() * TAU;
      const x = r * Math.sin(th) * Math.cos(ph), y = r * Math.sin(th) * Math.sin(ph), z = r * Math.cos(th);
      const t = rnd();
      let T, M;
      if (t < 0.04) { T = 3900 + 600 * rnd(); M = -2.5 + 2 * rnd(); }      // красные гиганты
      else if (t < 0.07) { T = 9000 + 3000 * rnd(); M = 0.3 + 0.8 * rnd(); } // голубая ветвь
      else { T = 5200 + 1300 * rnd(); M = 3 + 3 * rnd(); }
      const c = MW.color.blackbody(T);
      stars.push(x, y, z, c[0], c[1], c[2], M);
      if (i % 12 === 0) glow.push(x, y, z, 1.0, 0.9, 0.72, R * 0.12);
    }
    return { stars: new Float32Array(stars), glow: new Float32Array(glow) };
  }
  // Рассеянное скопление (молодые звёзды)
  function buildOpenCluster(seed, R, n, young) {
    const rnd = MW.rng.mulberry32(seed), g = rnd.gauss;
    const stars = [];
    for (let i = 0; i < n; i++) {
      const x = g() * R * 0.5, y = g() * R * 0.5, z = g() * R * 0.5;
      const t = Math.pow(rnd(), young ? 2.2 : 1.6);
      const T = young ? 3400 + 16000 * (1 - t) : 3300 + 5000 * (1 - t);
      const M = young ? -1 + 11 * t : 0.5 + 10 * t;
      const c = MW.color.blackbody(T);
      stars.push(x, y, z, c[0], c[1], c[2], M);
    }
    return new Float32Array(stars);
  }

  // Подписи рукавов (позиции в мировых координатах)
  function armLabels() {
    const out = [];
    const spots = [[3, 0.9], [1, 0.75], [0, 0.95], [2, 0.6], [3, 0.35], [1, 0.25]];
    for (const [k, f] of spots) {
      const r = 14000 + f * 30000;
      const ph = armPhi(k, r);
      out.push({ name: ARMS[k].name, pos: [MW.C.GC_POS[0] + r * Math.cos(ph), MW.C.GC_POS[1] + r * Math.sin(ph), MW.C.GC_POS[2]] });
    }
    out.push({ name: 'Рукав Ориона (Местный)', pos: [MW.C.GC_POS[0] - 26150 * Math.cos(0.3), MW.C.GC_POS[1] - 26150 * Math.sin(0.3), MW.C.GC_POS[2]] });
    out.push({ name: 'Центральная перемычка (бар)', pos: [MW.C.GC_POS[0] + 9000 * Math.cos(BAR_ANGLE), MW.C.GC_POS[1] + 9000 * Math.sin(BAR_ANGLE), MW.C.GC_POS[2]] });
    return out;
  }

  MW.galaxy = { buildMilkyWay, buildSpiral, buildIrregular, buildElliptical, buildGlobular, buildOpenCluster, stellarDensity, armField, armLabels, ARMS, BAR_ANGLE };
})();
