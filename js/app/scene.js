'use strict';
/* =====================================================================
 *  Состояние мира: время, Солнечная система, активная звёздная система
 *  (генерируется при приближении к любой звезде), локальные звёзды,
 *  объекты каталога, цели автопилота, адаптация скорости, столкновения.
 * ===================================================================== */
(function () {
  const MW = window.MW;
  const v3 = MW.v3;
  const RS_SGRA = 1.342e-6; // радиус Шварцшильда Стрельца A* (св. лет), M ≈ 4.3 млн M☉

  function jdNow() { return Date.now() / 86400000 + 2440587.5; }

  class Scene {
    constructor(glc) {
      this.glc = glc;
      this.jd = jdNow();
      this.timeScale = 1;          // сек модели на сек реального времени
      this.paused = false;
      this.realTime = 0;
      this.solar = MW.solar.buildSolarSystem();
      this.probes = MW.probes.build(this.solar);
      this.active = null;          // процедурная/каталожная система рядом с камерой
      this.local = new MW.LocalStars(glc);
      this.catalog = MW.catalog;
      this.frame = 0;
      // Стрелец A*
      const n = v3.norm([0.25, -0.35, 0.9]);
      const fr = MW.solar.bodyFrame(n);
      this.bh = {
        kind: 'bh', id: 'sgra', name: 'Стрелец A*', pos: MW.C.GC_POS.slice(), rs: RS_SGRA, frame: fr, normal: n,
        info: 'Сверхмассивная чёрная дыра в центре Млечного Пути: ~4.3 млн масс Солнца, радиус горизонта ~12 млн км. Изображение — трассировка лучей в метрике Шварцшильда; аккреционный диск показан художественно ярким.',
        type: 'Сверхмассивная чёрная дыра', dist: MW.C.GC_DIST,
      };
      // Сверхмассивные чёрные дыры активных ядер и чёрные дыры звёздной массы: масса (M☉) → радиус Шварцшильда
      // (Rs = 2GM/c² ≈ 2,953 км · M). Рисуются тем же шейдером, что Стрелец A* (метрика Шварцшильда).
      const AGN = [
        ['ton618', 6.6e10, true, 'Квазар TON 618 (z = 2,22): одна из самых массивных известных чёрных дыр. Оценки массы 40–66 млрд M☉ (по ширине линий); радиус горизонта ~1 300 а. е. — больше орбиты Плутона в 30 раз.', 'Shemmer et al. 2004; Ge et al. 2019'],
        ['m87', 6.5e9, true, 'M87* — первая сфотографированная чёрная дыра (Event Horizon Telescope, 2019). Из ядра бьёт релятивистский джет длиной ~5 000 св. лет.', 'EHT Collaboration 2019'],
        ['3c273', 8.9e8, true, 'Ядро квазара 3C 273 — самого яркого квазара на небе; масса ~0,9 млрд M☉ (реверберационное картирование), джет длиной ~200 000 св. лет.', 'Paltani & Türler 2005'],
        ['cyga', 2.5e9, true, 'Ядро радиогалактики Лебедь A: ~2,5 млрд M☉; два джета питают гигантские радиолепестки.', 'Tadhunter et al. 2003'],
        ['ngc5128', 5.5e7, true, 'Ядро Центавра A — ближайшей радиогалактики: ~55 млн M☉, джеты и радиолепестки на сотни тысяч св. лет.', 'Neumayer 2010'],
        ['cygx1', 21.2, false, 'Лебедь X-1 — первая открытая чёрная дыра звёздной массы (21 M☉); аккреционный диск питается ветром голубого сверхгиганта.', 'Miller-Jones et al. 2021'],
      ];
      this.blackHoles = [this.bh];
      for (const [hid, M, jet, info, src] of AGN) {
        const host = MW.catalog.dsoById[hid];
        if (!host) continue;
        const h = MW.rng.mulberry32(MW.rng.hashStr(host.id));
        const nn = host.normal || v3.norm([h.gauss(), h.gauss(), h.gauss()]);   // та же ось, что у джетов в рендере DSO
        const rs = M * 2.953 / 9.4607e12;
        const bh = { kind: 'bh', id: 'bh_' + hid, name: 'Чёрная дыра · ' + host.name, pos: host.pos, rs, frame: MW.solar.bodyFrame(nn), normal: nn,
          host, mass: M, jet, info, src, type: M > 1e5 ? 'Сверхмассивная чёрная дыра (активное ядро)' : 'Чёрная дыра звёздной массы', dist: host.dist };
        host.bhChild = bh;
        this.blackHoles.push(bh);
      }
      this.galaxyView = { kind: 'view', id: 'mwview', name: 'Обзор Млечного Пути', pos: MW.C.GC_POS.slice(), info: 'Вид на нашу Галактику сверху: 4 главных рукава, перемычка и балдж. Солнце — в рукаве Ориона.' };
      this.webView = { kind: 'view', id: 'webview', name: 'Космическая паутина', pos: [0, 0, 0], arrive: 1.15e10, viewDirRaw: [0.4, -0.5, 0.75],
        src: 'Структура — синтетическая (джиттер-решётка ~700 млн св. лет, крупнее реальной для наглядности); галактики ближе 250 млн св. лет — OpenNGC',
        info: 'Крупномасштабная структура: филаменты и стены скоплений галактик вокруг пустот-войдов. Ближе 250 млн св. лет — реальные галактики каталога OpenNGC (их ~10 000), дальше — синтетическая сеть (250 000 точек) и квазары.' };
      this.universeView = { kind: 'view', id: 'universe', name: 'Вся наблюдаемая Вселенная', pos: [0, 0, 0], arrive: 3.0e10, viewDirRaw: [0.3, -0.4, 0.85],
        src: 'Радиус — ΛCDM (Planck 2018); структура паутины — процедурная',
        info: 'Наблюдаемая Вселенная радиусом ~46,5 млрд св. лет (сопутствующее расстояние). Космическая паутина заполняет весь объём; дальше z ≈ 10 (~32 млрд св. лет) галактик почти нет — «тёмные века», и структура плавно гаснет к горизонту.' };
      this.updateSystem(this.solar);
    }

    get systems() { return this.active ? [this.solar, this.active] : [this.solar]; }

    updateSystem(sys) {
      const jd = this.jd;
      for (const b of sys.bodies) {
        const parentPos = b.parentBody ? b.parentBody.pos : sys.star.pos;
        const np = v3.add(parentPos, b.orbitFn(jd));
        b.prevPos = b.pos || np;
        b.pos = np;
        b.spin = b.spinFn ? b.spinFn(jd) : 2 * Math.PI * ((jd - 2451545.0) * 24 / b.rotH);
      }
    }

    update(dt, cam) {
      this.frame++;
      this.realTime += dt;
      if (!this.paused) this.jd += (dt * this.timeScale) / 86400;
      for (const s of this.systems) this.updateSystem(s);
      for (const c of this.catalog.binaries) c.pos = v3.add(c.primary.pos, this.catalog.binaryOffset(c, this.jd));
      for (const p of this.probes) { const np = p.at(this.jd); p.prevPos = p.pos || np; p.pos = np; }
      if (!MW.STRICT && this.local.update(cam.pos) && this.onLocalChanged) this.onLocalChanged();
      if (this.frame % 4 === 0) this.updateActiveSystem(cam.pos);
    }

    // ближайшая звезда (каталог или процедурная) → активная система
    nearestStar(p) {
      let best = null, bd = Infinity;
      for (const s of this.catalog.stars) { const d = v3.dist(p, s.pos); if (d < bd) { bd = d; best = s; } }
      for (const s of this.catalog.hygStars) { const d = v3.dist(p, s.pos); if (d < bd) { bd = d; best = s; } }
      const ln = this.local.nearest(p);
      if (ln && ln.dist < bd) { bd = ln.dist; best = { local: ln }; }
      return { star: best, dist: bd };
    }
    updateActiveSystem(p) {
      const sunD = v3.len(p);
      const ns = this.nearestStar(p);
      this._nearestStarDist = ns.dist;
      if (sunD < ns.dist && sunD < 0.6) { if (!this.pinned) this.active = null; return; }
      if (ns.dist < 0.35) {
        let star = ns.star;
        if (star.local) star = this.local.star(star.local.li, star.local.i);
        if (!this.active || this.active.star.id !== star.id) { this.pinned = false; this.activateStar(star); }
      } else if (this.active && !this.pinned && v3.dist(p, this.active.star.pos) > 0.7) {
        this.active = null;
      }
    }
    // pin = true: система выбрана пользователем (клик/автопилот) и не выгружается при удалении камеры
    activateStar(star, pin) {
      if (star.companion === true) star = star.primary;
      if (star.isSun) { this.active = null; this.pinned = false; return; }
      if (pin) this.pinned = true;
      if (this.active && this.active.star.id === star.id) return;
      const sys = MW.procsystem.generateSystem(star);
      this.updateSystem(sys);
      for (const b of sys.bodies) b.prevPos = b.pos;
      this.active = sys;
    }
    starOf(body) { return body.system ? body.system.star : null; }

    // расстояние до ближайшей «поверхности» — основа адаптации скорости
    nearestDist(p) {
      let d = Infinity;
      for (const s of this.systems) {
        d = Math.min(d, v3.dist(p, s.star.pos) - s.star.radius);
        for (const b of s.bodies) d = Math.min(d, v3.dist(p, b.pos) - b.radius);
      }
      for (const s of this.catalog.stars) d = Math.min(d, v3.dist(p, s.pos) - s.radiusSun * MW.C.RSUN_LY);
      for (const c of this.catalog.binaries) d = Math.min(d, v3.dist(p, c.pos) - c.radius);
      for (const c of this.probes) d = Math.min(d, Math.max(v3.dist(p, c.pos) - c.radius * 0.5, c.radius * 0.05));
      const hs = this.catalog.hygStars;
      for (let i = 0; i < hs.length; i++) { const s = hs[i].pos, dx = s[0] - p[0], dy = s[1] - p[1], dz = s[2] - p[2]; const q = dx * dx + dy * dy + dz * dz; if (q < d * d) d = Math.sqrt(q); }
      const ln = this.local.nearest(p);
      if (ln) d = Math.min(d, ln.dist);
      for (const o of this.catalog.dsos) {
        const k = o.vis === 'galaxy' ? 0.5 : 0.9;
        d = Math.min(d, Math.max(v3.dist(p, o.pos) - o.radius * k, o.radius * 0.08));
      }
      for (const bh of this.blackHoles) d = Math.min(d, Math.max(v3.dist(p, bh.pos) - bh.rs * 2.5, bh.rs * 0.5));
      return Number.isFinite(d) ? Math.max(d, 2e-13) : 1;
    }

    // расстояние до ближайшего объекта на курсе (в конусе ~6° вокруг направления движения или в пределах его размера)
    courseDist(p, dir) {
      let best = Infinity;
      const test = (pos, r) => {
        const dx = pos[0] - p[0], dy = pos[1] - p[1], dz = pos[2] - p[2];
        const along = dx * dir[0] + dy * dir[1] + dz * dir[2];
        if (along <= 0) return;
        const d2 = dx * dx + dy * dy + dz * dz, perp2 = Math.max(d2 - along * along, 0);
        const lim = Math.max(r * 2, along * 0.1);
        if (perp2 > lim * lim) return;
        const d = Math.sqrt(d2) - r;
        if (d < best) best = Math.max(d, r * 0.02, 1e-14);
      };
      for (const s of this.systems) { test(s.star.pos, s.star.radius); for (const b of s.bodies) test(b.pos, b.radius); }
      for (const s of this.catalog.stars) test(s.pos, (s.radiusSun || 1) * MW.C.RSUN_LY);
      for (const s of this.catalog.hygStars) test(s.pos, (s.radiusSun || 1) * MW.C.RSUN_LY);
      for (const o of this.catalog.dsos) test(o.pos, o.radius * (o.vis === 'galaxy' ? 0.5 : 0.9));
      for (const bh of this.blackHoles) test(bh.pos, bh.rs * 2.5);
      return best;
    }

    // не даём камере войти внутрь тел
    collide(cam) {
      const groups = this.systems.map((s) => [s.star, ...s.bodies]);
      groups.push(this.catalog.binaries);
      for (const pr of this.probes) {
        // не даём влететь в корпус (ограничивающий радиус ~2 м вокруг центра)
        const rel = v3.sub(cam.pos, pr.pos), d = v3.len(rel), r = pr.radius * 0.16;
        if (d < r) { cam.pos = v3.madd(pr.pos, rel, r / Math.max(d, 1e-30)); cam.vel = [0, 0, 0]; }
      }
      for (const list of groups) {
        for (const b of list) {
          if (b === this.surfaceBody) continue;     // на поверхности высоту над рельефом держит режим посадки
          const r = b.radius * (b.kind === 'star' ? 1.02 : 1.0015);
          const rel = v3.sub(cam.pos, b.pos);
          const d = v3.len(rel);
          if (d < r) { cam.pos = v3.madd(b.pos, rel, r / Math.max(d, 1e-30)); cam.vel = [0, 0, 0]; }
        }
      }
      for (const bh of this.blackHoles) {
        const rb = v3.sub(cam.pos, bh.pos), db = v3.len(rb);
        if (db < bh.rs * 1.6) { cam.pos = v3.madd(bh.pos, rb, bh.rs * 1.6 / Math.max(db, 1e-30)); cam.vel = [0, 0, 0]; }
      }
    }

    // авто-привязка камеры к ближайшему телу (камера «едет» вместе с планетой)
    applyAnchor(cam) {
      if (cam.anchor && cam.anchor.prevPos && !cam.auto) {
        cam.pos = v3.add(cam.pos, v3.sub(cam.anchor.pos, cam.anchor.prevPos));
      }
      if (cam.auto) return;
      let best = null, bd = Infinity;
      for (const s of this.systems) for (const b of s.bodies) {
        const d = v3.dist(cam.pos, b.pos) / b.radius;
        if (d < bd) { bd = d; best = b; }
      }
      // аппарат летит ~16 км/с — камера «едет» вместе с ним
      for (const b of this.probes) {
        const d = v3.dist(cam.pos, b.pos) / b.radius;
        if (d < bd) { bd = d; best = b; }
      }
      if (best && bd < 40) cam.anchor = best;
      else if (cam.anchor && v3.dist(cam.pos, cam.anchor.pos) / cam.anchor.radius > 80) cam.anchor = null;
    }

    // цель для автопилота
    makeTarget(o) {
      const self = this;
      if (o.kind === 'planet' || o.kind === 'moon') {
        return {
          obj: o, body: o, name: o.name, getPos: () => o.pos, arrive: o.radius * (o.ring ? 6.5 : 4.2),
          get litDir() { return v3.norm(v3.sub(o.system.star.pos, o.pos)); },
        };
      }
      if (o.kind === 'star') {
        if (!o.isSun) this.activateStar(o, true);
        const st = o.isSun || o.companion === true ? o : (this.active && this.active.star.id === o.id ? this.active.star : o);
        const R = (st.radiusSun || 1) * MW.C.RSUN_LY;
        // у тесных пар (Сириус, α Cen, Алголь) прилетаем так, чтобы были видны обе звезды
        const arrive = o.companion === true && o.aAU < 200 ? Math.max(R * 7, o.aAU * MW.C.AU_LY * 1.6) : R * 7;
        return { obj: st, name: st.name, getPos: () => st.pos, arrive };
      }
      if (o.kind === 'probe') {
        // смотрим со стороны «от Солнца» и чуть сбоку: аппарат освещён, далёкое Солнце — на фоне за ним
        const out = v3.norm(o.pos), side = v3.norm(v3.cross(out, MW.coords.ECL_POLE)), up = v3.cross(side, out);
        // камера в ~25° от линии «Солнце—аппарат» и смотрит между ними: в центре кадра и аппарат, и далёкое Солнце за ним
        const vd = v3.norm(v3.add(v3.add(v3.scale(out, 1.0), v3.scale(side, 0.42)), v3.scale(up, 0.12)));
        const aimAt = (cp) => {
          const toP = v3.norm(v3.sub(o.pos, cp)), toS = v3.norm(v3.scale(cp, -1));
          return v3.add(cp, v3.norm(v3.add(toP, v3.scale(toS, 0.85))));
        };
        return { obj: o, body: o, name: o.name, getPos: () => o.pos, arrive: o.radius * 1.25, viewDir: vd, aimAt };
      }
      if (o.kind === 'bh') {
        const vd = v3.norm(v3.add(v3.scale(o.frame.x, 1), v3.scale(o.normal, 0.22)));
        return { obj: o, name: o.name, getPos: () => o.pos, arrive: o.rs * 24, viewDir: vd };
      }
      if (o.kind === 'view') {
        const vd = v3.norm(o.viewDirRaw || [-0.55, 0.15, 1.0]);
        return { obj: o, name: o.name, getPos: () => o.pos, arrive: o.arrive || 125000, viewDir: vd };
      }
      if (o.kind === 'solarView') {
        this.pinned = false;
        const ecl = MW.coords.ECL_POLE;
        const vd = v3.norm(v3.add(v3.scale(ecl, 0.55), v3.norm(v3.cross(ecl, [0, 0, 1]))));
        return { obj: this.solar.star, name: 'Солнечная система', getPos: () => [0, 0, 0], arrive: 38 * MW.C.AU_LY, viewDir: vd };
      }
      if (o.kind === 'dso') {
        // активное ядро: первый «Лететь» — к галактике и джетам, повторный (камера уже рядом) — в самое ядро
        if (o.bhChild && this.lastCam && v3.dist(this.lastCam, o.pos) < o.radius * 4) return this.makeTarget(o.bhChild);
        const k = o.vis === 'galaxy' ? 2.2 : o.vis === 'globular' ? 2.6 : o.vis === 'cluster' ? 3.2 : 2.4;
        return { obj: o, name: o.name, getPos: () => o.pos, arrive: o.radius * k };
      }
      return { obj: o, name: o.name, getPos: () => o.pos, arrive: 1 };
    }
  }

  MW.Scene = Scene;
})();
