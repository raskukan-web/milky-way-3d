'use strict';
/* =====================================================================
 *  Детерминированная генерация планетных систем для любых звёзд
 *  (каталожных и процедурных): типы миров по равновесной температуре,
 *  снеговая линия, кольца, спутники, палитры.
 * ===================================================================== */
(function () {
  const MW = window.MW;
  const { AU_LY, KM_LY, DEG } = MW.C;
  const v3 = MW.v3;
  const RE = 6371 * KM_LY;
  const LETTERS = 'bcdefghijk';

  const TERRAN_VEG = [[0.05, 0.1, 0.03], [0.12, 0.14, 0.05], [0.2, 0.08, 0.05], [0.04, 0.1, 0.09], [0.15, 0.06, 0.14]];
  const ARID = [[0.45, 0.36, 0.22], [0.5, 0.3, 0.18], [0.38, 0.33, 0.28]];
  const OCEAN = [[0.01, 0.04, 0.1], [0.01, 0.07, 0.09], [0.02, 0.03, 0.08]];
  const GAS = [
    [[0.93, 0.86, 0.72], [0.66, 0.46, 0.3], [0.85, 0.65, 0.45]],
    [[0.85, 0.9, 0.96], [0.55, 0.65, 0.8], [0.7, 0.75, 0.85]],
    [[0.9, 0.78, 0.9], [0.55, 0.38, 0.6], [0.7, 0.55, 0.75]],
    [[0.75, 0.92, 0.85], [0.35, 0.6, 0.55], [0.55, 0.75, 0.7]],
    [[0.98, 0.9, 0.6], [0.8, 0.55, 0.25], [0.9, 0.75, 0.4]],
  ];
  const HOTJ = [[0.55, 0.22, 0.12], [0.25, 0.08, 0.05], [0.8, 0.4, 0.15]];
  const ICEG = [[[0.6, 0.85, 0.9], [0.5, 0.75, 0.85], [0.55, 0.8, 0.88]], [[0.35, 0.55, 0.95], [0.25, 0.4, 0.85], [0.3, 0.5, 0.9]], [[0.55, 0.9, 0.8], [0.4, 0.75, 0.7], [0.5, 0.8, 0.75]]];

  function randomFrame(rnd, baseNormal, tiltDeg) {
    let z = baseNormal || v3.norm([rnd.gauss(), rnd.gauss(), rnd.gauss()]);
    if (tiltDeg) z = v3.norm(v3.rotAxis(z, v3.perp(z), (rnd() * 2 - 1) * tiltDeg * DEG));
    return MW.solar.bodyFrame(z);
  }

  // Физический тип звезды для шейдера: 0 M/K-карлик, 1 F/G-карлик, 2 горячая OBA, 3 красный гигант, 4 белый карлик
  const KIND_NAMES = ['красный/оранжевый карлик', 'жёлтый карлик', 'горячая бело-голубая звезда', 'красный гигант / сверхгигант', 'белый карлик'];
  // быстрые ротаторы с измеренной сплющенностью (интерферометрия CHARA/VLTI): 1 − Rpol/Req
  const FLAT = { vega: 0.19, altair: 0.2, regulus: 0.24, achernar: 0.3, alderamin: 0.2 };
  function starKind(star) {
    const sp = (star.spec || '').trim(), T = star.temp || 5800, R = star.radiusSun || 1;
    if (/^(D|WD)/.test(sp) || (R < 0.05 && T > 4000)) return 4;
    if (T < 6200 && (R > 6 || /(^|[^V])(III|II|Ia|Iab|Ib)\b/.test(sp))) return 3;
    if (T >= 7300) return 2;
    if (T >= 5300) return 1;
    return 0;
  }
  // Четыре независимых случайных числа объекта из хэша его ID и имени: сдвиг и поворот координат шума,
  // масштаб ячеек, рисунок пятен/материков/штормов. Два разных объекта не получают одинаковый узор.
  function objRnd(o) {
    const r = MW.rng.mulberry32(MW.rng.hashStr(String(o.id || '') + '|' + String(o.name || '')) ^ 0x2545f491);
    r(); r();
    return [r(), r(), r(), r()];
  }
  // Визуальные параметры звезды для шейдера
  function starVisual(star) {
    const R = star.radiusSun || 1, T = star.temp || 5800;
    const kind = starKind(star);
    const rnd = objRnd(star);
    const seed = rnd[0];
    const v = { kind, seed, rnd, flat: 0, corona: 1, bright: 2.0, spin: 0.01, gran: 90, activity: 0.6 };
    // масштаб конвективных ячеек и активность (площадь пятен) у каждой звезды свои
    const gk = 0.75 + 0.5 * rnd[3], ak = 0.6 + 0.8 * rnd[2];
    if (kind === 0) { v.gran = MW.util.clamp(14 + 18 * R, 14, 34) * gk; v.activity = (T < 3900 ? 1.3 : 1.0) * ak; }
    else if (kind === 1) { v.gran = MW.util.clamp(90 / (1 + 2.6 * Math.max(0, Math.log10(Math.max(R, 0.1)))), 18, 120) * gk; v.activity = MW.util.clamp(1.1 - (T - 5300) / 1800, 0.25, 0.8) * ak; }
    else if (kind === 2) { v.gran = 30; v.activity = 0; v.bright = 2.6; v.spin = 0.05; v.flat = FLAT[star.id] ?? (R < 4 ? 0.06 : 0.02); v.corona = 1.0; }
    else if (kind === 3) { v.gran = 2.6 * (0.8 + 0.4 * rnd[3]); v.activity = 0; v.bright = 1.7; v.spin = 0.003; }
    else { v.gran = 0; v.activity = 0; v.bright = 3.2; v.spin = 0.1; }
    v.kindName = KIND_NAMES[kind];
    return v;
  }

  function generateSystem(star) {
    const seed = (star.seed || MW.rng.hashStr(star.id)) >>> 0;
    const rnd = MW.rng.mulberry32(seed ^ 0x9e3779b9);
    const sys = { id: 'sys_' + star.id, star, bodies: [], pos: star.pos, byId: {} };
    star.radius = (star.radiusSun || 1) * MW.C.RSUN_LY;
    const L = Math.max(star.lum || 1, 1e-4);
    const Mstar = Math.max(0.08, Math.pow(L, 1 / 3.5));
    // 3–7 планет у любой звезды; орбиты расставлены так, что одна из них часто попадает в зону обитаемости
    const n = rnd.int(3, 7);
    const snow = 2.7 * Math.sqrt(L);
    const rStarAU = (star.radiusSun || 1) * 0.00465;
    const steps = [1]; for (let i = 1; i < n; i++) steps.push(steps[i - 1] * rnd.range(1.45, 2.0));
    const minA = Math.max(0.02 * Math.sqrt(L), rStarAU * 4);
    let a0 = minA * rnd.range(1.0, 1.8);
    const hz = Math.sqrt(L);
    if (rnd() < 0.7 && hz > minA * 1.5) { const j = rnd.int(0, Math.min(n - 1, 3)); a0 = Math.max(minA, hz * rnd.range(0.9, 1.15) / steps[j]); }
    const planeN = v3.norm([rnd.gauss(), rnd.gauss(), rnd.gauss()]);
    // СТРОГИЙ НАУЧНЫЙ РЕЖИМ: только подтверждённые планеты из NASA Exoplanet Archive, никаких выдуманных миров
    if (MW.STRICT) {
      if (star.exoNasa) buildNasaPlanets(sys, star, rnd, planeN);
      return sys;
    }
    // реальная экзопланетная система (TRAPPIST-1, Проксима, Kepler-186 …)
    if (star.exo) {
      const fr = randomFrame(rnd, planeN, 0);
      star.exo.forEach(([letter, aAU, rE, periodD, Teq], i) => {
        const p = { kind: 'planet', system: sys, seed: rnd(), exoReal: true, name: (star.name || star.id) + ' ' + letter, id: star.id + '_' + i, temp: Teq };
        if (rE > 6) { p.type = 14; [p.col1, p.col2, p.col3] = Teq > 900 ? HOTJ : rnd.pick(GAS); p.bands = rnd.range(10, 24); p.turb = Teq > 900 ? 1.4 : 0.8; p.atmo = [0.85, 0.75, 0.7, 0.012]; p.atmoDens = 2; p.desc = Teq > 900 ? 'Горячий юпитер' : 'Газовый гигант'; }
        else if (rE > 2.4) { p.type = 17; [p.col1, p.col2, p.col3] = rnd.pick(ICEG); p.bands = 10; p.turb = 0.3; p.atmo = [0.5, 0.75, 1.0, 0.02]; p.atmoDens = 3; p.desc = 'Мини-нептун'; }
        else if (Teq > 700) { p.type = 15; p.bump = 4; p.desc = 'Лавовый мир'; }
        else if (Teq > 330) { p.type = 13; p.col1 = rnd.pick(ARID); p.col2 = rnd.pick(ARID); p.par = [-10, -0.5, 0, 0]; p.bump = 5; p.atmo = [0.95, 0.7, 0.45, 0.03]; p.atmoDens = 3; p.desc = 'Горячий каменный мир'; }
        else if (Teq > 205) { p.type = 12; p.col1 = rnd.pick(TERRAN_VEG); p.col2 = rnd.pick(ARID); p.col3 = rnd.pick(OCEAN); p.par = [rnd.range(-0.1, 0.2), (Teq - 255) / 120, 0.1, 0]; p.clouds = 0.1; p.atmo = [0.3, 0.55, 1.0, 0.025]; p.atmoDens = 8; p.bump = 4; p.desc = 'Потенциально обитаемая планета (вид — гипотетический)'; p.habitable = true; }
        else { p.type = rnd() < 0.5 ? 16 : 3; p.bump = 4; p.atmo = p.type === 3 ? [0.9, 0.62, 0.48, 0.015] : undefined; p.atmoDens = 1.2; p.desc = 'Холодный мир'; }
        p.radius = rE * RE; p.radiusKm = rE * 6371; p.aAU = aAU; p.periodD = periodD;
        p.period = periodD < 700 ? periodD.toFixed(2) + ' сут' : (periodD / 365.25).toFixed(1) + ' лет';
        p.frame = MW.solar.bodyFrame(v3.norm(v3.rotAxis(fr.z, fr.x, rnd.range(0, 25) * DEG))); p.pole = p.frame.z;
        p.rotH = periodD * 24; // приливный захват у близких планет
        const ph0 = rnd() * Math.PI * 2;
        p.orbitFn = (jd) => { const M = (2 * Math.PI * (jd - 2451545.0)) / periodD + ph0; return v3.add(v3.scale(fr.x, Math.cos(M) * aAU * AU_LY), v3.scale(fr.y, Math.sin(M) * aAU * AU_LY)); };
        p.info = 'Реальная экзопланета: a = ' + aAU + ' а.е., радиус ≈ ' + rE + ' R⊕, равновесная температура ≈ ' + Teq + ' K. ' + p.desc + '.';
        sys.bodies.push(p); sys.byId[p.id] = p;
      });
      return sys;
    }
    for (let i = 0; i < n; i++) {
      const a = a0 * steps[i];
      const Teq = 278 * Math.pow(L, 0.25) / Math.sqrt(a);
      const p = { kind: 'planet', system: sys, seed: rnd(), name: (star.name || star.id) + ' ' + LETTERS[i], id: star.id + '_' + LETTERS[i] };
      let rE;
      const r = rnd();
      if (a > snow) {
        if (r < 0.55) { p.type = 14; rE = rnd.range(7, 13); const pal = rnd.pick(GAS); [p.col1, p.col2, p.col3] = pal; p.bands = rnd.range(12, 28); p.turb = rnd.range(0.4, 1.2); p.feature = rnd() < 0.3 ? 1 : 0; p.atmo = [0.8, 0.8, 0.85, 0.012]; p.atmoDens = 2; p.desc = 'Газовый гигант'; }
        else if (r < 0.8) { p.type = 17; rE = rnd.range(3.4, 4.8); const pal = rnd.pick(ICEG); [p.col1, p.col2, p.col3] = pal; p.bands = rnd.range(8, 14); p.turb = rnd.range(0.1, 0.5); p.feature = rnd() < 0.3 ? 2 : 0; p.atmo = [0.5, 0.75, 1.0, 0.02]; p.atmoDens = 3; p.desc = 'Ледяной гигант'; }
        else { p.type = 16; rE = rnd.range(0.3, 1.2); p.desc = 'Ледяной мир'; p.bump = 3; }
        if ((p.type === 14 && rnd() < 0.4) || (p.type === 17 && rnd() < 0.3)) {
          const ri = rnd.range(1.25, 1.6);
          p.ring = [ri, ri + rnd.range(0.5, 1.3), rnd.range(0.5, 0.95), 3];
          p.ringCol = rnd() < 0.5 ? [0.78, 0.7, 0.58] : [0.6, 0.62, 0.66];
        }
      } else if (Teq > 1000) {
        if (r < 0.15) { p.type = 14; rE = rnd.range(9, 15); [p.col1, p.col2, p.col3] = HOTJ; p.bands = rnd.range(8, 16); p.turb = 1.4; p.feature = 0; p.atmo = [1.0, 0.5, 0.3, 0.02]; p.atmoDens = 3; p.desc = 'Горячий юпитер'; }
        else { p.type = 15; rE = rnd.range(0.4, 1.6); p.desc = 'Лавовый мир'; p.bump = 4; p.atmo = [1.0, 0.45, 0.2, 0.02]; p.atmoDens = 1.2; }
      } else if (Teq > 480 && r < 0.4) {
        p.type = 1; rE = rnd.range(0.8, 1.3); p.atmo = [0.95, 0.8, 0.55, 0.06]; p.atmoDens = 6; p.desc = 'Венероподобный мир (плотная атмосфера)';
      } else if (Teq > 340) {
        p.type = rnd() < 0.55 ? 13 : 0; rE = rnd.range(0.3, 1.5);
        p.col1 = rnd.pick(ARID); p.col2 = rnd.pick(ARID); p.par = [-10, -0.5, 0, 0]; p.bump = 5;
        if (p.type === 13 && rnd() < 0.5) { p.atmo = [0.95, 0.7, 0.45, 0.03]; p.atmoDens = 4; }
        p.desc = p.type === 0 ? 'Безатмосферный кратерированный мир' : 'Пустынная планета с кратерами';
      } else if (Teq > 200 && r > 0.78) {
        p.type = 3; rE = rnd.range(0.4, 0.9); p.atmo = [0.9, 0.6, 0.45, 0.02]; p.atmoDens = 1.6; p.bump = 6;
        p.desc = 'Марсоподобная планета (ржавые пустыни, полярные шапки)';
      } else if (Teq > 200) {
        const wet = rnd() < 0.78;
        p.type = wet ? 12 : 13; rE = rnd.range(0.6, 1.7);
        p.col1 = rnd.pick(TERRAN_VEG); p.col2 = rnd.pick(ARID); p.col3 = rnd.pick(OCEAN);
        const temp = (Teq - 255) / 120;
        p.par = [wet ? rnd.range(-0.15, 0.25) : -10, temp, wet ? rnd.range(0.0, 0.2) : 0.0, 0];
        p.clouds = wet ? p.par[2] : 0;
        p.atmo = wet ? [0.3, 0.55, 1.0, 0.025] : [0.9, 0.7, 0.5, 0.02];
        p.atmoDens = wet ? rnd.range(6, 11) : 3;
        p.bump = 4;
        p.desc = wet ? (temp > -0.3 ? 'Землеподобная планета (океаны)' : 'Холодный океанический мир') : 'Сухая каменная планета';
        p.habitable = wet && Math.abs(temp) < 0.4;
      } else if (r < 0.35) {
        p.type = 3; rE = rnd.range(0.3, 0.8); p.atmo = [0.9, 0.62, 0.48, 0.015]; p.atmoDens = 1.2; p.bump = 6;
        p.desc = 'Холодный марсоподобный мир';
      } else {
        p.type = rnd() < 0.5 ? 16 : 0; rE = rnd.range(0.3, 1.3);
        p.col1 = [0.55, 0.55, 0.58]; p.col2 = [0.75, 0.75, 0.78]; p.bump = 4;
        p.desc = p.type === 16 ? 'Ледяной мир' : 'Холодный кратерированный мир';
      }
      if ((p.type === 14 || p.type === 17) && !p.ring && rnd() < 0.15) {
        const ri = rnd.range(1.3, 1.7);
        p.ring = [ri, ri + rnd.range(0.4, 1.0), rnd.range(0.4, 0.8), 3];
        p.ringCol = [0.7, 0.66, 0.6];
      }
      p.radius = rE * RE;
      p.radiusKm = rE * 6371;
      p.aAU = a;
      const ecc = rnd() * rnd() * 0.25;
      const fr = randomFrame(rnd, planeN, 4);
      const pole = v3.norm(v3.rotAxis(fr.z, fr.x, rnd.range(0, 40) * DEG));
      p.frame = MW.solar.bodyFrame(pole); p.pole = p.frame.z;
      p.rotH = p.type === 14 || p.type === 17 ? rnd.range(9, 18) : rnd.range(14, 60) * (rnd() < 0.1 ? -1 : 1);
      const periodD = 365.25 * Math.sqrt(a * a * a / Mstar);
      const ph0 = rnd() * Math.PI * 2, w0 = rnd() * Math.PI * 2;
      p.periodD = periodD; p.ecc = ecc;
      p.period = periodD < 700 ? periodD.toFixed(1) + ' сут' : (periodD / 365.25).toFixed(1) + ' лет';
      p.orbitFn = (jd) => {
        const M = (2 * Math.PI * (jd - 2451545.0)) / periodD + ph0;
        let E = M; for (let k = 0; k < 5; k++) E -= (E - ecc * Math.sin(E) - M) / (1 - ecc * Math.cos(E));
        const xr = a * (Math.cos(E) - ecc) * AU_LY, yr = a * Math.sqrt(1 - ecc * ecc) * Math.sin(E) * AU_LY;
        const cw = Math.cos(w0), sw = Math.sin(w0);
        return v3.add(v3.scale(fr.x, xr * cw - yr * sw), v3.scale(fr.y, xr * sw + yr * cw));
      };
      p.info = p.desc + ' на орбите ' + (a < 0.1 ? a.toFixed(3) : a.toFixed(2)) + ' а.е.; равновесная температура ≈ ' + Math.round(Teq) + ' K.' + (p.habitable ? ' Находится в зоне обитаемости!' : '');
      p.temp = Math.round(Teq);
      sys.bodies.push(p); sys.byId[p.id] = p;
      // спутники
      const giant = p.type === 14 || p.type === 17;
      const nm = p.type === 14 ? rnd.int(1, 4) : p.type === 17 ? rnd.int(1, 3) : (rnd() < 0.55 ? rnd.int(1, 2) : 0);
      for (let j = 0; j < nm; j++) {
        const mr = giant ? rnd.range(0.12, 0.45) : rnd.range(0.15, 0.3);
        const am = p.radius * (p.ring ? p.ring[1] + 2 + j * rnd.range(2, 6) : (giant ? rnd.range(6, 14) : rnd.range(25, 60)) + j * rnd.range(4, 12));
        const mfr = randomFrame(rnd, p.pole, 6);
        // у гигантов — вулканические, ледяные и окутанные дымкой спутники; у землеподобных — кратерированные «луны»
        const mType = giant ? rnd.pick([0, 0, 16, 9, 10, 11, 13]) : rnd.pick([8, 8, 0, 13]);
        const mper = 0.8 + Math.pow(am / p.radius, 1.5) * 0.12 * (p.type === 14 ? 0.6 : 1.4);
        const ph = rnd() * Math.PI * 2;
        const m = {
          kind: 'moon', system: sys, parentBody: p, seed: rnd(), id: p.id + '_m' + (j + 1), name: p.name + ' ' + ['I', 'II', 'III', 'IV'][j],
          type: mType, radius: mr * RE, radiusKm: mr * 6371, col1: [0.4, 0.38, 0.36], col2: [0.65, 0.62, 0.58], col3: [0.3, 0.3, 0.3], par: [-10, -1, 0, 0], bump: 5,
          frame: mfr, pole: mfr.z, rotH: mper * 24, periodD: mper, desc: 'Спутник',
          info: 'Спутник планеты ' + p.name + '.',
        };
        if (mType === 11) { m.atmo = [0.95, 0.6, 0.25, 0.1]; m.atmoDens = 6; m.info = 'Спутник с плотной оранжевой дымкой (как Титан) у планеты ' + p.name + '.'; }
        m.orbitFn = (jd) => { const an = (2 * Math.PI * (jd - 2451545.0)) / mper + ph; return v3.add(v3.scale(mfr.x, Math.cos(an) * am), v3.scale(mfr.y, Math.sin(an) * am)); };
        m.spinFn = (jd) => (2 * Math.PI * (jd - 2451545.0)) / mper + ph + Math.PI;
        sys.bodies.push(m); sys.byId[m.id] = m;
      }
    }
    return sys;
  }

  /* ---------- планеты из NASA Exoplanet Archive ----------
     Вид выбирается строго по измеренным параметрам: радиус (или радиус по массе, Chen & Kipping 2017),
     масса, равновесная температура. Кольца и спутники не добавляются — они не подтверждены. */
  function radiusFromMass(m) {
    if (m < 2.04) return Math.pow(m, 0.279);
    if (m < 132) return 0.808 * Math.pow(m, 0.589);
    return 11.2;
  }
  /* Палитры экзопланет: по температуре меняется химия облаков —
     холодные (CH₄) — глубокий сине-бирюзовый, тёплые — бирюзовые/зеленоватые, горячие — янтарно-шоколадные. */
  const EXO_PAL = {
    iceCold: [[0.32, 0.72, 0.9], [0.04, 0.18, 0.5], [0.82, 0.95, 1.0]],
    iceTeal: [[0.42, 0.84, 0.78], [0.05, 0.32, 0.42], [0.86, 0.98, 0.95]],
    iceWarm: [[0.9, 0.66, 0.34], [0.3, 0.14, 0.06], [0.98, 0.87, 0.62]],
    gasCold: [[0.95, 0.88, 0.74], [0.5, 0.29, 0.15], [0.98, 0.94, 0.85]],
    gasPale: [[0.86, 0.9, 0.96], [0.36, 0.46, 0.66], [0.96, 0.97, 1.0]],
    gasWarm: [[0.94, 0.78, 0.52], [0.44, 0.24, 0.11], [1.0, 0.9, 0.7]],
    hotJ: [[0.52, 0.15, 0.08], [0.14, 0.035, 0.03], [0.86, 0.42, 0.18]],
  };
  // Цвет рассеяния у лимба и цвет океанов — по спектру звезды: свет красного карлика даёт персиково-оранжевый
  // ободок и тёмные океаны, жёлтой звезды — золотисто-голубой, горячей F/A — ярко-синий.
  function starTint(teff) {
    if (teff < 3900) return { rim: [1.0, 0.6, 0.36], ocean: [0.014, 0.03, 0.045], atmo: [1.0, 0.64, 0.42], name: 'красного карлика (M)', glow: 'персиково-оранжевый' };
    if (teff < 5200) return { rim: [1.0, 0.8, 0.55], ocean: [0.012, 0.04, 0.085], atmo: [0.95, 0.78, 0.62], name: 'оранжевого карлика (K)', glow: 'тёплый янтарный' };
    if (teff < 6000) return { rim: [0.72, 0.82, 1.0], ocean: [0.012, 0.05, 0.13], atmo: [0.42, 0.62, 1.0], name: 'жёлтой звезды (G)', glow: 'золотисто-голубой' };
    return { rim: [0.36, 0.58, 1.0], ocean: [0.008, 0.06, 0.18], atmo: [0.3, 0.52, 1.0], name: 'горячей звезды (F/A)', glow: 'ярко-синий' };
  }
  const fmtP = (P) => (P < 2 ? P.toFixed(2) : P < 20 ? P.toFixed(1) : Math.round(P)) + ' сут';
  /* Облик экзопланеты рассчитывается из её реальных параметров (NASA Exoplanet Archive):
     Tэкв, период/расстояние (→ приливный захват и скорость вращения), масса, радиус, спектр звезды.
     p.exo = [стиль, тепловое свечение, длина хвоста (R), ободок]; стили: 1 гигант/нептун, 2 горячий юпитер,
     3 лавовый мир, 4 каменный, 5 горячий мир в приливном захвате, 6 «глазное яблоко».
     p.par2z: у газовых — медленность вращения (0 быстрое … 1 захват), у каменных — резкость рельефа.
     p.why — пояснение для карточки: почему планета выглядит именно так. */
  function classify(p) {
    const R = p.radiusE, T = p.teq ?? 300, s = p.seed;
    const teff = p.hostTeff || 5800, tint = starTint(teff);
    const P = p.periodD || 365;
    const M = p.massE || (R < 1.6 ? Math.pow(R, 3.7) : null);
    const Mtxt = M ? (M < 10 ? M.toFixed(2) : Math.round(M)) + ' M⊕' + (p.massE ? '' : ' (оценка)') : '';
    // приливный захват: на коротких орбитах вращение синхронизируется за время много меньше возраста системы
    const locked = P < 20 || (p.aAU && p.aAU < 0.06);
    const Tss = Math.round(T * Math.SQRT2);   // подсолнечная точка при захвате без переноса тепла
    const why = []; p.why = why; p.locked = locked;
    const giant = R >= 8 || (p.massE && p.massE >= 60);
    // осевое вращение: при захвате сутки = году; иначе оценка по аналогии с Солнечной системой
    if (locked) { p.rotH = P * 24; p.rotEst = false; }
    else { p.rotH = giant ? 9 + 7 * s : R >= 1.6 ? 14 + 6 * s : 18 + 22 * s; p.rotEst = true; }
    const fast = !locked && p.rotH < 15;
    if (giant || R >= 1.6) {
      // ---- газовые гиганты и нептуны: вращение задаёт структуру облаков
      p.par2z = locked ? 1 : fast ? 0 : 0.35;
      const nb = locked ? 4 + Math.round(s * 3) : fast ? 18 + Math.round(s * 12) : 10 + Math.round(s * 5);
      p.bands = nb;
      if (locked) why.push('Приливный захват (период ' + fmtP(P) + '): сутки равны году, вращение медленное — сила Кориолиса слабая, поэтому вместо узких полос несколько широких зон, гигантские спиральные циклоны и шевронные облачные волны.');
      else why.push('Вращение не захвачено; период оценён по аналогии с Юпитером и Нептуном (~' + p.rotH.toFixed(0) + ' ч). ' + (fast ? 'Быстрое вращение рвёт атмосферу на ' + nb + ' тонких контрастных широтных поясов с мелкими вихрями.' : 'Умеренное вращение — ' + nb + ' широких поясов.'));
    }
    if (giant) {
      p.type = 14; p.turb = T > 1000 ? 1.4 : 0.9; p.atmo = [0.85, 0.8, 0.75, 0.015]; p.atmoDens = 2.5;
      if (T > 1000) {
        [p.col1, p.col2, p.col3] = EXO_PAL.hotJ;
        p.exo = [2, MW.util.clamp((T - 900) / 1100, 0.25, 1.3), T > 1200 ? 7 : 0, 0.7]; p.rim = [1.0, 0.5, 0.25]; p.atmo = [1.0, 0.5, 0.3, 0.03]; p.atmoDens = 3;
        why.push('Tэкв ' + Math.round(T) + ' K: дневная сторона светится в ИК, горячее пятно смещено ветрами на восток' + (T > 1200 ? ', а излучение звезды сдувает с планеты газовый шлейф.' : '.'));
        return 'Горячий юпитер';
      }
      [p.col1, p.col2, p.col3] = T > 400 ? EXO_PAL.gasWarm : T > 150 ? EXO_PAL.gasCold : EXO_PAL.gasPale;
      p.exo = [1, 0, 0, 0.6];
      const rim0 = T > 150 ? [0.95, 0.85, 0.7] : [0.6, 0.78, 1.0];
      p.rim = rim0.map((c, i) => 0.7 * c + 0.3 * tint.rim[i]);
      why.push('Tэкв ' + Math.round(T) + ' K: ' + (T > 400 ? 'облака силикатов и сульфидов — охристо-шоколадные пояса.' : T > 150 ? 'аммиачные облака — кремово-охристые пояса, как у Юпитера.' : 'холодная водородная атмосфера с метаном — бледно-голубые тона.') + ' Ободок — ' + tint.glow + ' (свет ' + tint.name + ').');
      return T > 400 ? 'Тёплый газовый гигант' : 'Газовый гигант';
    }
    if (R >= 1.6) {
      p.type = 17; p.turb = 0.9;
      [p.col1, p.col2, p.col3] = T > 600 ? EXO_PAL.iceWarm : T > 200 ? EXO_PAL.iceTeal : EXO_PAL.iceCold;
      const rim0 = T > 600 ? [1.0, 0.78, 0.5] : [0.45, 0.75, 1.0];
      p.rim = rim0.map((c, i) => 0.6 * c + 0.4 * tint.rim[i]);
      p.exo = [1, 0, 0, R >= 4 ? 1.0 : 1.2];
      p.atmo = T > 600 ? [1.0, 0.8, 0.55, 0.035] : [0.45, 0.7, 1.0, 0.035]; p.atmoDens = R >= 4 ? 5 : 6;
      why.push('Радиус ' + R.toFixed(1) + ' R⊕ — больше предела ~1,6 R⊕: планета удерживает водородно-гелиевую оболочку, поверхности не видно. ' + (T > 600 ? 'Жарко (Tэкв ' + Math.round(T) + ' K) — янтарные облака.' : 'Метан поглощает красный свет — бирюзово-синие тона.'));
      if (R >= 4) return T > 600 ? 'Тёплый нептун' : 'Нептуноподобная планета (ледяной гигант)';
      return 'Мини-нептун: каменное ядро под плотной водородной оболочкой';
    }
    // ---- каменные планеты: гравитация (масса) задаёт рельеф и плотность атмосферы
    const light = M !== null && M < 1.2, superE = M !== null && M >= 2;
    p.par2z = light ? 1.0 : superE ? 0.15 : 0.5;
    p.bump = light ? 9 : superE ? 3 : 6;
    p.hazeFloor = light ? 0.02 : superE ? 0.32 : 0.08;
    const massWhy = () => {
      if (light) why.push('Малая масса (' + Mtxt + '): слабая гравитация не удерживает плотную атмосферу — резкий кратерированный и горный рельеф, лишь разреженная дымка.');
      else if (superE) why.push('Суперземля (' + Mtxt + '): сильная гравитация сглаживает рельеф и удерживает плотную многослойную атмосферу — диск подёрнут дымкой.');
      else if (Mtxt) why.push('Масса ' + Mtxt + ' — близко к земной: умеренный рельеф и атмосфера.');
    };
    const atmoK = light ? 0.3 : superE ? 1.7 : 1.0;
    if (T > 1000) {
      p.type = 15; p.exo = [3, MW.util.clamp((T - 800) / 1000, 0.4, 1.6), 0, 0.5]; p.rim = [1.0, 0.45, 0.2]; p.atmo = [1.0, 0.45, 0.2, 0.03]; p.atmoDens = 2.5;
      why.push('Tэкв ' + Math.round(T) + ' K — выше температуры плавления базальта: кора плавится, по поверхности текут реки лавы' + (locked ? ', под звездой — магматический океан (приливный захват).' : '.'));
      massWhy();
      return 'Лавовый мир (кора плавится, Tэкв > 1000 K)';
    }
    if (locked && T > 400) {
      // горячий мир в приливном захвате: раскалённая подсолнечная область, остывшая кора к терминатору
      p.type = 13; p.bump = Math.max(p.bump, 6);
      const glow = MW.util.clamp((Tss - 520) / 650, 0.15, 1.4);
      p.exo = [5, glow, 0, 0.35]; p.rim = [1.0, 0.72, 0.32]; p.atmo = [0.95, 0.8, 0.38, 0.025]; p.atmoDens = 1.6 * atmoK;
      p.col1 = [0.07, 0.06, 0.055]; p.col2 = [0.2, 0.17, 0.13]; p.hazeFloor = Math.max(p.hazeFloor, 0.1);
      why.push('Приливный захват (период ' + fmtP(P) + '): одна сторона всегда обращена к звезде, подсолнечная точка разогрета до ~' + Tss + ' K' +
        (Tss > 800 ? ' — выше точки Дрейпера (~800 K): в трещинах коры светится багровый расплав.' : ' — на пределе красного каления: в трещинах лишь тусклое багровое свечение.') +
        ' К терминатору — остывшая тёмная вулканическая кора и сернистая дымка; плотную атмосферу сдувает излучение и звёздный ветер.');
      massWhy();
      return 'Горячий каменный мир в приливном захвате';
    }
    if (locked && T > 150) {
      // «глазное яблоко»: лёд везде, кроме талого океана под звездой и шапки облаков над ним
      p.type = 12; p.exo = [6, 0, 0, 0.6];
      const oceanCos = MW.util.clamp(0.95 - (T - 150) / 200 * 1.1, -0.15, 0.92);
      p.par = [oceanCos, 0, 0.2, 0]; p.clouds = 0.2;
      p.col3 = tint.ocean.slice(); p.rim = tint.rim.slice(); p.atmo = [...tint.atmo, 0.03]; p.atmoDens = 6 * atmoK;
      p.interp = true;
      why.push('Приливный захват у ' + tint.name + ' (период ' + fmtP(P) + '): «планета — глазное яблоко». Ночная сторона и края дня скованы ледяным панцирем; открытый тёмно-синий океан — только вокруг подсолнечной точки (~' + Tss + ' K), над ним постоянная шапка конвективных облаков.');
      why.push('Свечение лимба и цвет океана — ' + tint.glow + ': так рассеивается свет ' + tint.name + '.');
      massWhy();
      return 'Холодный мир в приливном захвате («глазное яблоко»)';
    }
    if (T > 400) {
      p.type = 13; p.exo = [4, 0, 0, 0.3]; p.rim = [1.0, 0.75, 0.5];
      const hue = s * 0.12;
      p.col1 = [0.3 + hue, 0.15, 0.075]; p.col2 = [0.6 + hue * 0.5, 0.36, 0.19]; p.par = [-10, -0.5, 0, 0]; p.atmo = [0.95, 0.7, 0.45, 0.025]; p.atmoDens = 2 * atmoK;
      why.push('Tэкв ' + Math.round(T) + ' K, вращение не захвачено: выжженная пустыня без воды, ржаво-охристые оксиды.');
      massWhy();
      return 'Горячая каменная планета';
    }
    if (T > 180) {
      p.type = 12; p.exo = [4, 0, 0, 0.6]; p.rim = tint.rim.slice();
      p.col1 = [0.3, 0.26, 0.2]; p.col2 = [0.52, 0.44, 0.33]; p.col3 = tint.ocean.slice();
      const temp = (T - 255) / 110;
      p.par = [T > 320 ? -0.15 : 0.02, temp, 0.14, 0]; p.clouds = superE ? 0.24 : 0.14;
      p.atmo = [...tint.atmo, superE ? 0.05 : 0.03]; p.atmoDens = 8 * atmoK;
      p.interp = true;
      why.push('Tэкв ' + Math.round(T) + ' K — в диапазоне жидкой воды; ободок и океаны — ' + tint.glow + ' (свет ' + tint.name + ').');
      massWhy();
      return 'Каменная планета умеренной температуры';
    }
    p.type = 16; p.exo = [4, 0, 0, 0.2]; p.rim = tint.rim.map((c) => 0.5 * c + 0.4); p.atmoDens = 0;
    why.push('Tэкв ' + Math.round(T) + ' K — ниже точки замерзания: поверхность из водяного и азотного льда с трещинами.');
    massWhy();
    return 'Холодная (ледяная) каменная планета';
  }
  function buildNasaPlanets(sys, star, rnd, planeN) {
    const H = star.exoNasa;
    const mStar = H.mass || Math.max(0.08, Math.pow(Math.max(star.lum || 1, 1e-4), 1 / 3.5));
    const rStarAU = (H.rad || star.radiusSun || 1) * 0.00465;
    const teff = H.teff || star.temp || 5800;
    H.pl.forEach(([name, a, P, e, mE, rE, teq, insol, year, method], i) => {
      if (!a && P) a = Math.cbrt(mStar * Math.pow(P / 365.25, 2));
      if (!P && a) P = 365.25 * Math.sqrt(a * a * a / mStar);
      if (!a || !P) return;
      const p = { kind: 'planet', system: sys, seed: rnd(), exoReal: true, name, id: star.id + '_p' + i, aAU: a, periodD: P, ecc: e || 0,
        massE: mE, radiusE: rE || (mE ? radiusFromMass(mE) : 1), radiusEst: !rE, discYear: year, method, insol, hostTeff: teff,
        teq: teq ?? Math.round(teff * Math.sqrt(rStarAU / (2 * a)) * Math.pow(0.7, 0.25)), teqEst: teq === null || teq === undefined,
        src: 'NASA Exoplanet Archive (pscomppars)' };
      p.desc = classify(p);
      // измеренный цвет (Hubble STIS, отражённый свет, 2013): HD 189733 b — глубокий синий
      if (name === 'HD 189733 b') { p.col1 = [0.22, 0.42, 0.85]; p.col2 = [0.05, 0.12, 0.38]; p.col3 = [0.6, 0.75, 1.0]; p.rim = [0.5, 0.7, 1.0]; }
      p.temp = p.teq;
      p.radius = p.radiusE * RE; p.radiusKm = p.radiusE * 6371;
      p.period = P < 700 ? P.toFixed(2) + ' сут' : (P / 365.25).toFixed(1) + ' лет';
      const fr = randomFrame(rnd, planeN, 2);
      p.frame = MW.solar.bodyFrame(v3.norm(v3.rotAxis(fr.z, fr.x, rnd.range(0, 25) * DEG))); p.pole = p.frame.z;
      // p.rotH задан в classify(): при приливном захвате — орбитальный период, иначе оценка
      const ecc = Math.min(p.ecc, 0.95), ph0 = rnd() * Math.PI * 2, w0 = rnd() * Math.PI * 2;
      p.orbitFn = (jd) => {
        const M = (2 * Math.PI * (jd - 2451545.0)) / P + ph0;
        let E = M; for (let k = 0; k < 6; k++) E -= (E - ecc * Math.sin(E) - M) / (1 - ecc * Math.cos(E));
        const xr = a * (Math.cos(E) - ecc) * AU_LY, yr = a * Math.sqrt(1 - ecc * ecc) * Math.sin(E) * AU_LY;
        const cw = Math.cos(w0), sw = Math.sin(w0);
        return v3.add(v3.scale(fr.x, xr * cw - yr * sw), v3.scale(fr.y, xr * sw + yr * cw));
      };
      p.rnd = objRnd(p);
      p.info = p.desc + '. Тип выбран по измеренным ' + (rE ? 'радиусу' : 'массе (радиус оценён)') + (mE ? ', массе' : '') + ' и температуре; ' +
        (p.interp ? 'океаны, облака и полярные шапки — художественная интерпретация (вода и атмосфера не измерены); ' : 'рисунок облаков и рельефа — художественная визуализация; ') +
        'наклон орбиты и ориентация показаны условно.';
      sys.bodies.push(p); sys.byId[p.id] = p;
      // Кольца и спутники массивных газовых и ледяных гигантов — художественная реконструкция (у экзопланет
      // они пока не обнаружены). У горячих юпитеров не добавляются: вблизи звезды они неустойчивы.
      const massive = (p.type === 14 || (p.type === 17 && p.radiusE >= 4)) && p.teq < 1000;
      if (massive) {
        const r2 = MW.rng.mulberry32(MW.rng.hashStr(p.id) ^ 0x5bd1e995);
        const ri = r2.range(1.35, 1.7);
        p.ring = [ri, ri + r2.range(0.45, 1.1), r2.range(0.22, 0.5), 3];
        p.ringCol = p.teq < 160 ? [0.78, 0.82, 0.88] : [0.74, 0.65, 0.52];
        p.artisticExtras = true;
        // спутники — не дальше 0,3 радиуса Хилла (устойчивые орбиты)
        const mSun = (p.massE || 120) / 332946;
        const rHill = a * Math.cbrt(mSun / (3 * mStar)) * AU_LY;
        addMoons(sys, p, r2, r2.int(2, 5), rHill * 0.3);
        p.info += ' Кольца и спутники — художественная реконструкция: у экзопланет они пока не обнаружены.';
      }
    });
  }
  function addMoons(sys, p, rnd, nm, maxA) {
    const ROM = ['I', 'II', 'III', 'IV', 'V'];
    for (let j = 0; j < nm; j++) {
      const mr = rnd.range(0.15, 0.5);
      let am = p.radius * ((p.ring ? p.ring[1] + 1.5 : 4) + j * rnd.range(3, 7) + rnd.range(0, 2));
      if (maxA && am > maxA) am = maxA * (0.35 + 0.65 * (j + 1) / nm);
      const mfr = randomFrame(rnd, p.pole, 25);              // наклонные орбиты
      const mType = rnd.pick([0, 0, 16, 9, 10, 11, 13]);
      const aKm = am * MW.C.LY_KM;
      const mper = 2 * Math.PI * Math.sqrt(aKm * aKm * aKm / (398600.4 * (p.massE || 120))) / 86400;
      const ph = rnd() * Math.PI * 2;
      const m = {
        kind: 'moon', system: sys, parentBody: p, seed: rnd(), id: p.id + '_m' + (j + 1), name: p.name + ' ' + ROM[j], artistic: true,
        type: mType, radius: mr * RE, radiusKm: mr * 6371, col1: [0.4, 0.38, 0.36], col2: [0.65, 0.62, 0.58], col3: [0.3, 0.3, 0.3], par: [-10, -1, 0, 0], bump: 5,
        frame: mfr, pole: mfr.z, rotH: mper * 24, periodD: mper, aKm, desc: 'Спутник — художественная реконструкция',
        info: 'Гипотетический спутник планеты ' + p.name + ': у экзопланет спутники пока не обнаружены. Орбита выбрана в пределах устойчивой зоны (0,3 радиуса Хилла), наклон — условный.',
        src: 'Художественная реконструкция',
      };
      if (mType === 11) { m.atmo = [0.95, 0.6, 0.25, 0.1]; m.atmoDens = 6; }
      m.orbitFn = (jd) => { const an = (2 * Math.PI * (jd - 2451545.0)) / mper + ph; return v3.add(v3.scale(mfr.x, Math.cos(an) * am), v3.scale(mfr.y, Math.sin(an) * am)); };
      m.spinFn = (jd) => (2 * Math.PI * (jd - 2451545.0)) / mper + ph + Math.PI;
      sys.bodies.push(m); sys.byId[m.id] = m;
    }
  }

  MW.procsystem = { generateSystem, starVisual, starKind, objRnd, starTint };
})();
