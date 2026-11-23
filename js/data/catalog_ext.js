'use strict';
/* =====================================================================
 *  Расширенный каталог: ~25 000 реальных звёзд HYG (Hipparcos/Yale BSC/
 *  Gliese), все объекты Мессье и ярчайшие NGC/IC (OpenNGC), реальные
 *  экзопланетные системы. Данные загружаются скриптом tools/fetch_data.py.
 *  Если файлов нет — планетарий работает на встроенном каталоге.
 * ===================================================================== */
(function () {
  const MW = window.MW, v3 = MW.v3, cat = MW.catalog;
  const ra = (s) => { const p = s.trim().split(/\s+/).map(Number); return p[0] + (p[1] || 0) / 60 + (p[2] || 0) / 3600; };
  const de = (s) => { s = s.trim(); const sg = s[0] === '-' ? -1 : 1; const p = s.replace(/^[+-]/, '').split(/\s+/).map(Number); return sg * (p[0] + (p[1] || 0) / 60 + (p[2] || 0) / 3600); };

  const CON = {
    And: 'Андромеда', Ant: 'Насос', Aps: 'Райская Птица', Aqr: 'Водолей', Aql: 'Орёл', Ara: 'Жертвенник', Ari: 'Овен', Aur: 'Возничий', Boo: 'Волопас',
    Cae: 'Резец', Cam: 'Жираф', Cnc: 'Рак', CVn: 'Гончие Псы', CMa: 'Большой Пёс', CMi: 'Малый Пёс', Cap: 'Козерог', Car: 'Киль', Cas: 'Кассиопея',
    Cen: 'Центавр', Cep: 'Цефей', Cet: 'Кит', Cha: 'Хамелеон', Cir: 'Циркуль', Col: 'Голубь', Com: 'Волосы Вероники', CrA: 'Южная Корона',
    CrB: 'Северная Корона', Crv: 'Ворон', Crt: 'Чаша', Cru: 'Южный Крест', Cyg: 'Лебедь', Del: 'Дельфин', Dor: 'Золотая Рыба', Dra: 'Дракон',
    Equ: 'Малый Конь', Eri: 'Эридан', For: 'Печь', Gem: 'Близнецы', Gru: 'Журавль', Her: 'Геркулес', Hor: 'Часы', Hya: 'Гидра', Hyi: 'Южная Гидра',
    Ind: 'Индеец', Lac: 'Ящерица', Leo: 'Лев', LMi: 'Малый Лев', Lep: 'Заяц', Lib: 'Весы', Lup: 'Волк', Lyn: 'Рысь', Lyr: 'Лира', Men: 'Столовая Гора',
    Mic: 'Микроскоп', Mon: 'Единорог', Mus: 'Муха', Nor: 'Наугольник', Oct: 'Октант', Oph: 'Змееносец', Ori: 'Орион', Pav: 'Павлин', Peg: 'Пегас',
    Per: 'Персей', Phe: 'Феникс', Pic: 'Живописец', Psc: 'Рыбы', PsA: 'Южная Рыба', Pup: 'Корма', Pyx: 'Компас', Ret: 'Сетка', Sge: 'Стрела',
    Sgr: 'Стрелец', Sco: 'Скорпион', Scl: 'Скульптор', Sct: 'Щит', Ser: 'Змея', Sex: 'Секстант', Tau: 'Телец', Tel: 'Телескоп', Tri: 'Треугольник',
    TrA: 'Южный Треугольник', Tuc: 'Тукан', UMa: 'Большая Медведица', UMi: 'Малая Медведица', Vel: 'Паруса', Vir: 'Дева', Vol: 'Летучая Рыба', Vul: 'Лисичка',
  };
  const GREEK = { Alp: 'α', Bet: 'β', Gam: 'γ', Del: 'δ', Eps: 'ε', Zet: 'ζ', Eta: 'η', The: 'θ', Iot: 'ι', Kap: 'κ', Lam: 'λ', Mu: 'μ', Nu: 'ν', Xi: 'ξ',
    Omi: 'ο', Pi: 'π', Rho: 'ρ', Sig: 'σ', Tau: 'τ', Ups: 'υ', Phi: 'φ', Chi: 'χ', Psi: 'ψ', Ome: 'ω' };
  // «21Alp And» → «21 α And»
  function bayer(bf) {
    if (!bf) return '';
    const m = /^(\d+)?\s*([A-Z][a-z]{1,2})?\s?(\d)?\s*([A-Z][A-Za-z]{2})$/.exec(bf.replace(/\s+/g, ' ').trim());
    if (!m) return bf;
    const sup = { 1: '¹', 2: '²', 3: '³', 4: '⁴' };
    const parts = [];
    if (m[1]) parts.push(m[1]);
    if (m[2]) parts.push((GREEK[m[2]] || m[2]) + (m[3] ? sup[m[3]] || m[3] : ''));
    return parts.join(' ') + ' ' + m[4];
  }
  const bvToTemp = (bv) => 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  MW.conName = (c) => CON[c] || c || '';

  /* ---------- звёзды-хозяева экзопланет ---------- */
  // (при наличии данных NASA Exoplanet Archive встроенный мини-список экзопланет не используется)
  if (MW.exoHosts && !MW.nasaExo) for (const s of MW.exoHosts) {
    const raH = ra(s[3]), decD = de(s[4]);
    const absMag = s[7] - 5 * Math.log10(s[5] / MW.C.PC_LY) + 5;
    const st = { kind: 'star', id: s[0], name: s[1], desig: s[2], ra: raH, dec: decD, dist: s[5], spec: s[6], mag: s[7], temp: s[8], radiusSun: s[9],
      absMag, pos: MW.coords.radecToGal(raH, decD, s[5]), idx: cat.stars.length, color: MW.color.blackbody(s[8]), lum: Math.pow(10, (4.83 - absMag) / 2.5) };
    cat.stars.push(st); cat.starById[st.id] = st;
  }
  if (MW.exoSystems && !MW.nasaExo) for (const id in MW.exoSystems) if (cat.starById[id]) cat.starById[id].exo = MW.exoSystems[id];
  cat.exoStars = cat.stars.filter((s) => s.exo);
  for (const s of cat.stars) s.src = s.src || 'Встроенный каталог (Hipparcos / SIMBAD)';
  for (const c of cat.binaries) c.src = 'Встроенный каталог двойных звёзд (WDS / SIMBAD)';

  /* ---------- HYG: ~25 000 реальных звёзд ---------- */
  cat.hygStars = [];
  if (MW.hyg) {
    const F = {}; MW.hyg.fields.forEach((f, i) => (F[f] = i));
    const known = cat.stars.concat(cat.binaries).map((s) => ({ s, v: MW.coords.radecToEqVec(s.ra, s.dec), mag: s.mag }));
    const cosLim = Math.cos(0.2 * MW.C.DEG);
    for (const r of MW.hyg.rows) {
      const raH = r[F.ra], decD = r[F.dec];
      const ev = MW.coords.radecToEqVec(raH, decD);
      let dup = null;
      for (const k of known) if (Math.abs(k.mag - r[F.mag]) < 1.3 && v3.dot(ev, k.v) > cosLim) { dup = k.s; break; }
      const hd = r[F.hd], hip = r[F.hip], hr = r[F.hr];
      if (dup) { // дополняем встроенную звезду каталожными номерами
        Object.assign(dup, { hd: dup.hd || hd, hip: dup.hip || hip, hr: dup.hr || hr, con: dup.con || r[F.con], proper: dup.proper || r[F.proper] });
        continue;
      }
      const ci = r[F.ci];
      const temp = ci !== null && ci !== undefined ? MW.util.clamp(bvToTemp(ci), 2400, 40000) : MW.color.specToTemp(r[F.spect] || 'G2');
      const lum = r[F.lum] || Math.pow(10, (4.83 - r[F.absMag]) / 2.5);
      const bf = bayer(r[F.bf]);
      const name = r[F.proper] || bf || (hd ? 'HD ' + hd : hip ? 'HIP ' + hip : 'HR ' + hr);
      cat.hygStars.push({
        kind: 'star', hyg: true, id: 'hip' + (hip || hd || cat.hygStars.length), name, desig: bf && bf !== name ? bf : '', proper: r[F.proper], bfRaw: r[F.bf],
        hd, hip, hr, con: r[F.con], ra: raH, dec: decD, dist: r[F.distLy], mag: r[F.mag], absMag: r[F.absMag], spec: r[F.spect] || '?',
        temp: Math.round(temp), lum, radiusSun: MW.util.clamp(Math.sqrt(lum) * Math.pow(5778 / temp, 2), 0.08, 1500), variable: r[F.var],
        color: MW.color.blackbody(temp), pos: MW.coords.radecToGal(raH, decD, r[F.distLy]), hygIdx: cat.hygStars.length,
        base: F.base !== undefined ? r[F.base] : '', gl: F.gl !== undefined ? r[F.gl] : '', src: 'HYG v3.8 (Hipparcos / Yale BSC / Gliese)',
      });
    }
    // кратные системы HYG: звёзды с общим полем base (напр. «Gl 559») — реальные компаньоны
    const byBase = {};
    for (const s of cat.hygStars) if (s.base) (byBase[s.base] = byBase[s.base] || []).push(s);
    for (const k in byBase) {
      const g = byBase[k];
      if (g.length < 2) continue;
      for (const s of g) s.companions = g.filter((o) => o !== s && v3.dist(o.pos, s.pos) < 2);
    }
  }

  /* ---------- NASA Exoplanet Archive: подтверждённые экзопланеты → реальные звёзды ---------- */
  cat.exoPlanetCount = 0;
  if (MW.nasaExo) {
    const byHip = {}, byHd = {};
    for (const s of cat.stars.concat(cat.hygStars)) { if (s.hip) byHip[s.hip] = s; if (s.hd) byHd[s.hd] = s; }
    const NAME = { 'Proxima Cen': 'proxima', 'TRAPPIST-1': 'trappist', 'eps Eri': 'epseri', 'tau Cet': 'taucet', 'alf Cen A': 'rigilkent' };
    const RU = { 'Proxima Cen': 'Проксима Центавра', '51 Peg': '51 Пегаса', 'eps Eri': 'Эпсилон Эридана', 'tau Cet': 'Тау Кита', 'GJ 581': 'Глизе 581',
      '55 Cnc': '55 Рака', 'bet Pic': 'Бета Живописца', 'HD 209458': 'HD 209458' };
    const exo = [];
    for (const H of MW.nasaExo) {
      let st = (H.hip && byHip[H.hip]) || (H.hd && byHd[H.hd]) || (NAME[H.host] && cat.starById[NAME[H.host]]) || null;
      if (!st) {
        if (H.ra === null || H.dec === null || !H.distPc) continue;
        const raH = H.ra / 15, dist = H.distPc * MW.C.PC_LY;
        const teff = H.teff || 5000, rad = H.rad || 1;
        const lum = H.loglum !== null && H.loglum !== undefined ? Math.pow(10, H.loglum) : rad * rad * Math.pow(teff / 5772, 4);
        const absMag = 4.83 - 2.5 * Math.log10(Math.max(lum, 1e-6));
        st = { kind: 'star', nasaOnly: true, id: 'exo_' + H.host.replace(/\W+/g, '_'), name: RU[H.host] || H.host, desig: H.host, ra: raH, dec: H.dec, dist,
          spec: H.spec || ((teff >= 30000 ? 'O' : teff >= 10000 ? 'B' : teff >= 7500 ? 'A' : teff >= 6000 ? 'F' : teff >= 5200 ? 'G' : teff >= 3700 ? 'K' : 'M') + 'V'), mag: H.vmag ?? (absMag + 5 * Math.log10(dist / 32.6156)), temp: Math.round(teff), radiusSun: rad,
          lum, absMag, pos: MW.coords.radecToGal(raH, H.dec, dist), idx: cat.stars.length, color: MW.color.blackbody(teff), src: 'NASA Exoplanet Archive (параметры звезды)' };
        cat.stars.push(st); cat.starById[st.id] = st;
      }
      st.exoNasa = H;
      st.exoHost = H.host;
      st.exoNames = H.pl.map((p) => p[0]).join(' | ');
      // уточняем параметры звезды измерениями из архива
      if (H.rad && !st.isSun) st.radiusSun = H.rad;
      cat.exoPlanetCount += H.pl.length;
      exo.push(st);
    }
    cat.exoStars = exo.sort((a, b) => a.dist - b.dist);
  }

  /* ---------- Мессье + NGC/IC ---------- */
  const RU_M = { 2: 'M2', 6: 'Скопление Бабочка', 7: 'Скопление Птолемея', 11: 'Дикая Утка', 17: 'Туманность Омега', 24: 'Звёздное облако Стрельца',
    35: 'M35', 39: 'M39', 44: 'Ясли (Улей)', 49: 'M49', 51: 'Галактика Водоворот', 63: 'Галактика Подсолнух', 64: 'Галактика Чёрный Глаз',
    74: 'Галактика Фантом', 76: 'Малая Гантель', 77: 'Кит A', 78: 'Туманность M78', 81: 'Галактика Боде', 82: 'Галактика Сигара', 83: 'Южная Вертушка',
    87: 'Дева A', 94: 'Галактика Кошачий Глаз', 97: 'Туманность Сова', 101: 'Галактика Вертушка', 102: 'Галактика Веретено', 104: 'Галактика Сомбреро',
    106: 'M106', 51.1: '' };
  const TYPE = { OCl: 'Рассеянное скопление', '*Ass': 'Звёздная ассоциация', 'Cl+N': 'Скопление с туманностью', GCl: 'Шаровое скопление',
    PN: 'Планетарная туманность', SNR: 'Остаток сверхновой', HII: 'Область H II', EmN: 'Эмиссионная туманность', RfN: 'Отражательная туманность',
    Neb: 'Туманность', G: 'Галактика', GPair: 'Пара галактик', GTrpl: 'Триплет галактик', GGroup: 'Группа галактик', '**': 'Двойная звезда', '*': 'Звезда', Dup: 'Объект' };
  const HAVE_M = new Set([1, 3, 4, 5, 8, 13, 15, 16, 20, 22, 27, 31, 32, 33, 42, 45, 57, 92, 110]);
  const HAVE_N = new Set(['IC0434', 'NGC2024', 'NGC5139', 'NGC0104', 'NGC3372', 'NGC2237', 'NGC2238', 'NGC2239', 'NGC2244', 'NGC2246', 'NGC7000', 'NGC6960', 'NGC6992',
    'NGC6995', 'NGC7293', 'NGC6543', 'NGC2070', 'NGC6822', 'IC1613', 'Mel025', 'NGC1976', 'NGC1952']);
  /* Ориентация диска галактики по каталогу: PA (от севера через восток) задаёт большую ось на небе,
     отношение осей b/a — наклон (cos i ≈ b/a). Без PA/ba ориентация случайная (детерминированная). */
  function orientOnSky(o, pa, ba) {
    const d = v3.norm(MW.coords.radecToGal(o.ra, o.dec, 1));
    const dn = v3.norm(MW.coords.radecToGal(o.ra, Math.min(o.dec + 0.05, 89.99), 1));
    const N = v3.norm(v3.sub(dn, v3.scale(d, v3.dot(dn, d))));
    const E = v3.cross(N, d);
    const h = MW.rng.mulberry32(MW.rng.hashStr(o.id));
    const paR = (pa ?? h() * 180) * Math.PI / 180;
    const m = v3.norm(v3.add(v3.scale(N, Math.cos(paR)), v3.scale(E, Math.sin(paR))));
    const cosI = MW.util.clamp(ba ?? (0.2 + 0.8 * h()), 0.12, 1);
    const k = v3.cross(m, d), sinI = Math.sqrt(1 - cosI * cosI) * (h() < 0.5 ? 1 : -1);
    o.normal = v3.norm(v3.add(v3.scale(d, cosI), v3.scale(k, sinI)));
    o.major = m;
  }
  const pretty = (n) => n.replace(/^(NGC|IC)0*(\d+)/, '$1 $2').replace(/^Mel0*(\d+)/, 'Melotte $1').replace(/^M0*(\d+)/, 'M$1');
  const ext = (MW.dsoExt || []).slice();
  if (ext.length && !ext.some((o) => o.m === 102)) ext.push({ n: 'NGC5866', m: 102, type: 'G', vis: 'galaxy', ra: 15.10819, dec: 55.7633, dist: 5e7, r: 30000, mag: 9.9, con: 'Dra', common: 'Spindle Galaxy', hubble: 'S0', est: false });
  cat.messier = []; cat.ngc = [];
  for (const e of ext) {
    if ((e.m && HAVE_M.has(e.m)) || HAVE_N.has(e.n)) { // уже есть детальная версия — добавляем номер
      const twin = cat.dsos.find((d) => d.id === 'm' + e.m) || null;
      if (twin && e.m) { twin.messier = e.m; cat.messier.push(twin); }
      continue;
    }
    const ru = e.m && RU_M[e.m] && !/^M\d+$/.test(RU_M[e.m]) ? RU_M[e.m] : '';
    const ngcName = pretty(e.n);
    const name = e.m ? (ru ? `${ru} (M${e.m})` : `M${e.m}${e.n && !/^M/.test(e.n) ? ' · ' + ngcName : ''}`) : (e.common ? `${ngcName} (${e.common})` : ngcName);
    const typeRu = (TYPE[e.type] || 'Объект') + (e.hubble && e.vis === 'galaxy' ? ' ' + e.hubble : '');
    const o = {
      kind: 'dso', ext: true, lite: !!e.lite, id: e.m ? 'm' + e.m : e.n.toLowerCase(), name, type: typeRu, ra: e.ra, dec: e.dec, dist: e.dist, radius: Math.max(e.r, 0.3),
      vis: e.vis, messier: e.m || null, ngc: ngcName, con: e.con, mag: e.mag, est: e.est, hubble: e.hubble, z: e.z, ba: e.ba, pa: e.pa,
      pos: MW.coords.radecToGal(e.ra, e.dec, e.dist),
      info: `${typeRu}${e.con ? ' в созвездии ' + (CON[e.con] || e.con) : ''}.` + (e.common ? ` Также известен как «${e.common}».` : '') +
        (e.mag !== null && e.mag !== undefined ? ` Видимая величина ${e.mag.toFixed(1)}ᵐ.` : '') +
        (e.est ? ' Расстояние — оценка по типу и блеску объекта.' : e.vis === 'galaxy' && e.z ? ` Расстояние — по красному смещению z = ${e.z}.` : ''),
    };
    if (o.vis === 'galaxy') {
      o.gal = /^E/.test(e.hubble || '') ? 'ell' : /^S0/.test(e.hubble || '') ? 'ell' : /^S/.test(e.hubble || '') ? 'spiral' : /^I/.test(e.hubble || '') ? 'irr' : 'ell';
      o.localGroup = false;
      orientOnSky(o, e.pa, e.ba);
    }
    if (cat.dsoById[o.id]) o.id += '_x';
    cat.dsos.push(o); cat.dsoById[o.id] = o;
    (e.m ? cat.messier : cat.ngc).push(o);
  }
  cat.messier.sort((a, b) => (a.messier || 0) - (b.messier || 0));
  cat.ngc.sort((a, b) => (a.mag ?? 99) - (b.mag ?? 99));

  /* ---------- пульсары ATNF ---------- */
  // у пяти пульсаров уже есть детальные объёмные модели — к ним добавляем данные каталога
  const PSR_HAVE = { 'J0534+2200': 'crabpsr', 'J0835-4510': 'velapsr', 'J0633+1746': 'geminga', 'J1921+2153': 'psr1919', 'J0437-4715': 'psr0437' };
  cat.pulsars = [];
  const psrInfo = (p) => {
    const t = p.t === 'magnetar' ? 'Магнетар' : p.t === 'msp' ? 'Миллисекундный пульсар' : 'Радиопульсар';
    return t + (p.bin ? ' в двойной системе' : '') + `: период ${p.p < 1 ? (p.p * 1000).toPrecision(4) + ' мс' : p.p.toPrecision(4) + ' с'}` +
      ` (${(1 / p.p).toPrecision(3)} оборотов в секунду)` + (p.snr ? `, связан с остатком сверхновой ${p.snr}` : '') + (p.gc ? `, в шаровом скоплении ${p.gc}` : '') +
      '.' + (p.est ? ' Расстояние — грубая оценка по мере дисперсии.' : '');
  };
  for (const p of MW.pulsarsATNF || []) {
    const have = PSR_HAVE[p.j] && cat.dsoById[PSR_HAVE[p.j]];
    if (have) { Object.assign(have, { period: p.p, psrj: p.j, psrb: p.b, src: 'ATNF Pulsar Catalogue · встроенная модель' }); cat.pulsars.push(have); continue; }
    const o = {
      kind: 'dso', ext: true, lite: true, id: 'psr_' + p.j, name: 'PSR ' + (p.b ? p.b + ' (' + p.j + ')' : p.j), desig: p.j, vis: 'pulsar',
      type: p.t === 'magnetar' ? 'Магнетар' : p.t === 'msp' ? 'Миллисекундный пульсар' : 'Пульсар', psrClass: p.t || 'normal',
      ra: p.ra, dec: p.dec, dist: p.d, est: !!p.est, period: p.p, psrj: p.j, psrb: p.b, binary: !!p.bin, assoc: p.snr || p.gc || '',
      radius: 0.004, pos: MW.coords.radecToGal(p.ra, p.dec, p.d), info: psrInfo(p), src: 'ATNF Pulsar Catalogue (Manchester et al. 2005)',
    };
    cat.dsos.push(o); cat.dsoById[o.id] = o; cat.pulsars.push(o);
  }

  /* ---------- ориентиры: Кассиопея A, SN 1987A, квазары, скопления галактик ---------- */
  cat.landmarks = [];
  for (const l of MW.landmarks || []) {
    const o = Object.assign({ kind: 'dso', ext: true, lite: true, radius: l.r, pos: MW.coords.radecToGal(l.ra, l.dec, l.dist), src: 'SIMBAD / NED; расстояние по z (ΛCDM)' }, l);
    if (l.vis === 'galcluster' || l.vis === 'quasar') o.normal = v3.norm(MW.coords.radecToGal(l.ra, l.dec + 30, 1));
    cat.dsos.push(o); cat.dsoById[o.id] = o; cat.landmarks.push(o);
  }
})();
