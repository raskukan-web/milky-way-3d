'use strict';
/* =====================================================================
 *  Млечный Путь — планетарий. Математика, константы, координаты, RNG.
 *  Мировая система координат: галактическая декартова, единица = 1 св. год,
 *  начало = Солнце. +X → центр Галактики (l=0,b=0), +Y → l=90°, +Z → северный
 *  галактический полюс. Все позиции в JS хранятся в double (Float64).
 * ===================================================================== */
const MW = (window.MW = window.MW || {});

MW.C = {
  LY_KM: 9.4607304725808e12,
  AU_KM: 149597870.7,
  AU_LY: 149597870.7 / 9.4607304725808e12,
  KM_LY: 1 / 9.4607304725808e12,
  RSUN_KM: 695700,
  RSUN_LY: 695700 / 9.4607304725808e12,
  REARTH_KM: 6371,
  PC_LY: 3.26156,
  DEG: Math.PI / 180,
  C_KMS: 299792.458,
  OBLIQUITY: 23.4392911 * Math.PI / 180,
  GC_DIST: 26000,
};
MW.C.GC_POS = [MW.C.GC_DIST, 0, -20]; // Солнце ~20 св. лет над плоскостью диска

/* ---------------------------- vec3 ---------------------------------- */
MW.v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  madd: (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  copy: (a) => [a[0], a[1], a[2]],
  // произвольный перпендикуляр
  perp: (a) => {
    const n = MW.v3.norm(a);
    const t = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    return MW.v3.norm(MW.v3.cross(n, t));
  },
  // вращение вектора v вокруг оси k (единичной) на угол a
  rotAxis: (v, k, a) => {
    const c = Math.cos(a), s = Math.sin(a), d = MW.v3.dot(k, v), cr = MW.v3.cross(k, v);
    return [v[0] * c + cr[0] * s + k[0] * d * (1 - c), v[1] * c + cr[1] * s + k[1] * d * (1 - c), v[2] * c + cr[2] * s + k[2] * d * (1 - c)];
  },
};

/* --------------------------- mat3 (row-major массивы 3x3) ------------ */
MW.m3 = {
  mulVec: (m, v) => [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ],
  transpose: (m) => [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]],
  mul: (a, b) => {
    const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    return r;
  },
  // из базисных векторов-столбцов
  fromCols: (x, y, z) => [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]],
  // в Float32Array column-major для uniform mat3
  toGL: (m) => new Float32Array([m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]]),
};

/* --------------------------- quaternion [x,y,z,w] -------------------- */
MW.q = {
  ident: () => [0, 0, 0, 1],
  mul: (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ],
  axisAngle: (ax, ang) => { const s = Math.sin(ang / 2); const n = MW.v3.norm(ax); return [n[0] * s, n[1] * s, n[2] * s, Math.cos(ang / 2)]; },
  norm: (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; },
  conj: (q) => [-q[0], -q[1], -q[2], q[3]],
  rot: (q, v) => {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
  },
  slerp: (a, b, t) => {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    let bb = b;
    if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]]; }
    if (d > 0.9995) return MW.q.norm([a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t]);
    const th = Math.acos(d), s = Math.sin(th);
    const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
    return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
  },
  // из ортонормированного базиса (right, up, back) — столбцы матрицы вращения
  fromBasis: (r, u, b) => {
    const m00 = r[0], m01 = u[0], m02 = b[0], m10 = r[1], m11 = u[1], m12 = b[1], m20 = r[2], m21 = u[2], m22 = b[2];
    const tr = m00 + m11 + m22;
    let q;
    if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]; }
    else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
    else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
    else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]; }
    return MW.q.norm(q);
  },
  // камера смотрит вдоль -Z, вверх +Y
  lookRotation: (fwd, upHint) => {
    const f = MW.v3.norm(fwd);
    let r = MW.v3.cross(f, upHint);
    if (MW.v3.len(r) < 1e-6) r = MW.v3.perp(f);
    r = MW.v3.norm(r);
    const u = MW.v3.cross(r, f);
    return MW.q.fromBasis(r, u, [-f[0], -f[1], -f[2]]);
  },
};

/* --------------------------- mat4 (Float32, column-major) ------------ */
MW.m4 = {
  // бесконечная перспектива (без z-буфера, глубина не используется)
  perspective: (fovy, aspect, near) => {
    const f = 1 / Math.tan(fovy / 2);
    const m = new Float32Array(16);
    m[0] = f / aspect; m[5] = f; m[10] = -1; m[11] = -1; m[14] = -2 * near;
    return m;
  },
  // матрица вида (только вращение) из кватерниона камеры
  viewFromQuat: (q) => {
    const r = MW.q.rot(q, [1, 0, 0]), u = MW.q.rot(q, [0, 1, 0]), b = MW.q.rot(q, [0, 0, 1]);
    const m = new Float32Array(16);
    m[0] = r[0]; m[4] = r[1]; m[8] = r[2];
    m[1] = u[0]; m[5] = u[1]; m[9] = u[2];
    m[2] = b[0]; m[6] = b[1]; m[10] = b[2];
    m[15] = 1;
    return m;
  },
};

/* --------------------------- координаты ----------------------------- */
MW.coords = (() => {
  // J2000: экваториальные → галактические (r_gal = T · r_eq)
  const EQ2GAL = [
    [-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
    [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
    [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669],
  ];
  const GAL2EQ = MW.m3.transpose(EQ2GAL);
  const e = MW.C.OBLIQUITY, ce = Math.cos(e), se = Math.sin(e);
  const ECL2EQ = [[1, 0, 0], [0, ce, -se], [0, se, ce]];
  const ECL2GAL = MW.m3.mul(EQ2GAL, ECL2EQ);

  function radecToEqVec(raH, decD) {
    const ra = raH * 15 * MW.C.DEG, dec = decD * MW.C.DEG;
    return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  }
  function radecToGal(raH, decD, dist) {
    const g = MW.m3.mulVec(EQ2GAL, radecToEqVec(raH, decD));
    return [g[0] * dist, g[1] * dist, g[2] * dist];
  }
  function eclToGal(v) { return MW.m3.mulVec(ECL2GAL, v); }
  function galToLB(v) {
    const d = MW.v3.len(v) || 1;
    let l = Math.atan2(v[1], v[0]) / MW.C.DEG; if (l < 0) l += 360;
    const b = Math.asin(v[2] / d) / MW.C.DEG;
    return { l, b, d };
  }
  function galToRaDec(v) {
    const q = MW.m3.mulVec(GAL2EQ, v);
    const d = MW.v3.len(q) || 1;
    let ra = Math.atan2(q[1], q[0]) / MW.C.DEG / 15; if (ra < 0) ra += 24;
    const dec = Math.asin(q[2] / d) / MW.C.DEG;
    return { ra, dec, d };
  }
  // единичные векторы небесных полюсов / осей в галактических координатах
  const NCP = MW.m3.mulVec(EQ2GAL, [0, 0, 1]);
  const ECL_POLE = MW.m3.mulVec(ECL2GAL, [0, 0, 1]);
  return { EQ2GAL, GAL2EQ, ECL2GAL, ECL2EQ, radecToGal, radecToEqVec, eclToGal, galToLB, galToRaDec, NCP, ECL_POLE };
})();

/* --------------------------- RNG и хеши ------------------------------ */
MW.rng = {
  // детерминированный ГПСЧ
  mulberry32(seed) {
    let a = seed >>> 0;
    const f = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (lo, hi) => lo + (hi - lo) * f();
    f.int = (lo, hi) => lo + Math.floor((hi - lo + 1) * f());
    f.gauss = () => { let u = 0, v = 0; while (u === 0) u = f(); v = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    f.pick = (arr) => arr[Math.floor(f() * arr.length) % arr.length];
    return f;
  },
  hash3i(x, y, z, salt = 0) {
    let h = (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791) ^ Math.imul(salt | 0, 2654435761)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  },
  hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  },
};

/* --------------------------- цвет звёзд ------------------------------ */
MW.color = {
  // приближение излучения АЧТ → линейный RGB (максимум = 1)
  blackbody(T) {
    T = Math.max(1000, Math.min(40000, T)) / 100;
    let r, g, b;
    if (T <= 66) { r = 255; g = 99.4708025861 * Math.log(T) - 161.1195681661; }
    else { r = 329.698727446 * Math.pow(T - 60, -0.1332047592); g = 288.1221695283 * Math.pow(T - 60, -0.0755148492); }
    if (T >= 66) b = 255; else if (T <= 19) b = 0; else b = 138.5177312231 * Math.log(T - 10) - 305.0447927307;
    const lin = (c) => { c = Math.max(0, Math.min(255, c)) / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const out = [lin(r), lin(g), lin(b)];
    const m = Math.max(out[0], out[1], out[2]) || 1;
    return [out[0] / m, out[1] / m, out[2] / m];
  },
  specToTemp(sp) {
    const base = { O: [45000, 30000], B: [30000, 10500], A: [10000, 7500], F: [7400, 6050], G: [5950, 5300], K: [5250, 3900], M: [3850, 2400], L: [2300, 1400], D: [25000, 8000], W: [60000, 40000] };
    const c = (sp || 'G2')[0].toUpperCase();
    const d = parseFloat((sp || 'G2').slice(1)) || 5;
    const r = base[c] || base.G;
    return r[0] + (r[1] - r[0]) * Math.min(9.5, d) / 9.5;
  },
  hex(c) { const f = (x) => Math.round(255 * Math.pow(Math.max(0, Math.min(1, x)), 1 / 2.2)).toString(16).padStart(2, '0'); return '#' + f(c[0]) + f(c[1]) + f(c[2]); },
};

/* --------------------------- утилиты --------------------------------- */
// плотность пикселей ограничена 1.5 — без избыточного рендера на HiDPI-экранах
// Телефоны и планшеты (включая iPadOS, который представляется как Mac с сенсорным экраном)
MW.MOBILE = /Mobi|Android|iPad|iPhone/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
/* Пресеты качества. q — доля частиц модели Галактики (и соседних галактик), web — точек космической паутины,
   dpr — потолок devicePixelRatio, march — множитель шагов трассировки (туманности, остатки сверхновых, чёрные
   дыры), post — тяжёлые полноэкранные проходы (bloom, лучи и блики объектива). */
MW.PRESETS = {
  // terrain: сетка ландшафта у поверхности (лучи × кольца), шаги теней, делитель разрешения неба, микрорельеф
  ultra: { name: 'Ультра (RTX)', q: 1, web: 900000, dpr: 1.5, march: 1, post: true, terrain: { az: 320, rings: 150, shadow: 10, skyDiv: 2, skySteps: 16, micro: 1 } },
  medium: { name: 'Среднее (ноутбуки / планшеты)', q: 0.32, web: 250000, dpr: 1.25, march: 0.45, post: true, terrain: { az: 176, rings: 92, shadow: 5, skyDiv: 2, skySteps: 10, micro: 0.7 } },
  low: { name: 'Слабое железо', q: 0.11, web: 80000, dpr: 1.0, march: 0.33, post: false, terrain: { az: 112, rings: 60, shadow: 0, skyDiv: 3, skySteps: 7, micro: 0.4 } },
};
// Строка GPU (WEBGL_debug_renderer_info) — по ней автоопределение мощности
MW.gpuString = (() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    return String(s || '');
  } catch (e) { return ''; }
})();
// Автоопределение: дискретные RTX/GTX 16+/RX 5000+/Arc A7 → «Ультра»; встроенная графика (Intel, AMD Radeon
// Graphics/Vega, Apple) и мобильные GPU (Mali, Adreno, PowerVR) → «Среднее»; мало памяти → «Слабое железо».
MW.detectPreset = () => {
  const g = MW.gpuString, mem = navigator.deviceMemory || 8;
  const strong = /RTX|GTX 1[6-9]|GTX [2-9]\d{2}0|RX [5-9]\d{3}|RX 7\d{3}|Radeon Pro W|Quadro|Arc A[57]/i.test(g);
  const weak = /Mali|Adreno|PowerVR|Intel|Iris|UHD|HD Graphics|Radeon\(TM\) Graphics|Radeon\(TM\) (R\d|Vega)|Radeon Graphics|Vega \d+|Apple|SwiftShader|llvmpipe|Basic Render/i.test(g);
  if (/SwiftShader|llvmpipe|Basic Render/i.test(g) || mem <= 3) return 'low';
  if (MW.MOBILE) return mem <= 4 ? 'low' : 'medium';
  if (strong && !weak) return 'ultra';
  if (weak) return mem <= 4 ? 'low' : 'medium';
  return 'medium';   // неизвестный GPU — безопасный средний пресет
};
MW.QUALITY = (() => { let v = null; try { v = localStorage.getItem('mw.quality'); } catch (e) { /* приватный режим */ } return MW.PRESETS[v] ? v : MW.detectPreset(); })();
MW.QUALITY_AUTO = (() => { try { return !localStorage.getItem('mw.quality'); } catch (e) { return true; } })();
MW.Q = MW.PRESETS[MW.QUALITY];
MW.dpr = () => Math.min(window.devicePixelRatio || 1, MW.Q.dpr);
// Строгий научный режим: только реальные объекты из каталогов (без процедурных звёзд и выдуманных планет).
// Частицы галактики остаются некликабельной визуализацией формы Млечного Пути.
MW.STRICT = true;
MW.util = {
  clamp: (x, a, b) => Math.max(a, Math.min(b, x)),
  smoothstep: (a, b, x) => { const t = MW.util.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); },
  lerp: (a, b, t) => a + (b - a) * t,
  // человекочитаемое расстояние (вход: св. годы)
  fmtDist(ly) {
    const km = ly * MW.C.LY_KM;
    if (ly >= 1e9) return (ly / 1e9).toFixed(ly >= 1e10 ? 1 : 2).replace('.', ',') + ' млрд св. лет';
    if (ly >= 1e6) return (ly / 1e6).toFixed(ly >= 1e7 ? 1 : 2) + ' млн св. лет';
    if (ly >= 1000) return Math.round(ly).toLocaleString('ru-RU') + ' св. лет';
    if (ly >= 0.05) return (ly >= 10 ? ly.toFixed(1) : ly.toFixed(2)) + ' св. лет';
    const au = km / MW.C.AU_KM;
    if (au >= 0.1) return (au >= 100 ? Math.round(au).toLocaleString('ru-RU') : au.toFixed(2)) + ' а.е.';
    if (km >= 1e6) return (km / 1e6).toFixed(2) + ' млн км';
    if (km >= 1) return Math.round(km).toLocaleString('ru-RU') + ' км';
    return Math.round(km * 1000) + ' м';
  },
  fmtSpeed(lyPerSec) {
    const kms = lyPerSec * MW.C.LY_KM;
    if (lyPerSec >= 0.5) return (lyPerSec >= 100 ? Math.round(lyPerSec).toLocaleString('ru-RU') : lyPerSec.toFixed(1)) + ' св.лет/с';
    const c = kms / MW.C.C_KMS;
    if (c >= 1) return (c >= 100 ? Math.round(c).toLocaleString('ru-RU') : c.toFixed(1)) + ' c (' + MW.util.fmtDist(lyPerSec) + '/с)';
    if (kms >= 1000) return Math.round(kms).toLocaleString('ru-RU') + ' км/с';
    return kms.toFixed(kms < 10 ? 2 : 0) + ' км/с';
  },
  fmtNum: (x, d = 2) => (Math.abs(x) >= 1e5 || (Math.abs(x) < 1e-3 && x !== 0)) ? x.toExponential(d) : x.toFixed(d),
};
