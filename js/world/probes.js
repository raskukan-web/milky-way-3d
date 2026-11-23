'use strict';
/* =====================================================================
 *  Космические аппараты «Вояджер-1» и «Вояджер-2».
 *  После последнего гравитационного манёвра аппараты летят почти по прямой
 *  (гиперболическая асимптота): положение = направление (RA/Dec) × расстояние,
 *  растущее линейно со временем. Опорные точки — пересечение гелиопаузы
 *  (NASA/JPL): V1 — 25.08.2012 на 121,6 а.е., V2 — 05.11.2018 на 119,0 а.е.
 *  Траектория внутри Солнечной системы — гладкая кривая через положения
 *  Земли при запуске и планет в реальные даты пролётов.
 * ===================================================================== */
(function () {
  const MW = window.MW;
  const v3 = MW.v3;
  const AU = MW.C.AU_LY;
  const jdOf = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000 + 2440587.5;
  const YR = 365.25;
  const RB_M = 13.5;                    // радиус ограничивающей сферы модели, м (штанга магнитометра 13 м)

  const DEF = [
    {
      id: 'voyager1', name: 'Вояджер-1', color: [1.0, 0.72, 0.32],
      ra: 17.22, dec: 12.0, con: 'Змееносец', hpJd: jdOf(2012, 8, 25), hpAU: 121.6, auYr: 3.57, kms: 16.95,
      launch: jdOf(1977, 9, 5), launchTxt: '5 сентября 1977 г., Канаверал (Titan IIIE-Centaur)',
      flybys: [['jupiter', jdOf(1979, 3, 5)], ['saturn', jdOf(1980, 11, 12)]],
      flybyTxt: 'Юпитер (05.03.1979), Сатурн и Титан (12.11.1980)',
      status: 'Межзвёздная среда с 25.08.2012; работают 2 прибора',
    },
    {
      id: 'voyager2', name: 'Вояджер-2', color: [0.45, 0.85, 1.0],
      ra: 20.13, dec: -59.5, con: 'Павлин / Телескоп', hpJd: jdOf(2018, 11, 5), hpAU: 119.0, auYr: 3.25, kms: 15.35,
      launch: jdOf(1977, 8, 20), launchTxt: '20 августа 1977 г., Канаверал (Titan IIIE-Centaur)',
      flybys: [['jupiter', jdOf(1979, 7, 9)], ['saturn', jdOf(1981, 8, 25)], ['uranus', jdOf(1986, 1, 24)], ['neptune', jdOf(1989, 8, 25)]],
      flybyTxt: 'Юпитер (1979), Сатурн (1981), Уран (1986), Нептун (1989)',
      status: 'Межзвёздная среда с 05.11.2018; работают 2 прибора',
    },
  ];

  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return [0, 1, 2].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
  }

  function build(solar) {
    const body = (id) => solar.bodies.find((b) => b.id === id);
    return DEF.map((d) => {
      const dir = v3.norm(MW.coords.radecToGal(d.ra, d.dec, 1));
      const linear = (jd) => v3.scale(dir, (d.hpAU + d.auYr * (jd - d.hpJd) / YR) * AU);
      // опорные точки траектории: Земля при запуске → планеты в дни пролётов → асимптота
      const lastJd = d.flybys[d.flybys.length - 1][1];
      const wp = [[d.launch, v3.add(body('earth').orbitFn(d.launch), [0, 0, 0])]];
      for (const [pid, jd] of d.flybys) wp.push([jd, body(pid).orbitFn(jd)]);
      for (const k of [2.5, 6, 12]) wp.push([lastJd + k * YR, linear(lastJd + k * YR)]);
      const at = (jd) => {
        if (jd <= wp[0][0]) return wp[0][1];
        if (jd >= wp[wp.length - 2][0]) return linear(jd);
        let i = 0;
        while (i < wp.length - 2 && jd > wp[i + 1][0]) i++;
        const t = (jd - wp[i][0]) / (wp[i + 1][0] - wp[i][0]);
        const P = (k) => wp[Math.max(0, Math.min(wp.length - 1, k))][1];
        return catmull(P(i - 1), P(i), P(i + 1), P(i + 2), t);
      };
      const fr = MW.solar.bodyFrame(v3.scale(dir, -1));   // ось антенны (+z) смотрит на Солнце/Землю
      return {
        kind: 'probe', id: d.id, name: d.name, def: d, dir, at, waypoints: wp,
        radius: RB_M / 1000 * MW.C.KM_LY, radiusM: RB_M, color: d.color, frame: fr, pos: at(Date.now() / 86400000 + 2440587.5),
        desc: 'Космический аппарат NASA', type: 'Межзвёздный зонд',
        src: 'NASA/JPL (траектория, телеметрия); 3D-модель — процедурная по чертежам',
        info: 'Модель собрана из примитивов по чертежам JPL: параболическая антенна 3,66 м, десятигранный корпус с Золотой пластинкой, '
          + 'штанга магнитометра 13 м, три РИТЭГа и научная платформа с камерами. Антенна направлена на Землю.',
      };
    });
  }

  // кривая пройденного пути (для линий), от запуска до jd
  function path(p, jd, n) {
    const out = [];
    const j0 = p.def.launch;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      out.push(p.at(j0 + (jd - j0) * u * u));      // гуще у начала, где кривая изгибается
    }
    return out;
  }

  MW.probes = { build, path, RB_M };
})();
