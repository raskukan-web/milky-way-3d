'use strict';
/* =====================================================================
 *  Крупномасштабная структура Вселенной (лёгкий рендер частицами).
 *  Синтетическая «космическая паутина»: узлы-скопления на джиттерованной
 *  решётке (шаг ~700 млн св. лет — крупнее реальных ячеек 100–300 млн, для наглядности), филаменты к ближайшим соседям, стены
 *  между ними и пустоты-войды внутри ячеек. Внутри 250 млн св. лет паутина
 *  не генерируется — там реальные галактики каталога OpenNGC.
 *  Дальние квазары — до ~30 млрд св. лет (сопутствующее расстояние).
 *  Формат частиц: x, y, z, r, g, b, размер (как у частиц Галактики).
 * ===================================================================== */
(function () {
  const MW = window.MW;
  const v3 = MW.v3;

  function buildCosmicWeb(total = 250000) {
    const rnd = MW.rng.mulberry32(2026);
    const g = () => rnd.gauss();
    const CELL = 7e8, RIN = 2.5e8, ROUT = 5.5e9;
    const n = Math.ceil(ROUT / CELL);
    // узлы: по одному на ячейку решётки, со случайным смещением и «массой»
    const nodes = new Map();
    const key = (i, j, k) => i + ',' + j + ',' + k;
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) {
      const p = [(i + 0.5 + (rnd() - 0.5) * 0.85) * CELL, (j + 0.5 + (rnd() - 0.5) * 0.85) * CELL, (k + 0.5 + (rnd() - 0.5) * 0.85) * CELL];
      const r = v3.len(p);
      if (r > ROUT + CELL || r < RIN * 0.5) continue;
      nodes.set(key(i, j, k), { p, ijk: [i, j, k], m: Math.pow(rnd(), 3), links: [] });
    }
    const list = [...nodes.values()];
    // филаменты: к 3–4 ближайшим соседям по решётке
    const segs = [];
    for (const a of list) {
      const cand = [];
      const [i, j, k] = a.ijk;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
        if (!di && !dj && !dk) continue;
        const b = nodes.get(key(i + di, j + dj, k + dk));
        if (b) cand.push([v3.dist(a.p, b.p), b]);
      }
      cand.sort((x, y) => x[0] - y[0]);
      const nl = 3 + (rnd() < 0.4 ? 1 : 0);
      for (let q = 0; q < Math.min(nl, cand.length); q++) {
        const b = cand[q][1];
        if (a.links.includes(b) || b.links.includes(a)) continue;
        a.links.push(b); b.links.push(a);
        segs.push([a, b]);
      }
    }
    const out = new Float32Array(total * 7);
    let c = 0;
    const put = (p, col, size) => {
      const r = v3.len(p);
      if (r < RIN || r > ROUT * 1.05) return;
      // плотность «галактик» спадает с расстоянием — эффект селекции, как в реальных обзорах
      const o = c * 7;
      out[o] = p[0]; out[o + 1] = p[1]; out[o + 2] = p[2];
      out[o + 3] = col[0]; out[o + 4] = col[1]; out[o + 5] = col[2]; out[o + 6] = size;
      c++;
    };
    const galCol = () => {
      const t = rnd();
      return t < 0.45 ? [1.0, 0.86, 0.68] : t < 0.8 ? [0.92, 0.92, 1.0] : [0.62, 0.74, 1.0];
    };
    const nQ = Math.round(total * 0.025);
    const nNode = Math.round(total * 0.3), nFil = Math.round(total * 0.6);
    // скопления в узлах (крупнее у «массивных» узлов, красноватые эллиптические)
    for (let q = 0; q < nNode && c < total; q++) {
      const a = list[Math.floor(Math.pow(rnd(), 0.6) * list.length)];
      const s = CELL * (0.02 + 0.05 * a.m);
      put([a.p[0] + g() * s, a.p[1] + g() * s, a.p[2] + g() * s], rnd() < 0.7 ? [1.0, 0.82, 0.62] : [0.95, 0.9, 0.9], 4e6 + 6e6 * a.m);
    }
    // филаменты: точки вдоль отрезков с поперечным разбросом
    for (let q = 0; q < nFil && c < total; q++) {
      const [a, b] = segs[Math.floor(rnd() * segs.length)];
      const t = rnd();
      const s = CELL * (0.008 + 0.012 * rnd()) * (1 - 0.5 * Math.abs(t - 0.5));
      const p = v3.lerp(a.p, b.p, t);
      put([p[0] + g() * s, p[1] + g() * s, p[2] + g() * s], galCol(), 3e6);
    }
    // стены: треугольники «узел + два его соседа»
    while (c < total - nQ) {
      const a = list[Math.floor(rnd() * list.length)];
      if (a.links.length < 2) continue;
      const b = a.links[Math.floor(rnd() * a.links.length)], d = a.links[Math.floor(rnd() * a.links.length)];
      if (b === d) continue;
      let u = rnd(), w = rnd();
      if (u + w > 1) { u = 1 - u; w = 1 - w; }
      const p = v3.add(a.p, v3.add(v3.scale(v3.sub(b.p, a.p), u), v3.scale(v3.sub(d.p, a.p), w)));
      const s = CELL * 0.03;
      put([p[0] + g() * s, p[1] + g() * s, p[2] + g() * s], galCol(), 2.5e6);
    }
    // квазары: яркие голубоватые точки до ~30 млрд св. лет
    const qso = new Float32Array(nQ * 7);
    for (let q = 0; q < nQ; q++) {
      const dir = v3.norm([g(), g(), g()]);
      const r = 2e9 + Math.pow(rnd(), 0.6) * 2.8e10;
      const o = q * 7;
      qso[o] = dir[0] * r; qso[o + 1] = dir[1] * r; qso[o + 2] = dir[2] * r;
      qso[o + 3] = 0.45; qso[o + 4] = 0.55; qso[o + 5] = 0.75; qso[o + 6] = 2.5e7;
    }
    return { web: out.subarray(0, c * 7), qso, count: c, nodes: list.length, filaments: segs.length };
  }

  MW.cosmos = {
    buildCosmicWeb,
    CMB_R: 45.7e9,        // сопутствующее расстояние до поверхности последнего рассеяния, св. лет
    HORIZON: 46.5e9,      // радиус наблюдаемой Вселенной
  };
})();
