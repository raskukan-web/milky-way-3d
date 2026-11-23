'use strict';
/* =====================================================================
 *  Крупномасштабная структура Вселенной (лёгкий рендер частицами).
 *  Синтетическая «космическая паутина» во всём объёме наблюдаемой Вселенной — от Местного сверхскопления
 *  до горизонта (46,5 млрд св. лет, сопутствующее расстояние):
 *   • узлы-скопления на джиттерованной решётке в трёх сферических слоях — шаг ячеек растёт к краю
 *     (0,7 → 2 → 4,5 млрд св. лет), чтобы весь объём укладывался в ~10 тыс. узлов;
 *   • филаменты к 3–4 ближайшим соседям (в том числе через границы слоёв — без швов), стены между ними,
 *     пустоты-войды внутри ячеек;
 *   • внутренний край размыт (1,2–4 × 10⁸ св. лет): паутина плавно перекрывается с реальными галактиками
 *     каталога OpenNGC, палитра — та же, что у галактик каталога;
 *   • к горизонту яркость плавно гаснет: дальше z ≈ 10 (~32 млрд св. лет) галактик почти нет — «тёмные века».
 *  Дальние квазары — до ~30 млрд св. лет. Формат частиц: x, y, z, r, g, b, размер (как у частиц Галактики).
 * ===================================================================== */
(function () {
  const MW = window.MW;
  const v3 = MW.v3;
  const HORIZON = 46.5e9;
  // слои: шаг решётки и радиусы (св. лет)
  const SHELLS = [
    { cell: 7e8, r0: 1.2e8, r1: 6e9 },
    { cell: 2e9, r0: 6e9, r1: 2e10 },
    { cell: 4.5e9, r0: 2e10, r1: HORIZON },
  ];
  // палитра — как у галактик каталога OpenNGC (renderer.js, COL): спиральные, эллиптические, неправильные
  const SPIRAL = [0.9, 0.92, 1.0], ELLIPT = [1.0, 0.86, 0.68], IRREG = [0.72, 0.84, 1.0];

  function buildCosmicWeb(total = 900000) {
    const rnd = MW.rng.mulberry32(2026);
    const g = () => rnd.gauss();
    const smooth = MW.util.smoothstep;
    const key = (s, i, j, k) => s + ':' + i + ',' + j + ',' + k;
    const nodes = new Map();
    const list = [];
    SHELLS.forEach((sh, si) => {
      const n = Math.ceil(sh.r1 / sh.cell) + 1;
      for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) {
        // быстрый отсев ячеек вне слоя (до джиттера)
        const cx = (i + 0.5) * sh.cell, cy = (j + 0.5) * sh.cell, cz = (k + 0.5) * sh.cell;
        const rc = Math.hypot(cx, cy, cz);
        if (rc > sh.r1 + sh.cell || rc < sh.r0 - sh.cell) continue;
        const p = [(i + 0.5 + (rnd() - 0.5) * 0.85) * sh.cell, (j + 0.5 + (rnd() - 0.5) * 0.85) * sh.cell, (k + 0.5 + (rnd() - 0.5) * 0.85) * sh.cell];
        const r = v3.len(p);
        if (r >= sh.r1 || r < sh.r0) continue;
        const nd = { p, r, si, ijk: [i, j, k], m: Math.pow(rnd(), 3), links: [] };
        nodes.set(key(si, i, j, k), nd); list.push(nd);
      }
    });
    // соседи: своя решётка ±1, а у границы слоя — и решётка соседнего слоя (филаменты без швов)
    const near = (a) => {
      const cand = [];
      const look = (si) => {
        const sh = SHELLS[si];
        const ci = Math.floor(a.p[0] / sh.cell), cj = Math.floor(a.p[1] / sh.cell), ck = Math.floor(a.p[2] / sh.cell);
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
          const b = nodes.get(key(si, ci + di, cj + dj, ck + dk));
          if (b && b !== a) cand.push([v3.dist(a.p, b.p), b]);
        }
      };
      look(a.si);
      const sh = SHELLS[a.si];
      if (a.si > 0 && a.r - sh.r0 < sh.cell * 1.5) look(a.si - 1);
      if (a.si < SHELLS.length - 1 && sh.r1 - a.r < SHELLS[a.si + 1].cell * 1.5) look(a.si + 1);
      cand.sort((x, y) => x[0] - y[0]);
      return cand;
    };
    const segs = [];
    for (const a of list) {
      const cand = near(a);
      const nl = 3 + (rnd() < 0.4 ? 1 : 0);
      for (let q = 0; q < Math.min(nl, cand.length); q++) {
        const b = cand[q][1];
        if (a.links.includes(b)) continue;
        a.links.push(b); b.links.push(a);
        segs.push([a, b]);
      }
    }
    // Выборка точек: вес узла ~ cell^0.3 — внешние ячейки получают чуть больше точек, но ближняя паутина
    // (её видно крупно) остаётся детальной; во внешних слоях точки крупнее (см. sz)
    const wNode = list.map((a) => Math.pow(SHELLS[a.si].cell / 7e8, 0.3));
    const cum = []; let acc = 0; for (const w of wNode) { acc += w; cum.push(acc); }
    const pickNode = () => { const x = rnd() * acc; let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; } return list[lo]; };
    const segW = segs.map(([a, b]) => Math.pow(Math.max(SHELLS[a.si].cell, SHELLS[b.si].cell) / 7e8, 0.3));
    const cumS = []; let accS = 0; for (const w of segW) { accS += w; cumS.push(accS); }
    const pickSeg = () => { const x = rnd() * accS; let lo = 0, hi = cumS.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cumS[m] < x) lo = m + 1; else hi = m; } return segs[lo]; };

    const out = new Float32Array(total * 7);
    let c = 0;
    // яркость частицы: мягкий вход у Местного сверхскопления (перекрытие с каталогом) и затухание к горизонту
    const put = (p, col, size) => {
      const r = v3.len(p);
      if (r > HORIZON) return;
      const inner = smooth(1.2e8, 4e8, r);
      if (inner <= 0 || rnd() > inner * 0.6 + 0.4 * inner * inner) return;
      const fade = 1 - smooth(3.0e10, HORIZON, r);
      if (fade <= 0.01) return;
      // лёгкий сдвиг в красное с расстоянием (космологическое красное смещение, мягко — для наглядности)
      const red = smooth(1.5e10, 4e10, r) * 0.35;
      const o = c * 7;
      out[o] = p[0]; out[o + 1] = p[1]; out[o + 2] = p[2];
      out[o + 3] = col[0] * fade; out[o + 4] = col[1] * fade * (1 - red * 0.35); out[o + 5] = col[2] * fade * (1 - red);
      out[o + 6] = size;
      c++;
    };
    const galCol = () => { const t = rnd(); return t < 0.55 ? SPIRAL : t < 0.85 ? ELLIPT : IRREG; };
    const nQ = Math.round(total * 0.02);
    const nNode = Math.round(total * 0.3), nFil = Math.round(total * 0.58);
    // размер частицы растёт с шагом ячейки: во внешних слоях одна точка — целая группа галактик
    const sz = (a) => Math.pow(SHELLS[a.si].cell / 7e8, 0.85);
    // скопления в узлах (крупнее у «массивных» узлов, эллиптические — красноватые)
    let guard = 0;
    for (let q = 0; q < nNode && c < total && guard < nNode * 4; guard++) {
      const a = pickNode();
      const s = SHELLS[a.si].cell * (0.02 + 0.05 * a.m);
      const c0 = c;
      put([a.p[0] + g() * s, a.p[1] + g() * s, a.p[2] + g() * s], rnd() < 0.7 ? ELLIPT : SPIRAL, (4e6 + 6e6 * a.m) * sz(a));
      if (c > c0) q++;
    }
    // филаменты: точки вдоль отрезков с поперечным разбросом
    guard = 0;
    for (let q = 0; q < nFil && c < total && guard < nFil * 4; guard++) {
      const [a, b] = pickSeg();
      const t = rnd();
      const cell = Math.max(SHELLS[a.si].cell, SHELLS[b.si].cell);
      const s = cell * (0.008 + 0.012 * rnd()) * (1 - 0.5 * Math.abs(t - 0.5));
      const p = v3.lerp(a.p, b.p, t);
      const c0 = c;
      put([p[0] + g() * s, p[1] + g() * s, p[2] + g() * s], galCol(), 3e6 * sz(a));
      if (c > c0) q++;
    }
    // стены: треугольники «узел + два его соседа»
    guard = 0;
    while (c < total - nQ && guard < total * 4) {
      guard++;
      const a = pickNode();
      if (a.links.length < 2) continue;
      const b = a.links[Math.floor(rnd() * a.links.length)], d = a.links[Math.floor(rnd() * a.links.length)];
      if (b === d) continue;
      let u = rnd(), w = rnd();
      if (u + w > 1) { u = 1 - u; w = 1 - w; }
      const p = v3.add(a.p, v3.add(v3.scale(v3.sub(b.p, a.p), u), v3.scale(v3.sub(d.p, a.p), w)));
      const s = SHELLS[a.si].cell * 0.03;
      put([p[0] + g() * s, p[1] + g() * s, p[2] + g() * s], galCol(), 2.5e6 * sz(a));
    }
    // квазары: яркие голубоватые точки до ~30 млрд св. лет (z ≈ 7 — самые далёкие известные)
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
    HORIZON,              // радиус наблюдаемой Вселенной (сопутствующее расстояние), св. лет
  };
})();
