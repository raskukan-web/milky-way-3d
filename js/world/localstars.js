'use strict';
/* =====================================================================
 *  Динамическая генерация локальных процедурных звёзд вокруг камеры.
 *  Пространство разбито на ячейки трёх уровней (яркие / карлики FGK /
 *  красные карлики). Содержимое ячейки детерминировано хешем её индекса
 *  и плотностью звёзд галактической модели в этой точке.
 * ===================================================================== */
(function () {
  const MW = window.MW;
  const LEVELS = [
    { id: 0, cell: 80, rCells: 6, lambda: 30, cap: 260, sunR: [300, 650] },
    { id: 1, cell: 20, rCells: 6, lambda: 8, cap: 60, sunR: [45, 90] },
    { id: 2, cell: 6, rCells: 6, lambda: 0.63, cap: 12, sunR: [14, 28] },
  ];
  const SPEC = 'OBAFGKM';

  function makeStar(level, rnd, young) {
    let T, M, R, cls;
    const u = rnd();
    if (level === 0) {
      if (u < 0.006) { T = 3500 + rnd() * 16000; M = -6 - 2 * rnd(); R = T < 6000 ? 300 + 600 * rnd() : 40 + 80 * rnd(); cls = 'I'; }
      else if (u < 0.25 + 0.45 * young) {
        const h = rnd();
        if (h < 0.012) { T = 30000 + 15000 * rnd(); M = -4 - 2 * rnd(); R = 6 + 9 * rnd(); }
        else if (h < 0.28) { T = 10500 + 19500 * rnd(); M = -3.5 + 3 * (30000 - T) / 19500; R = 2.5 + 4.5 * (T - 10500) / 19500; }
        else { T = 7500 + 2500 * rnd(); M = 0.6 + 1.4 * (10000 - T) / 2500; R = 1.5 + rnd(); }
        cls = 'V';
      } else {
        const h = rnd();
        if (h < 0.6) { T = 3900 + 1100 * rnd(); M = -0.5 + 1.5 * rnd(); R = 10 + 30 * rnd(); cls = 'III'; }
        else if (h < 0.75) { T = 3300 + 500 * rnd(); M = -1.5 + 1.5 * rnd(); R = 40 + 110 * rnd(); cls = 'III'; }
        else if (h < 0.9) { T = 5000 + 600 * rnd(); M = 0.2 + 0.8 * rnd(); R = 8 + 7 * rnd(); cls = 'III'; }
        else { T = 6000 + 1400 * rnd(); M = 2 + rnd(); R = 1.3 + 0.7 * rnd(); cls = 'V'; }
      }
    } else if (level === 1) {
      if (u < 0.13) { T = 6000 + 1400 * rnd(); M = 2.5 + 1.5 * (7400 - T) / 1400; R = 1.15 + 0.4 * rnd(); }
      else if (u < 0.43) { T = 5300 + 700 * rnd(); M = 4 + 1.5 * (6000 - T) / 700; R = 0.85 + 0.3 * rnd(); }
      else { T = 3900 + 1400 * rnd(); M = 5.5 + 2.5 * (5300 - T) / 1400; R = 0.6 + 0.3 * rnd(); }
      cls = 'V';
    } else {
      if (u < 0.9) { T = 2400 + 1400 * rnd(); M = 8.5 + 7.5 * (3800 - T) / 1400; R = 0.1 + 0.5 * (T - 2400) / 1400; cls = 'V'; }
      else { T = 6000 + 14000 * rnd(); M = 10 + 5 * rnd(); R = 0.012; cls = 'D'; }
    }
    return { T, M, R, cls };
  }
  function specOf(T, cls) {
    if (cls === 'D') return 'DA';
    const b = [[30000, 'O'], [10000, 'B'], [7500, 'A'], [6000, 'F'], [5200, 'G'], [3700, 'K'], [0, 'M']];
    const ranges = { O: [50000, 30000], B: [30000, 10000], A: [10000, 7500], F: [7500, 6000], G: [6000, 5200], K: [5200, 3700], M: [3700, 2300] };
    let c = 'M'; for (const [t, s] of b) if (T >= t) { c = s; break; }
    const r = ranges[c];
    const d = Math.max(0, Math.min(9, Math.round(9 * (r[0] - T) / (r[0] - r[1]))));
    return c + d + (cls || 'V');
  }

  class LocalStars {
    constructor(glc) {
      this.glc = glc;
      this.levels = LEVELS.map((L) => ({ ...L, key: null, origin: [0, 0, 0], count: 0, pos: null, props: null, ids: null, gpu: null }));
    }
    update(cam) {
      let changed = false;
      for (const L of this.levels) {
        const cx = Math.floor(cam[0] / L.cell), cy = Math.floor(cam[1] / L.cell), cz = Math.floor(cam[2] / L.cell);
        const key = cx + ',' + cy + ',' + cz;
        if (key === L.key) continue;
        L.key = key;
        this.regen(L, cx, cy, cz);
        changed = true;
      }
      return changed;
    }
    regen(L, cx, cy, cz) {
      const origin = [(cx + 0.5) * L.cell, (cy + 0.5) * L.cell, (cz + 0.5) * L.cell];
      const pos = [], props = [], ids = [];
      const R = L.rCells;
      const maxTotal = 70000;
      for (let dz = -R; dz <= R; dz++) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy + dz * dz > (R + 0.5) * (R + 0.5)) continue;
        const ix = cx + dx, iy = cy + dy, iz = cz + dz;
        const center = [(ix + 0.5) * L.cell, (iy + 0.5) * L.cell, (iz + 0.5) * L.cell];
        const sd = MW.galaxy.stellarDensity(center);
        const sunD = MW.v3.len(center);
        const sup = MW.util.smoothstep(L.sunR[0], L.sunR[1], sunD);
        if (sup <= 0) continue;
        const lam = Math.min(L.lambda * sd.rho * sup, L.cap);
        const h = MW.rng.hash3i(ix, iy, iz, L.id * 7919 + 17);
        const rnd = MW.rng.mulberry32(h);
        // Пуассон (для больших λ — нормальное приближение)
        let n;
        if (lam < 30) { let p = Math.exp(-lam), s = p, u = rnd(); n = 0; while (u > s && n < 200) { n++; p *= lam / n; s += p; } }
        else n = Math.max(0, Math.round(lam + Math.sqrt(lam) * rnd.gauss()));
        for (let i = 0; i < n && ids.length < maxTotal; i++) {
          const x = (ix + rnd()) * L.cell, y = (iy + rnd()) * L.cell, z = (iz + rnd()) * L.cell;
          const st = makeStar(L.id, rnd, sd.young);
          const c = MW.color.blackbody(st.T);
          pos.push(x, y, z);
          props.push(x - origin[0], y - origin[1], z - origin[2], c[0], c[1], c[2], st.M, st.T, st.R);
          ids.push(MW.rng.hash3i(ix, iy, iz, i * 31 + L.id));
        }
      }
      L.origin = origin;
      L.count = ids.length;
      L.pos = new Float64Array(pos);
      L.props = props;
      L.ids = ids;
      const gpuData = new Float32Array(L.count * 7);
      for (let i = 0; i < L.count; i++) for (let k = 0; k < 7; k++) gpuData[i * 7 + k] = props[i * 9 + k];
      if (L.gpu) { this.glc.updateBuffer(L.gpu.buf, gpuData); L.gpu.count = L.count; }
      else L.gpu = this.glc.instanced(gpuData, [[1, 3], [2, 4]], this.glc.gl.DYNAMIC_DRAW);
    }
    // создать объект звезды по уровню/индексу
    star(li, i) {
      const L = this.levels[li];
      const p = L.props;
      const T = p[i * 9 + 7], M = p[i * 9 + 6], R = p[i * 9 + 8];
      const id = 'p' + L.ids[i].toString(36);
      const spec = specOf(T, R < 0.02 ? 'D' : (R > 30 ? 'I' : (R > 6 ? 'III' : 'V')));
      return {
        kind: 'star', procedural: true, id, name: 'MW ' + (L.ids[i] % 1000000).toString().padStart(6, '0'),
        pos: [L.pos[i * 3], L.pos[i * 3 + 1], L.pos[i * 3 + 2]], temp: Math.round(T), radiusSun: R, absMag: M,
        lum: Math.pow(10, (4.83 - M) / 2.5), color: MW.color.blackbody(T), seed: L.ids[i], spec, level: li, index: i,
      };
    }
    // ближайшая звезда к точке (для адаптации скорости)
    nearest(p) {
      let best = null, bd = Infinity;
      for (let li = 0; li < this.levels.length; li++) {
        const L = this.levels[li];
        const a = L.pos;
        if (!a) continue;
        for (let i = 0, n = L.count; i < n; i++) {
          const dx = a[i * 3] - p[0], dy = a[i * 3 + 1] - p[1], dz = a[i * 3 + 2] - p[2];
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bd) { bd = d; best = [li, i]; }
        }
      }
      return best ? { li: best[0], i: best[1], dist: Math.sqrt(bd) } : null;
    }
  }

  MW.LocalStars = LocalStars;
  MW.specOf = specOf;
})();
