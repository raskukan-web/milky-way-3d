'use strict';
/* =====================================================================
 *  Солнечная система: кеплеровы элементы орбит (JPL, J2000 + вековые
 *  изменения), реальные радиусы, наклоны осей, спутники. Позиции
 *  считаются в эклиптике и переводятся в галактические координаты.
 * ===================================================================== */
(function () {
  const MW = window.MW;
  const { AU_LY, KM_LY, DEG } = MW.C;
  const v3 = MW.v3;

  // a(AU), e, I, L, ϖ (long. perihelion), Ω  + скорости за столетие
  const EL = {
    mercury: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593, 0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
    venus: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255, 0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418],
    earth: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0, 0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
    mars: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891, 0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
    jupiter: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909, -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
    saturn: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448, -0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
    uranus: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503, -0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
    neptune: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574, 0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
    pluto: [39.48211675, 0.24882730, 17.14001206, 238.92903833, 224.06891629, 110.30393684, -0.00031596, 0.00005170, 0.00004818, 145.20780515, -0.04062942, -0.01183482],
  };

  function solveKepler(M, e) {
    let E = M + e * Math.sin(M);
    for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    return E;
  }
  // гелиоцентрическая позиция в эклиптике (AU) на юлианскую дату
  function keplerPos(el, jd) {
    const T = (jd - 2451545.0) / 36525;
    const a = el[0] + el[6] * T, e = el[1] + el[7] * T, I = (el[2] + el[8] * T) * DEG;
    const L = el[3] + el[9] * T, wb = el[4] + el[10] * T, Om = (el[5] + el[11] * T) * DEG;
    const w = wb * DEG - Om;
    let M = ((L - wb) % 360) * DEG;
    const E = solveKepler(M, e);
    const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
    const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(Om), sO = Math.sin(Om), cI = Math.cos(I), sI = Math.sin(I);
    return [
      (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
      (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
      (sw * sI) * xp + (cw * sI) * yp,
    ];
  }
  // полюс по RA/Dec (IAU) → галактический вектор
  const poleFromRaDec = (raDeg, decDeg) => MW.coords.radecToGal(raDeg / 15, decDeg, 1);

  // Визуальные профили: type — номер ветки в шейдере планеты
  const PLANETS = [
    { id: 'mercury', tex: 'mercury', texH: 0.14, w0: 329.5988, wd: 6.1385108, name: 'Меркурий', radiusKm: 2439.7, rotH: 1407.6, pole: [281.01, 61.41], type: 0, col1: [0.42, 0.4, 0.38], col2: [0.6, 0.57, 0.53], bump: 6,
      info: 'Ближайшая к Солнцу планета. Испещрена кратерами, почти лишена атмосферы; перепад температур от −180 до +430 °C.', mass: '0.055 M⊕', period: '88 сут' },
    { id: 'venus', tex: 'venus', texAux: 'venus_surface', w0: 160.20, wd: -1.4813688, name: 'Венера', radiusKm: 6051.8, rotH: -5832.5, pole: [272.76, 67.16], type: 1, atmo: [0.95, 0.8, 0.55, 0.06], atmoDens: 6,
      info: 'Плотная атмосфера из CO₂ и облака серной кислоты; парниковый эффект разогревает поверхность до 465 °C.', mass: '0.815 M⊕', period: '225 сут' },
    { id: 'earth', tex: 'earth', texAux: 'earth_aux', texNrm: 'earth_nrm', name: 'Земля', radiusKm: 6371, rotH: 23.934, pole: [0, 90], type: 2, atmo: [0.28, 0.52, 1.0, 0.025], atmoDens: 9, clouds: 0.08, bump: 4,
      info: 'Наш дом. Единственная известная планета с жидкими океанами на поверхности и жизнью.', mass: '1 M⊕', period: '365.25 сут' },
    { id: 'mars', tex: 'mars', texH: 0.12, w0: 176.049863, wd: 350.891982443, name: 'Марс', radiusKm: 3389.5, rotH: 24.623, pole: [317.68, 52.89], type: 3, atmo: [0.9, 0.6, 0.45, 0.02], atmoDens: 1.6, bump: 6,
      info: 'Красная планета: оксиды железа, полярные шапки, вулкан Олимп и каньон Долины Маринер.', mass: '0.107 M⊕', period: '687 сут' },
    { id: 'jupiter', tex: 'jupiter', w0: 284.95, wd: 870.536, name: 'Юпитер', radiusKm: 69911, rotH: 9.925, pole: [268.06, 64.5], type: 4, col1: [0.93, 0.88, 0.78], col2: [0.62, 0.43, 0.3], col3: [0.82, 0.62, 0.45],
      bands: 22, turb: 1.0, feature: 1, atmo: [0.58, 0.64, 0.76, 0.006], atmoDens: 0.6,   // тонкая серо-голубая дымка: у лимба Юпитер темнеет, а не светлеет кремовым ободком
      info: 'Крупнейшая планета: газовый гигант с полосами облаков и Большим красным пятном — штормом крупнее Земли.', mass: '317.8 M⊕', period: '11.86 лет' },
    { id: 'saturn', tex: 'saturn', ringTex: 'saturn_ring', w0: 38.90, wd: 810.7939024, name: 'Сатурн', radiusKm: 58232, rotH: 10.656, pole: [40.59, 83.54], type: 5, col1: [0.9, 0.82, 0.64], col2: [0.76, 0.64, 0.45], col3: [0.7, 0.62, 0.5],
      bands: 16, turb: 0.5, feature: 3, ring: [1.11, 2.35, 1.0, 1], ringCol: [0.8, 0.72, 0.6], atmo: [0.85, 0.78, 0.6, 0.01], atmoDens: 2,
      info: 'Газовый гигант со знаменитыми кольцами из водяного льда шириной ~280 000 км и толщиной порядка 10 м.', mass: '95.2 M⊕', period: '29.46 лет' },
    { id: 'uranus', tex: 'uranus', w0: 203.81, wd: -501.1600928, name: 'Уран', radiusKm: 25362, rotH: -17.24, pole: [257.31, -15.18], type: 6, col1: [0.66, 0.85, 0.88], col2: [0.58, 0.79, 0.84], col3: [0.6, 0.78, 0.82],
      bands: 10, turb: 0.15, feature: 0, ring: [1.45, 4.05, 1.0, 2], ringCol: [0.5, 0.5, 0.52], atmo: [0.6, 0.85, 0.95, 0.02], atmoDens: 3,
      info: 'Ледяной гигант, «лежащий на боку»: ось наклонена на 98°. Метан придаёт атмосфере голубовато-зелёный цвет.', mass: '14.5 M⊕', period: '84 года' },
    { id: 'neptune', tex: 'neptune', w0: 249.978, wd: 541.1397757, name: 'Нептун', radiusKm: 24622, rotH: 16.11, pole: [299.36, 43.46], type: 7, col1: [0.33, 0.5, 0.92], col2: [0.22, 0.36, 0.8], col3: [0.3, 0.45, 0.85],
      bands: 12, turb: 0.6, feature: 2, atmo: [0.35, 0.5, 1.0, 0.02], atmoDens: 3,
      info: 'Самая дальняя планета; сильнейшие ветра в Солнечной системе (до 2100 км/ч) и тёмные вихри.', mass: '17.1 M⊕', period: '164.8 лет' },
    { id: 'pluto', name: 'Плутон', radiusKm: 1188.3, rotH: -153.2935, pole: [132.993, -6.163], type: 16, bump: 3, tex: 'pluto', texAux: 'pluto_mask', texH: 0.1, w0: 302.695, wd: 56.3625225,
      atmo: [0.55, 0.7, 1.0, 0.01], atmoDens: 0.4, dwarf: true, desc: 'Карликовая планета',
      info: 'Карликовая планета пояса Койпера. «Сердце» — равнина Спутника из азотного льда; тонкая голубая дымка атмосферы (New Horizons, 2015).', mass: '0.0022 M⊕', period: '248 лет' },
  ];

  // Спутники: a (км), период (сут), радиус (км)
  const MOONS = [
    { id: 'moon', tex: 'moon', texH: 0.14, name: 'Луна', parent: 'earth', aKm: 384400, periodD: 27.3217, radiusKm: 1737.4, type: 8, incl: 5.145, bump: 3, info: 'Единственный естественный спутник Земли. Тёмные пятна — базальтовые «моря».' },
    { id: 'phobos', name: 'Фобос', parent: 'mars', aKm: 9376, periodD: 0.31891, radiusKm: 11.08, type: 0, col1: [0.22, 0.2, 0.18], col2: [0.36, 0.33, 0.3], bump: 7,
      info: 'Ближний спутник Марса: обращается быстрее, чем Марс вращается, — с поверхности восходит на западе и пересекает небо за ~4,5 ч. Через ~50 млн лет разрушится приливами.' },
    { id: 'deimos', name: 'Деймос', parent: 'mars', aKm: 23463, periodD: 1.26244, radiusKm: 6.2, type: 0, col1: [0.3, 0.27, 0.24], col2: [0.45, 0.41, 0.37], bump: 5,
      info: 'Дальний спутник Марса: с поверхности — яркая звёздочка, медленно ползущая по небу ~2,5 суток от восхода до заката.' },
    { id: 'io', tex: 'io', texH: 0.08, name: 'Ио', parent: 'jupiter', aKm: 421700, periodD: 1.769, radiusKm: 1821.6, type: 9, bump: 3, info: 'Самое вулканически активное тело Солнечной системы.' },
    { id: 'europa', tex: 'europa', texAux: 'europa_mask', texH: 0.08, name: 'Европа', parent: 'jupiter', aKm: 671034, periodD: 3.551, radiusKm: 1560.8, type: 10, bump: 3, info: 'Ледяная кора скрывает подлёдный океан — кандидат на поиск жизни.' },
    { id: 'ganymede', tex: 'ganymede', texAux: 'ganymede_mask', texH: 0.1, name: 'Ганимед', parent: 'jupiter', aKm: 1070412, periodD: 7.155, radiusKm: 2634.1, type: 0, col1: [0.45, 0.42, 0.38], col2: [0.7, 0.67, 0.62], bump: 5, info: 'Крупнейший спутник в Солнечной системе, больше Меркурия.' },
    { id: 'callisto', tex: 'callisto', texAux: 'callisto_mask', texH: 0.12, name: 'Каллисто', parent: 'jupiter', aKm: 1882709, periodD: 16.689, radiusKm: 2410.3, type: 0, col1: [0.25, 0.22, 0.2], col2: [0.5, 0.47, 0.42], bump: 7, info: 'Одна из самых кратерированных поверхностей.' },
    { id: 'titan', tex: 'titan', name: 'Титан', parent: 'saturn', aKm: 1221870, periodD: 15.945, radiusKm: 2574.7, type: 11, atmo: [0.95, 0.6, 0.25, 0.12], atmoDens: 7, info: 'Плотная азотная атмосфера, метановые моря и дожди.' },
    { id: 'enceladus', tex: 'enceladus', texH: 0.1, name: 'Энцелад', parent: 'saturn', aKm: 237948, periodD: 1.37, radiusKm: 252.1, type: 16, bump: 3, info: 'Гейзеры водяного льда бьют из «тигровых полос» южного полюса.' },
    { id: 'rhea', name: 'Рея', parent: 'saturn', aKm: 527108, periodD: 4.518, radiusKm: 763.8, type: 0, col1: [0.6, 0.6, 0.6], col2: [0.8, 0.8, 0.78], bump: 6, info: 'Второй по величине спутник Сатурна.' },
    { id: 'triton', tex: 'triton', texAux: 'triton_mask', texH: 0.08, name: 'Тритон', parent: 'neptune', aKm: 354759, periodD: -5.877, radiusKm: 1353.4, type: 16, bump: 3, info: 'Обращается в обратную сторону; азотные гейзеры.' },
    { id: 'titania', name: 'Титания', parent: 'uranus', aKm: 435910, periodD: 8.706, radiusKm: 788.4, type: 0, col1: [0.45, 0.43, 0.42], col2: [0.62, 0.6, 0.58], bump: 6, info: 'Крупнейший спутник Урана.' },
  ];

  const SUN = {
    id: 'sun', kind: 'star', name: 'Солнце', spec: 'G2V', temp: 5772, radiusSun: 1, absMag: 4.83, lum: 1, mag: -26.74, dist: 0,
    color: MW.color.blackbody(5772), pos: [0, 0, 0], isSun: true,
    info: 'Звезда спектрального класса G2V, возраст ~4.6 млрд лет. Находится в рукаве Ориона в 26 000 св. лет от центра Галактики.',
  };

  function bodyFrame(pole) {
    // базис: z = полюс; x — к направлению узла (произвольно, но стабильно)
    const z = v3.norm(pole);
    let x = v3.cross(MW.coords.NCP, z);
    x = v3.len(x) < 1e-6 ? v3.perp(z) : v3.norm(x);
    const y = v3.cross(z, x);
    return { x, y, z };
  }

  function buildSolarSystem() {
    const star = Object.assign({}, SUN);
    star.radius = MW.C.RSUN_LY;
    const sys = { id: 'sol', star, bodies: [], isSolar: true, pos: [0, 0, 0] };
    const byId = {};
    for (const p of PLANETS) {
      const pole = poleFromRaDec(p.pole[0], p.pole[1]);
      const b = Object.assign({}, p, { kind: 'planet', system: sys, parent: null, radius: p.radiusKm * KM_LY, frame: bodyFrame(pole), pole: v3.norm(pole), poleRaDec: p.pole, seed: (MW.rng.hashStr(p.id) % 1000) / 1000 });
      b.orbitFn = (jd) => MW.coords.eclToGal(keplerPos(EL[p.id], jd)).map((c) => c * AU_LY);
      b.aAU = EL[p.id][0];
      if (p.wd !== undefined) b.spinFn = (jd) => (p.w0 + p.wd * (jd - 2451545.0)) * DEG;
      if (p.id === 'earth') {
        // реальная ориентация Земли: x — к точке весеннего равноденствия, поворот = угол вращения Земли (ERA)
        const z = MW.coords.NCP, x = v3.norm(MW.m3.mulVec(MW.coords.EQ2GAL, [1, 0, 0]));
        b.frame = { x, y: v3.cross(z, x), z };
        b.pole = z;
        b.spinFn = (jd) => 2 * Math.PI * (0.779057273264 + 1.00273781191135448 * (jd - 2451545.0));
      }
      sys.bodies.push(b); byId[p.id] = b;
    }
    for (const m of MOONS) {
      const par = byId[m.parent];
      // спутники обращаются в экваториальной плоскости планеты (Луна — около эклиптики)
      const pole = m.id === 'moon' ? v3.norm(v3.rotAxis(MW.coords.ECL_POLE, par.frame.x, m.incl * DEG)) : par.pole;
      const fr = bodyFrame(pole);
      const ph0 = (MW.rng.hashStr(m.id) % 6283) / 1000;
      const b = Object.assign({}, m, { kind: 'moon', system: sys, parentBody: par, radius: m.radiusKm * KM_LY, frame: fr, pole, rotH: Math.abs(m.periodD) * 24, seed: (MW.rng.hashStr(m.id) % 1000) / 1000 });
      const phase = (jd) => (2 * Math.PI * (jd - 2451545.0)) / m.periodD + ph0;
      b.orbitFn = (jd) => {
        const a = phase(jd);
        const r = m.aKm * KM_LY;
        return v3.add(v3.scale(fr.x, Math.cos(a) * r), v3.scale(fr.y, Math.sin(a) * r));
      };
      // приливный захват: локальная ось +x всегда смотрит на планету
      b.spinFn = (jd) => phase(jd) + Math.PI;
      sys.bodies.push(b); byId[m.id] = b;
    }
    sys.byId = byId;
    return sys;
  }

  MW.solar = { buildSolarSystem, keplerPos, EL, bodyFrame };
})();
