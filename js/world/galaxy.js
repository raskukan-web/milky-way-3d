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

  // Плотность рукавов в точке (x,y — относительно центра Галактики)
  function armField(x, y) {
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
    const coreFade = (x, y) => MW.util.smoothstep(3500, 8000, Math.hypot(x, y)); // пыль не перекрывает ядро
    const gas = [];

    // 1. Балдж: трёхосный эллипсоид ~10 000 × 6 000 × 5 000 св. лет (σ = 2500/1500/1250),
    //    длинный бар и ядро — плотные золотистые старые звёзды
    for (let i = 0, n = N(120000); i < n; i++) {
      let u, v, z;
      const t = rnd();
      if (t < 0.6) { u = g() * 2500; v = g() * 1500; z = g() * 1250; }
      else if (t < 0.86) { u = g() * 5200; v = g() * 850; z = g() * 520; }
      else {
        const r = -650 * Math.log(rnd() * rnd() + 1e-9);
        const th = Math.acos(2 * rnd() - 1), ph = rnd() * TAU;
        u = r * Math.sin(th) * Math.cos(ph); v = r * Math.sin(th) * Math.sin(ph) * 0.8; z = r * Math.cos(th) * 0.7;
      }
      const x = u * cb - v * sb, y = u * sb + v * cb;
      const rr = Math.hypot(u / 2500, v / 1500, z / 1250);
      const c = 0.8 + 0.2 * rnd();
      const br = 0.3 + 0.22 * Math.exp(-rr * 1.2);
      const warm = rnd() < 0.15 ? 0.85 : 1.0;
      push(lum, x, y, z, 1.0 * br * c, 0.8 * br * c * warm, 0.5 * br * c * warm, 90 + 230 * rnd());
    }
    // 1b. Толстый диск: старые звёзды, гауссова высота σ≈1150 св. лет (до ~3500 над/под плоскостью)
    for (let i = 0, n = N(130000); i < n;) {
      const R = 1500 + (-12500 * Math.log(rnd() * rnd() + 1e-12));
      if (R > 70000) continue;
      i++;
      const ph = rnd() * TAU;
      const z = g() * (1150 + R * 0.012);
      const c = 0.85 + 0.15 * rnd();
      const br = 0.75 * (0.6 + 0.4 * rnd());
      push(lum, R * Math.cos(ph), R * Math.sin(ph), z, 1.0 * br * c, 0.86 * br * c, 0.66 * br * c, 160 + 300 * rnd());
    }
    // ядро: ядерное звёздное скопление
    for (let i = 0, n = N(6000); i < n; i++) {
      const r = -140 * Math.log(rnd() + 1e-9);
      const th = Math.acos(2 * rnd() - 1), ph = rnd() * TAU;
      push(lum, r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th) * 0.6, 0.55, 0.42, 0.3, 25 + 60 * rnd());
    }
    // 2. Тонкий диск с модуляцией рукавами
    for (let i = 0, n = N(170000); i < n;) {
      const R = 2500 + (-10500 * Math.log(rnd() * rnd() + 1e-12));
      if (R > 72000) continue;
      const ph = rnd() * TAU;
      const x = R * Math.cos(ph), y = R * Math.sin(ph);
      const af = armField(x, y);
      if (rnd() > 0.3 + 0.7 * af.dens) continue;
      i++;
      const flare = 1 + Math.max(0, R - 30000) / 25000;
      const z = g() * 700 * flare;
      const t = af.dens;
      const r0 = 1.0 - 0.2 * t, g0 = 0.88 - 0.02 * t, b0 = 0.74 + 0.22 * t;
      const br = 0.42 * (0.6 + 0.4 * rnd());
      push(lum, x, y, z, r0 * br, g0 * br, b0 * br, 240 + 380 * rnd());
      if (rnd() < 0.22) { // общая диффузная пыль диска (клочковатая)
        const o = 0.025 + 0.05 * rnd() * rnd();
        push(dust, x + g() * 300, y + g() * 300, g() * 180, o * 0.85, o, o * 1.3, 300 + 400 * rnd());
      }
    }
    // 3. Молодые голубые звёзды, H II и пыль вдоль рукавов
    const armSample = (k) => {
      const a = ARMS[k];
      let r;
      do { r = a.rStart + (-15000 * Math.log(rnd() + 1e-12)); } while (r > 62000);
      return { r, phi: armPhi(k, r) };
    };
    for (let i = 0, n = N(120000); i < n; i++) {
      const k = rnd() < 0.62 ? (rnd() < 0.5 ? 1 : 3) : (rnd() < 0.5 ? 0 : 2);
      const { r, phi } = armSample(k);
      const w = (650 + r * 0.012) * g();
      const rr = r + w;
      const x = rr * Math.cos(phi) + g() * 220, y = rr * Math.sin(phi) + g() * 220, z = g() * 230;
      const c = rnd();
      const br = (0.7 + 0.6 * rnd()) * ARMS[k].strength;
      push(lum, x, y, z, (0.62 + 0.25 * c) * br, (0.76 + 0.15 * c) * br, 1.0 * br, 110 + 260 * rnd());
    }
    // рукав Ориона
    for (let i = 0, n = N(9000); i < n; i++) {
      const sp = Math.PI + 0.08 + g() * 0.3;
      const R = 26150 * Math.exp((sp - Math.PI - 0.04) * Math.tan(14 * MW.C.DEG)) + g() * 700;
      push(lum, R * Math.cos(sp), R * Math.sin(sp), g() * 200, 0.55, 0.68, 0.95, 90 + 200 * rnd());
    }
    // H II области (розовые узлы) и OB-ассоциации
    for (let i = 0, n = N(7000); i < n; i++) {
      const k = rnd() < 0.6 ? (rnd() < 0.5 ? 1 : 3) : (rnd() < 0.5 ? 0 : 2);
      const { r, phi } = armSample(k);
      const rr = r + 350 + g() * 450;
      const x = rr * Math.cos(phi), y = rr * Math.sin(phi), z = g() * 120;
      const br = 1.1 + 1.2 * rnd();
      push(lum, x, y, z, 1.0 * br, 0.32 * br, 0.45 * br, 60 + 200 * rnd());
      if (rnd() < 0.5) push(lum, x + g() * 150, y + g() * 150, z + g() * 60, 1.5, 1.8, 2.6, 15 + 30 * rnd());
    }
    for (let i = 0, n = N(16000); i < n; i++) {
      const k = (rnd() * 4) | 0;
      const { r, phi } = armSample(k);
      const rr = r + g() * 600;
      push(lum, rr * Math.cos(phi) + g() * 300, rr * Math.sin(phi) + g() * 300, g() * 150, 2.2, 2.5, 3.2, 12 + 30 * rnd());
    }
    // пылевые полосы по внутренней (вогнутой) кромке рукавов — клочковатые облака
    for (let c = 0, nc = N(6500); c < nc; c++) {
      const k = rnd() < 0.6 ? (rnd() < 0.5 ? 1 : 3) : (rnd() < 0.5 ? 0 : 2);
      const { r, phi } = armSample(k);
      const rr = r - 700 - Math.abs(g()) * 500;
      const cx = rr * Math.cos(phi) + g() * 300, cy = rr * Math.sin(phi) + g() * 300, cz = g() * 110;
      const dens = Math.pow(rnd(), 1.8);
      const m = 6 + ((rnd() * 10) | 0);
      const cf = coreFade(cx, cy);
      for (let j = 0; j < m; j++) {
        const o = (0.05 + 0.25 * dens) * (0.5 + rnd()) * cf;
        push(dust, cx + g() * 260, cy + g() * 260, cz + g() * 70, o * 0.65, o * 0.85, o * 1.25, 120 + 300 * rnd());
      }
    }
    // ветвящиеся тёмные прожилки пыли вдоль внутренних кромок рукавов (затухают к ядру балджа)
    for (let l = 0, nl = N(1700); l < nl; l++) {
      const k = rnd() < 0.62 ? (rnd() < 0.5 ? 1 : 3) : (rnd() < 0.5 ? 0 : 2);
      let { r } = armSample(k);
      let off = -650 - Math.abs(g()) * 350, zc = g() * 60;
      const steps = 20 + ((rnd() * 30) | 0), dr = (rnd() < 0.5 ? 1 : -1) * (90 + 60 * rnd());
      const o0 = 0.12 + 0.22 * rnd();
      for (let s = 0; s < steps; s++) {
        r += dr * 0.35; off += g() * 45;
        const phi = armPhi(k, r) + (dr * s * 0.0) / r;
        const rr = r + off;
        const x = rr * Math.cos(phi) + g() * 40, y = rr * Math.sin(phi) + g() * 40;
        const o = o0 * (0.6 + 0.6 * rnd()) * coreFade(x, y);
        if (o > 0.004) push(dust, x, y, zc + g() * 35, o * 0.55, o * 0.8, o * 1.25, 70 + 140 * rnd());
        // ответвление (шпора) наружу от рукава
        if (rnd() < 0.05) { let bo = off; for (let b = 0; b < 8; b++) { bo += 90 + 40 * rnd(); const xb = (r + bo) * Math.cos(phi + b * 0.004), yb = (r + bo) * Math.sin(phi + b * 0.004); push(dust, xb, yb, zc, o * 0.45, o * 0.65, o * 1.0, 60 + 90 * rnd()); } }
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
    // пылевые полосы на ведущих кромках бара
    for (let i = 0, n = N(9000); i < n; i++) {
      const s = rnd() < 0.5 ? 1 : -1;
      const u = (rnd() * 2 - 1) * 9000;
      const v = s * (1400 + Math.abs(u) * 0.08) + g() * 250;
      const f = MW.util.smoothstep(1500, 4500, Math.abs(u));   // в самом ядре полосы плавно гаснут
      if (f > 0.01) push(dust, u * cb - v * sb, u * sb + v * cb, g() * 120, 0.16 * f, 0.2 * f, 0.26 * f, 220 + 250 * rnd());
    }
    // 3b. Подложка светящегося газа: сапфировый газ рукавов, золотое свечение балджа — единый вихрь
    for (let i = 0, n = N(24000); i < n; i++) {
      const k = rnd() < 0.62 ? (rnd() < 0.5 ? 1 : 3) : (rnd() < 0.5 ? 0 : 2);
      const { r, phi } = armSample(k);
      const rr = r + g() * 900;
      const c = rnd();
      const b = (0.16 + 0.1 * rnd()) * ARMS[k].strength;
      push(gas, rr * Math.cos(phi) + g() * 400, rr * Math.sin(phi) + g() * 400, g() * 320, (0.3 + 0.2 * c) * b, (0.55 + 0.2 * c) * b, 1.0 * b, 900 + 1100 * rnd());
    }
    for (let i = 0, n = N(5000); i < n; i++) {
      const u = g() * 3000, v = g() * 1700, z = g() * 1300;
      const b = 0.2 + 0.15 * rnd();
      push(gas, u * cb - v * sb, u * sb + v * cb, z, 1.0 * b, 0.68 * b, 0.32 * b, 1400 + 1800 * rnd());
    }
    for (let i = 0, n = N(6000); i < n;) {
      const R = 3000 + (-12000 * Math.log(rnd() * rnd() + 1e-12));
      if (R > 60000) continue;
      i++;
      const ph = rnd() * TAU, b = 0.05 + 0.04 * rnd();
      push(gas, R * Math.cos(ph), R * Math.sin(ph), g() * 600, 0.75 * b, 0.72 * b, 0.8 * b, 1500 + 1500 * rnd());
    }
    // десятки ярких розово-пурпурных облаков H II вдоль рукавов
    for (let c = 0; c < 110; c++) {
      const k = rnd() < 0.65 ? (rnd() < 0.5 ? 1 : 3) : (rnd() < 0.5 ? 0 : 2);
      const { r, phi } = armSample(k);
      const rr = r + 300 + g() * 350;
      const cx = rr * Math.cos(phi), cy = rr * Math.sin(phi), cz = g() * 90;
      const sz = 150 + 300 * rnd(), w = 1.2 + 1.6 * rnd();
      push(gas, cx, cy, cz, 0.9 * w, 0.18 * w, 0.55 * w, sz * 2.4);
      for (let j = 0; j < 28; j++) push(lum, cx + g() * sz * 0.5, cy + g() * sz * 0.5, cz + g() * sz * 0.25, 2.2 * w, 0.5 * w, 1.3 * w, 20 + sz * 0.3 * rnd());
      for (let j = 0; j < 6; j++) push(lum, cx + g() * sz * 0.4, cy + g() * sz * 0.4, cz + g() * 30, 2.5, 2.9, 3.6, 8 + 15 * rnd());
    }
    // 4. Сферическое гало: старые звёзды, плотность ∝ r⁻³ (3 000 … 95 000 св. лет), без сплющивания
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
      lum.push(r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th) * 0.65, b, 0.8 * b, 0.55 * b, R * 0.012 + R * 0.015 * rnd());
    }
    for (let i = 0, m = Math.round(n * (1 - bulge) * q); i < m; i++) {
      const arm = rnd() < 0.5 ? 0 : 1;
      let r = R * 0.12 + (-R * 0.22 * Math.log(rnd() + 1e-9));
      if (r > R * 1.1) r = R * rnd();
      const inArm = rnd() < 0.6;
      const ph = inArm ? arm * Math.PI + Math.log(r / (R * 0.12)) / tp + g() * (0.22 + floc) + 0.25 * Math.sin(r / R * 9 + arm) : rnd() * TAU;
      const x = r * Math.cos(ph), y = r * Math.sin(ph), z = g() * R * 0.012;
      if (inArm && opts.dust !== false && rnd() < 0.4) dust.push(x * 0.97, y * 0.97, z * 0.5, 0.14, 0.17, 0.22, R * 0.015 + R * 0.01 * rnd());
      const blue = inArm ? 0.25 + 0.5 * rnd() : 0;
      const b = (inArm ? 0.85 : 0.45) * (0.6 + 0.6 * rnd());
      lum.push(x, y, z, (1 - 0.35 * blue) * b, (0.88 - 0.05 * blue) * b, (0.72 + 0.35 * blue) * b, (R * 0.008 + R * 0.014 * rnd()) * sk);
      if (inArm && rnd() < 0.04) lum.push(x, y, z, 2.0, 0.6, 0.8, R * 0.004);
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
      lum.push(r * st * Math.cos(ph) * a[0], r * st * Math.sin(ph) * a[1], r * ct * a[2], b, 0.84 * b, 0.6 * b, R * (faint ? 0.03 : 0.015) + R * 0.03 * rnd());
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
      lum.push(x, y, z, (1 - 0.3 * blue) * b, (0.88 - 0.02 * blue) * b, (0.75 + 0.35 * blue) * b, R * 0.02 + R * 0.04 * rnd());
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
