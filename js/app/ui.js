'use strict';
/* =====================================================================
 *  Интерфейс: список объектов, переключатели, карточка объекта, HUD,
 *  подписи (2D-холст), выбор объектов кликом, управление клавиатурой.
 * ===================================================================== */
(function () {
  const MW = window.MW;
  const v3 = MW.v3, U = MW.util;
  const $ = (s) => document.querySelector(s);

  class UI {
    constructor(app) {
      this.app = app;
      this.cam = app.cam; this.scene = app.scene; this.r = app.renderer;
      this.selected = null;
      this.labels = true;
      this.lc = $('#labels');
      this.ctx = this.lc.getContext('2d');
      this.buildLists();
      this.bindControls();
      this.bindInput();
      this.cam.onArrive = (t) => this.toast('Прибытие: ' + t.name);
    }

    /* ---------------- список объектов ---------------- */
    buildLists() {
      const sc = this.scene, cat = MW.catalog;
      const hygBright = cat.hygStars.filter((s) => s.proper || s.mag < 3.5).sort((a, b) => a.mag - b.mag);
      const byMag = (a, b) => (a.mag ?? 99) - (b.mag ?? 99);
      const dsoOf = (...v) => cat.dsos.filter((d) => v.includes(d.vis));
      // класс объекта для фильтров-чипов (у DSO — по типу, у звёзд — звезда/двойная/экзо)
      this.tagOf = (o) => {
        if (o.kind === 'probe') return 'probe';
        if (o.kind === 'dso') return { nebula: 'nebula', planetary: 'nebula', snr: 'snr', cluster: 'cluster', globular: 'cluster', galaxy: 'galaxy', galcluster: 'galaxy', quasar: 'quasar', pulsar: 'pulsar', xray: 'pulsar' }[o.vis] || 'base';
        if (o.kind === 'star') return o.companion ? 'double' : o.exo || o.exoNasa ? 'exo' : 'stars';
        return 'base';
      };
      // tag — для фильтров-чипов; большие группы показывают первые 500 строк (остальное — через поиск)
      const groups = [
        { tag: 'base', title: 'Солнечная система', open: true, items: [sc.solar.star, ...sc.solar.bodies.filter((b) => b.kind === 'planet'), ...sc.solar.bodies.filter((b) => b.kind === 'moon')] },
        { tag: 'probe', title: 'Космические аппараты', items: sc.probes },
        { tag: 'base', title: 'Галактика и Вселенная', items: [sc.galaxyView, sc.bh, cat.dsoById.m31, cat.dsoById.lmc, cat.dsoById.smc, sc.webView, sc.universeView] },
        { tag: 'messier', title: 'Каталог Мессье', items: cat.messier },
        { tag: 'nebula', title: 'Туманности (эмиссионные, отражательные, планетарные)', items: dsoOf('nebula', 'planetary').sort(byMag) },
        { tag: 'snr', title: 'Остатки сверхновых', items: dsoOf('snr') },
        { tag: 'cluster', title: 'Звёздные скопления', items: dsoOf('cluster', 'globular').sort(byMag) },
        { tag: 'galaxy', title: 'Галактики (OpenNGC)', items: dsoOf('galaxy').sort(byMag) },
        { tag: 'galaxy', title: 'Скопления и сверхскопления галактик', items: dsoOf('galcluster') },
        { tag: 'quasar', title: 'Квазары и радиогалактики', items: dsoOf('quasar') },
        { tag: 'pulsar', title: 'Пульсары, магнетары, чёрные дыры (ATNF)', items: dsoOf('pulsar', 'xray').sort((a, b) => (a.dist || 0) - (b.dist || 0)) },
        { tag: 'double', title: 'Двойные звёзды', items: cat.binaries },
        { tag: 'exo', title: 'Экзопланетные системы', items: cat.exoStars },
        { tag: 'stars', title: 'Яркие звёзды', items: cat.stars.filter((s) => !s.exo && !s.nasaOnly && !s.exoNasa).sort((a, b) => a.mag - b.mag) },
        { tag: 'stars', title: 'Именные звёзды HYG', items: hygBright },
      ];
      const CAP = 500;
      const box = $('#lists');
      box.innerHTML = '';
      this.listItems = [];
      this.groupEls = [];
      // результаты поиска по всей базе (~110 000 звёзд и ~16 000 объектов глубокого космоса)
      const resDet = document.createElement('details');
      resDet.className = 'results'; resDet.open = true; resDet.style.display = 'none';
      const resSum = document.createElement('summary'); resDet.appendChild(resSum);
      const resUl = document.createElement('ul'); resDet.appendChild(resUl);
      box.appendChild(resDet);
      for (const g of groups) {
        const det = document.createElement('details');
        det.open = !!g.open;
        det.dataset.tag = g.tag;
        const sum = document.createElement('summary');
        sum.textContent = g.title + ' (' + g.items.length.toLocaleString('ru-RU') + ')';
        det.appendChild(sum);
        const ul = document.createElement('ul');
        // большие группы наполняются лениво при раскрытии
        const fill = () => {
          if (ul.childElementCount) return;
          for (const o of g.items.slice(0, CAP)) ul.appendChild(this.listItem(o));
          if (g.items.length > CAP) {
            const li = document.createElement('li'); li.className = 'more';
            li.textContent = '… ещё ' + (g.items.length - CAP).toLocaleString('ru-RU') + ' — найдите через поиск';
            ul.appendChild(li);
          }
        };
        if (det.open) fill();
        det.addEventListener('toggle', () => det.open && fill());
        det.appendChild(ul);
        box.appendChild(det);
        this.groupEls.push(det);
      }
      // поисковый индекс
      this.index = [];
      const add = (o, extra) => this.index.push({ o, cls: this.tagOf(o), t: [o.name, o.desig, o.proper, extra, o.bfRaw && o.bfRaw.replace(/(\D)(\d)([A-Z])/, '$1$2 $3'), o.hd && 'hd ' + o.hd, o.hip && 'hip ' + o.hip, o.hr && 'hr ' + o.hr,
        o.ngc, o.messier && 'm' + o.messier, o.messier && 'm ' + o.messier, o.psrj && 'psr ' + o.psrj.toLowerCase(), o.psrb && 'psr ' + o.psrb.toLowerCase(),
        o.con && MW.conName(o.con)].filter(Boolean).join(' | ').toLowerCase() });
      for (const g of groups.slice(0, 3)) for (const o of g.items) add(o, o.kind === 'probe' ? (o.id === 'voyager1' ? 'voyager 1 voyager-1' : 'voyager 2 voyager-2') : o.kind === 'view' ? 'вселенная паутина universe cosmic web cmb реликтовое' : undefined);
      for (const o of cat.stars) add(o, o.exoNames);
      for (const o of cat.binaries) add(o);
      for (const o of cat.hygStars) add(o, o.exoNames);
      for (const o of cat.dsos) add(o);
      this.filter = 'all';
      const pass = (it) => this.filter === 'all' || it.cls === this.filter || (this.filter === 'messier' && it.o.messier);
      const run = () => {
        const q = $('#search').value.trim().toLowerCase();
        for (const det of this.groupEls) det.style.display = this.filter === 'all' || det.dataset.tag === this.filter ? '' : 'none';
        if (q.length < 2) { resDet.style.display = 'none'; return; }
        const out = [];
        // точное совпадение («NGC 253», а не «NGC 2539») — выше, затем совпадение с начала, затем остальное
        const qe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const exact = new RegExp('(^|[\\s|(·,])' + qe + '(?![0-9a-zа-яё])');
        for (const it of this.index) {
          if (!pass(it)) continue;
          const p = it.t.indexOf(q);
          if (p < 0) continue;
          out.push([exact.test(it.t) ? 0 : p === 0 ? 1 : 2, (it.o.mag ?? 20), it.o]);
          if (out.length > 4000) break;
        }
        out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        resUl.innerHTML = '';
        for (const [, , o] of out.slice(0, 60)) resUl.appendChild(this.listItem(o));
        resSum.textContent = 'Найдено: ' + out.length + (out.length > 60 ? ' (показаны 60)' : '');
        resDet.style.display = '';
      };
      $('#search').oninput = run;
      for (const ch of document.querySelectorAll('#filters button')) {
        ch.onclick = () => {
          this.filter = ch.dataset.f;
          document.querySelectorAll('#filters button').forEach((b) => b.classList.toggle('on', b === ch));
          for (const det of this.groupEls) if (det.dataset.tag === this.filter) det.open = true;
          run();
        };
      }
    }
    listItem(o) {
      const li = document.createElement('li');
      const dot = document.createElement('i');
      dot.style.background = this.objColor(o);
      li.appendChild(dot);
      const sp = document.createElement('span');
      sp.textContent = o.name;
      li.appendChild(sp);
      const sub = document.createElement('em');
      sub.textContent = o.kind === 'star' ? (o.isSun ? 'G2V' : o.companion === true ? o.spec : (o.mag ?? 0).toFixed(1) + 'ᵐ') : o.kind === 'moon' ? 'спутник' : o.kind === 'probe' ? 'NASA' : (o.messier && o.ngc ? o.ngc : '');
      li.appendChild(sub);
      li.title = [o.desig, o.type, o.con && MW.conName(o.con)].filter(Boolean).join(' · ');
      li.onclick = () => this.select(o);
      li.ondblclick = () => { this.select(o); this.flyTo(o); };
      return li;
    }
    objColor(o) {
      if (o.kind === 'star') return MW.color.hex(o.color);
      if (o.kind === 'dso') return { nebula: '#ff6a88', snr: '#ffa060', planetary: '#60e0c0', globular: '#ffe0a0', cluster: '#9ec5ff', galaxy: '#d8c8ff', pulsar: o.psrClass === 'magnetar' ? '#d58cff' : '#8fd4ff', quasar: '#9fc0ff', galcluster: '#ffd9a0', xray: '#b6c8ff' }[o.vis] || '#ccc';
      if (o.kind === 'bh') return '#ff9a3c';
      if (o.kind === 'view') return '#b0c8ff';
      if (o.kind === 'probe') return MW.color.hex(o.color);
      const c = { mercury: '#a8a29a', venus: '#f3dfa8', earth: '#5d8ff0', mars: '#e07050', jupiter: '#e8cfa8', saturn: '#ead9a2', uranus: '#a8e2ea', neptune: '#6f8ff5' }[o.id];
      return c || '#c8c8c8';
    }

    /* ---------------- кнопки и переключатели ---------------- */
    bindControls() {
      const s = this.r.s;
      const tog = (id, get, set) => { const el = $(id); el.checked = get(); el.onchange = () => set(el.checked); };
      tog('#tLabels', () => this.labels, (v) => (this.labels = v));
      tog('#tConst', () => s.constellations, (v) => (s.constellations = v));
      tog('#tGrid', () => s.grid, (v) => (s.grid = v));
      tog('#tOrbits', () => s.orbits, (v) => (s.orbits = v));
      const sl = (id, key, fmt) => {
        const el = $(id), out = $(id + 'V');
        el.value = s[key];
        const upd = () => { s[key] = parseFloat(el.value); if (out) out.textContent = fmt(s[key]); };
        el.oninput = upd; upd();
      };
      sl('#sScale', 'renderScale', (v) => Math.round(v * 100) + '%');
      sl('#sBloom', 'bloom', (v) => v.toFixed(2));
      sl('#sExp', 'exposure', (v) => v.toFixed(2));
      sl('#sGal', 'galaxyBright', (v) => v.toFixed(2));
      sl('#sMag', 'magLimit', (v) => v.toFixed(1) + 'ᵐ');
      const st = $('#sStyle');
      st.value = s.artistic ? 'art' : 'real';
      st.onchange = () => { s.artistic = st.value === 'art'; this.toast('Стиль: ' + (s.artistic ? 'художественный HDR' : 'реалистичный')); };
      $('#btnSun').onclick = () => this.returnToSun();
      $('#btnGalaxy').onclick = () => { this.select(this.scene.galaxyView); this.flyTo(this.scene.galaxyView); };
      $('#cardFly').onclick = () => this.selected && this.flyTo(this.selected.obj);
      $('#cardClose').onclick = () => this.select(null);
      $('#tPause').onclick = () => this.togglePause();
      $('#tSlow').onclick = () => this.timeStep(-1);
      $('#tFast').onclick = () => this.timeStep(1);
      $('#tNow').onclick = () => { this.scene.jd = Date.now() / 86400000 + 2440587.5; this.scene.timeScale = 1; this.scene.paused = false; };
      $('#panelToggle').onclick = () => document.body.classList.toggle('panel-hidden');
    }
    timeStep(dir) {
      const steps = [-31557600, -2592000, -86400, -3600, -60, 1, 60, 3600, 86400, 2592000, 31557600];
      const sc = this.scene;
      let i = steps.findIndex((x) => x === sc.timeScale);
      if (i < 0) i = 5;
      i = U.clamp(i + dir, 0, steps.length - 1);
      sc.timeScale = steps[i];
      sc.paused = false;
      this.toast('Скорость времени: ' + this.fmtRate(sc.timeScale));
    }
    togglePause() { this.scene.paused = !this.scene.paused; this.toast(this.scene.paused ? 'Время остановлено' : 'Время идёт'); }
    fmtRate(x) {
      const a = Math.abs(x), s = x < 0 ? '−' : '';
      if (a >= 31557600) return s + '1 год/с';
      if (a >= 2592000) return s + '30 сут/с';
      if (a >= 86400) return s + '1 сут/с';
      if (a >= 3600) return s + '1 ч/с';
      if (a >= 60) return s + '1 мин/с';
      return s + 'реальное';
    }
    returnToSun() {
      const t = this.scene.makeTarget({ kind: 'solarView' });
      this.cam.flyTo(t);
      this.select(this.scene.solar.star, true);
      this.toast('Возвращение к Солнцу');
    }

    /* ---------------- выбор и перелёт ---------------- */
    select(o, silent) {
      this.selected = o ? { obj: o } : null;
      const card = $('#card');
      if (!o) { card.classList.add('hidden'); return; }
      card.classList.remove('hidden');
      $('#cardTitle').textContent = o.name;
      $('#cardTitle').style.color = this.objColor(o);
      $('#cardSub').textContent = this.subtitle(o);
      $('#cardInfo').textContent = o.info || this.autoInfo(o);
      this.cardRows = this.rows(o);
      this.renderRows();
      this.renderFacts(o);
      this.renderWhy(o);
      this.renderChips(o);
    }
    // блок «Почему так выглядит»: облик экзопланеты выведен из её реальных параметров
    renderWhy(o) {
      const box = $('#cardWhy');
      box.innerHTML = '';
      if (!o.why || !o.why.length) { box.style.display = 'none'; return; }
      box.style.display = '';
      const h = document.createElement('div'); h.className = 'factsTitle'; h.textContent = '🔬 Почему так выглядит';
      box.appendChild(h);
      const ul = document.createElement('ul');
      for (const t of o.why) { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); }
      box.appendChild(ul);
    }
    // кнопки-«чипы» планет системы выбранной звезды (система генерируется сразу по клику) или спутников планеты
    renderChips(o) {
      const box = $('#cardPlanets');
      box.innerHTML = '';
      let title = '', items = [];
      if (o.kind === 'star') {
        let sys = null;
        if (o.isSun) sys = this.scene.solar;
        else { this.scene.activateStar(o, true); sys = this.scene.active; }
        if (sys) { items = sys.bodies.filter((b) => b.kind === 'planet'); title = items.length ? 'Подтверждённые планеты (' + items.length + ')' : ''; }
        if (!items.length && !o.isSun && MW.STRICT) title = 'Подтверждённых планет нет (NASA Exoplanet Archive)';
        if (o.companion === true) items = [o.primary, ...items];
        else if (o.companion) items = [o.companion, ...items];
        if (o.companions && o.companions.length) items = [...o.companions, ...items];
        if (!items.length && title) { const h = document.createElement('div'); h.className = 'chipsTitle'; h.textContent = title; box.appendChild(h); return; }
      } else if (o.kind === 'planet') {
        items = o.system.bodies.filter((b) => b.parentBody === o);
        title = items.length ? (o.artisticExtras ? 'Спутники — художественная реконструкция (' : 'Спутники (') + items.length + ')' : '';
      }
      if (!items.length) return;
      const h = document.createElement('div'); h.className = 'chipsTitle'; h.textContent = title || 'Объекты';
      box.appendChild(h);
      for (const b of items) {
        const c = document.createElement('button');
        c.className = 'chip';
        const dot = document.createElement('i'); dot.style.background = b.kind === 'star' ? MW.color.hex(b.color) : this.planetHex(b);
        c.append(dot, document.createTextNode(' ' + b.name.replace((o.name || '') + ' ', '') + (b.ring ? ' ◍' : '')));
        c.title = b.desc || b.spec || '';
        c.onclick = () => { this.select(b); this.flyTo(b); };
        box.appendChild(c);
      }
    }
    // блок «Особенности» из встроенного словаря фактов
    renderFacts(o) {
      const box = $('#cardFacts');
      box.innerHTML = '';
      const f = MW.factsFor ? MW.factsFor(o) : null;
      if (!f) { box.style.display = 'none'; return; }
      box.style.display = '';
      const h = document.createElement('div'); h.className = 'factsTitle'; h.textContent = '✦ Особенности';
      box.appendChild(h);
      const ul = document.createElement('ul');
      for (const t of f) { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); }
      box.appendChild(ul);
    }
    planetHex(b) {
      const fixed = this.objColor(b);
      if (fixed !== '#c8c8c8') return fixed;
      const t = { 1: [0.95, 0.85, 0.6], 3: [0.85, 0.45, 0.3], 9: [0.9, 0.8, 0.4], 11: [0.9, 0.6, 0.3], 12: [0.4, 0.6, 0.9], 15: [1, 0.4, 0.15], 16: [0.85, 0.9, 1] }[b.type];
      return MW.color.hex(t || b.col1 || [0.7, 0.7, 0.7]);
    }
    subtitle(o) {
      if (o.kind === 'star') return (o.desig ? o.desig + ' · ' : '') + 'звезда ' + (o.spec || '');
      if (o.kind === 'planet') return o.desc || 'Планета';
      if (o.kind === 'moon') return 'Спутник' + (o.parentBody ? ' · ' + o.parentBody.name : '');
      if (o.kind === 'dso') return o.type;
      if (o.kind === 'bh') return o.type;
      if (o.kind === 'probe') return 'Межзвёздный зонд NASA · «Вояджер»';
      return '';
    }
    autoInfo(o) {
      if (o.kind === 'star') {
        const cls = (o.spec || 'G')[0];
        const d = { O: 'Очень горячая голубая звезда', B: 'Горячая бело-голубая звезда', A: 'Белая звезда', F: 'Жёлто-белая звезда', G: 'Жёлтая звезда, похожая на Солнце', K: 'Оранжевая звезда', M: 'Красная звезда', D: 'Белый карлик' }[cls] || 'Звезда';
        return d + (o.procedural ? ' (процедурно сгенерирована по модели плотности Галактики). Её планетная система создана детерминированно по сиду звезды — выберите планету ниже или нажмите «Лететь».' : '.');
      }
      return '';
    }
    rows(o) {
      const R = [];
      const sunD = () => U.fmtDist(v3.len(o.pos || [0, 0, 0]));
      if (o.kind === 'star') {
        R.push(['Спектр. класс', o.spec || '—'], ['Температура', Math.round(o.temp) + ' K'], ['Радиус', U.fmtNum(o.radiusSun, o.radiusSun < 10 ? 2 : 0) + ' R☉'],
          ['Светимость', U.fmtNum(o.lum, o.lum < 10 ? 2 : 0) + ' L☉'], ['Абс. величина', o.absMag.toFixed(2) + 'ᵐ']);
        if (!o.isSun) R.push(['Видимая (с Земли)', (o.absMag + 5 * Math.log10(v3.len(o.pos) / 32.6156)).toFixed(2) + 'ᵐ'], ['От Солнца', sunD()]);
        if (o.ra !== undefined) R.push(['RA / Dec', o.ra.toFixed(2) + 'ʰ / ' + o.dec.toFixed(1) + '°']);
        if (o.con) R.push(['Созвездие', MW.conName(o.con)]);
        const ids = [o.desig && o.desig !== o.name ? o.desig : '', o.hd && 'HD ' + o.hd, o.hip && 'HIP ' + o.hip, o.hr && 'HR ' + o.hr].filter(Boolean);
        if (ids.length) R.push(['Каталоги', ids.join(', ')]);
        if (o.variable) R.push(['Переменность', o.variable]);
        R.push(['Тип (визуализация)', (o._vis || (o._vis = MW.procsystem.starVisual(o))).kindName]);
        if (o.exo) R.push(['Экзопланеты', o.exo.length + ' (реальные)']);
        if (o.exoNasa) R.push(['Экзопланеты', o.exoNasa.pl.length + ' подтв. (' + o.exoHost + ')']);
        if (o.companions && o.companions.length) R.push(['Кратная система', (o.companions.length + 1) + ' звезды (' + o.base + ')']);
        if (o.companion === true) R.push(['Пара с', o.primary.name], ['Орбита', U.fmtNum(o.aAU, o.aAU < 1 ? 3 : 1) + ' а.е.'], ['Период', o.periodY < 0.1 ? (o.periodY * 365.25).toFixed(2) + ' сут' : U.fmtNum(o.periodY, 1) + ' лет']);
        else if (o.companion) R.push(['Компаньон', o.companion.name]);
      } else if (o.kind === 'planet' || o.kind === 'moon') {
        R.push(['Радиус', Math.round(o.radiusKm || o.radius * MW.C.LY_KM).toLocaleString('ru-RU') + ' км']);
        if (o.mass) R.push(['Масса', o.mass]);
        if (o.aAU) R.push(['Большая полуось', o.aAU.toFixed(o.aAU < 1 ? 3 : 2) + ' а.е.']);
        if (o.aKm) R.push(['Орбита', Math.round(o.aKm).toLocaleString('ru-RU') + ' км']);
        if (o.period) R.push(['Период', o.period]);
        else if (o.periodD) R.push(['Период', Math.abs(o.periodD).toFixed(2) + ' сут']);
        if (o.rotH) R.push([o.rotEst ? 'Сутки (оценка)' : o.locked ? 'Сутки (захват)' : 'Сутки', Math.abs(o.rotH).toFixed(1) + ' ч' + (o.rotH < 0 ? ' (обратное)' : '')]);
        if (o.exoReal && o.radiusE) R.push(['Радиус (R⊕)', o.radiusE.toFixed(2) + (o.radiusEst ? ' (оценка по массе)' : '')]);
        if (o.exoReal && o.massE) R.push(['Масса (M⊕)', U.fmtNum(o.massE, o.massE < 10 ? 2 : 1)]);
        if (o.exoReal && o.ecc) R.push(['Эксцентриситет', o.ecc.toFixed(3)]);
        if (o.temp) R.push(['Т равновесная', o.temp + ' K' + (o.teqEst ? ' (оценка)' : '')]);
        if (o.insol) R.push(['Инсоляция', (o.insol < 0.1 ? o.insol.toPrecision(2).replace('.', ',') : U.fmtNum(o.insol, 2)) + ' от земной']);
        if (o.discYear) R.push(['Открыта', o.discYear + (o.method ? ' · ' + o.method : '')]);
        if (o.ring) R.push(['Кольца', o.artisticExtras ? 'художественная реконструкция' : 'есть']);
        if (o.artistic) R.push(['Статус', 'гипотетический — художественная реконструкция']);
      } else if (o.kind === 'dso') {
        R.push(['Расстояние', (o.est ? '≈ ' : '') + U.fmtDist(o.dist) + (o.est ? ' (оценка)' : '')], ['Размер', '≈ ' + U.fmtDist(o.radius * 2)], ['RA / Dec', o.ra.toFixed(2) + 'ʰ / ' + o.dec.toFixed(1) + '°']);
        if (o.messier || o.ngc) R.push(['Каталоги', [o.messier && 'M' + o.messier, o.ngc && !/^M/.test(o.ngc) ? o.ngc : ''].filter(Boolean).join(', ')]);
        if (o.con) R.push(['Созвездие', MW.conName(o.con)]);
        if (o.mag !== undefined && o.mag !== null) R.push(['Видимая величина', o.mag.toFixed(1) + 'ᵐ']);
        if (o.z) R.push(['Красное смещение z', String(o.z)]);
        if (o.period) {
          R.push(['Период вращения', o.period < 1 ? (o.period * 1000).toPrecision(5) + ' мс' : o.period.toPrecision(5) + ' с'], ['Частота', (1 / o.period).toPrecision(4) + ' об/с']);
          if (1 / o.period > 2.5) R.push(['Анимация', 'пучки замедлены до 2,5 об/с (реальная частота — выше)']);
        }
        if (o.psrj) R.push(['Обозначение', [o.psrj, o.psrb].filter(Boolean).join(' / ')]);
        if (o.assoc) R.push(['Связан с', o.assoc]);
        if (o.binary) R.push(['Двойная система', 'да']);
      } else if (o.kind === 'probe') {
        // телеметрия по модели траектории (обновляется каждый кадр)
        const d = o.def, AUly = MW.C.AU_LY;
        const earth = () => this.scene.solar.bodies.find((b) => b.id === 'earth').pos;
        R.push(['Скорость', d.kms.toFixed(2).replace('.', ',') + ' км/с (' + d.auYr.toFixed(2).replace('.', ',') + ' а.е./год)']);
        R.push(['От Солнца', () => (v3.len(o.pos) / AUly).toFixed(2).replace('.', ',') + ' а.е.']);
        R.push(['От Земли', () => (v3.dist(o.pos, earth()) / AUly).toFixed(2).replace('.', ',') + ' а.е.']);
        R.push(['Сигнал до Земли', () => { const h = v3.dist(o.pos, earth()) / AUly * 499.005 / 3600; return Math.floor(h) + ' ч ' + Math.round((h % 1) * 60) + ' мин (' + (h / 24).toFixed(3).replace('.', ',') + ' св. сут)'; }]);
        R.push(['Направление', d.con + ' (RA ' + d.ra.toFixed(2) + 'ʰ, Dec ' + (d.dec > 0 ? '+' : '') + d.dec.toFixed(1) + '°)']);
        R.push(['Запуск', d.launchTxt], ['Пролёты', d.flybyTxt], ['Статус', d.status], ['Масса при запуске', '825 кг']);
      } else if (o.kind === 'bh') {
        R.push(['Масса', '4.3 млн M☉'], ['Радиус Шварцшильда', '12.7 млн км'], ['От Солнца', '26 000 св. лет'], ['Созвездие', 'Стрелец']);
      }
      R.push(['От камеры', () => U.fmtDist(Math.max(0, v3.dist(this.cam.pos, o.pos || [0, 0, 0]) - (o.radius || 0)))]);
      R.push(['Источник', this.source(o)]);
      return R;
    }
    // источник данных для карточки
    source(o) {
      if (o.src) return o.src;
      if (o.kind === 'planet' || o.kind === 'moon') {
        if (!(o.system && o.system.isSolar)) return 'NASA Exoplanet Archive';
        // реальная карта поверхности — с указанием авторства снимков
        const td = o.tex && MW.texData && MW.texData[o.tex];
        return 'JPL (кеплеровы элементы), IAU' + (td ? ' · Карта: ' + td.credit : '');
      }
      if (o.isSun) return 'IAU / NASA';
      if (o.kind === 'dso') return o.ext ? (o.messier ? 'Каталог Мессье · OpenNGC' : 'NGC/IC · OpenNGC') : 'Встроенный каталог (SIMBAD / NED)' + (o.messier ? ' · Мессье' : '');
      if (o.kind === 'bh') return 'GRAVITY / EHT (2022)';
      return 'Модель Галактики (визуализация)';
    }
    renderRows() {
      const tb = $('#cardRows');
      tb.innerHTML = '';
      this.liveCells = [];
      for (const [k, v] of this.cardRows) {
        const tr = document.createElement('tr');
        const a = document.createElement('td'); a.textContent = k;
        const b = document.createElement('td'); b.textContent = typeof v === 'function' ? v() : v;
        if (typeof v === 'function') this.liveCells.push([b, v]);
        tr.append(a, b); tb.appendChild(tr);
      }
    }
    flyTo(o) {
      const t = this.scene.makeTarget(o);
      this.cam.flyTo(t);
      this.toast('Автопилот → ' + o.name + '  (любая клавиша движения — перехват)');
    }

    /* ---------------- ввод ---------------- */
    bindInput() {
      const cv = $('#gl');
      let down = null;
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
      cv.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }); // без автопрокрутки браузера
      cv.addEventListener('pointerdown', (e) => {
        if (e.button === 1) e.preventDefault();
        try { cv.setPointerCapture(e.pointerId); } catch (err) { /* синтетические события */ }
        down = { x: e.clientX, y: e.clientY, b: e.button, moved: 0, lx: e.clientX, ly: e.clientY, started: false };
      });
      const tip = $('#tip');
      cv.addEventListener('pointerleave', () => (tip.style.display = 'none'));
      cv.addEventListener('pointermove', (e) => {
        if (!down) {
          // подсказка при наведении (с ограничением частоты)
          const now = performance.now();
          if (now - (this._hoverT || 0) < 90) return;
          this._hoverT = now;
          const o = this.pick(e.clientX, e.clientY);
          if (!o) { tip.style.display = 'none'; return; }
          const d = v3.dist([0, 0, 0], o.pos || [0, 0, 0]);
          const extra = o.kind === 'star' ? [o.spec, o.mag !== undefined && (o.mag).toFixed(1) + 'ᵐ', o.isSun ? '' : U.fmtDist(o.dist || d)]
            : o.kind === 'dso' ? [o.type, U.fmtDist(o.dist)] : [o.desc || (o.kind === 'moon' ? 'спутник' : '')];
          tip.innerHTML = '';
          tip.append(document.createTextNode(o.name));
          const sm = document.createElement('small'); sm.textContent = extra.filter(Boolean).join(' · '); tip.appendChild(sm);
          tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 12) + 'px'; tip.style.display = 'block';
          return;
        }
        tip.style.display = 'none';
        const dx = e.clientX - down.lx, dy = e.clientY - down.ly;
        down.lx = e.clientX; down.ly = e.clientY;
        down.moved += Math.abs(dx) + Math.abs(dy);
        if (down.moved < 3) return;
        const cam = this.cam;
        cam.viewH = cv.clientHeight;
        if (down.b === 0) { cam.cancelAuto(); cam.mouseLook[0] += dx; cam.mouseLook[1] += dy; return; }
        if (down.b !== 1 && down.b !== 2) return;
        cam.cancelAuto();
        // опорная точка выбирается один раз в начале перетаскивания
        if (!down.started) { down.started = true; cam.pivot = this.orbitPivot(); cam.vel = [0, 0, 0]; }
        if (down.b === 2) { cam.orbitDelta[0] += dx; cam.orbitDelta[1] += dy; }
        else { cam.panDelta[0] += dx; cam.panDelta[1] += dy; }
      });
      cv.addEventListener('pointerup', (e) => {
        if (down && down.moved < 4 && down.b === 0) {
          const o = this.pick(e.clientX, e.clientY);
          const now = performance.now();
          if (o) {
            this.select(o);
            if (this.lastClick && this.lastClick.o === o && now - this.lastClick.t < 400) this.flyTo(o);
          }
          this.lastClick = { o, t: now };
        }
        down = null;
      });
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const f = Math.pow(1.25, -Math.sign(e.deltaY));
        this.cam.throttle = U.clamp(this.cam.throttle * f, 1e-3, 1e3);
      }, { passive: false });

      const moveKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF', 'Space', 'KeyC', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
      window.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' && e.target.type === 'text')) return;
        const c = e.code;
        if (moveKeys.has(c)) { e.preventDefault(); this.cam.keys.add(c); if (this.cam.auto) this.cam.cancelAuto(); return; }
        if (c === 'ShiftLeft' || c === 'ShiftRight') { this.cam.keys.add(c); return; }
        const sc = this.scene, sol = sc.solar;
        const planets = sol.bodies.filter((b) => b.kind === 'planet');
        if (/^Digit[1-8]$/.test(c)) { const p = planets[+c.slice(5) - 1]; this.select(p); this.flyTo(p); return; }
        switch (c) {
          case 'Digit9': this.select(sc.galaxyView); this.flyTo(sc.galaxyView); break;
          case 'Digit0': this.select(sc.bh); this.flyTo(sc.bh); break;
          case 'Enter': case 'KeyG': if (this.selected) this.flyTo(this.selected.obj); break;
          case 'KeyH': case 'Home': this.returnToSun(); break;
          case 'KeyL': this.labels = !this.labels; $('#tLabels').checked = this.labels; break;
          case 'KeyK': this.r.s.constellations = !this.r.s.constellations; $('#tConst').checked = this.r.s.constellations; break;
          case 'KeyO': this.r.s.orbits = !this.r.s.orbits; $('#tOrbits').checked = this.r.s.orbits; break;
          case 'KeyB': this.r.s.grid = !this.r.s.grid; $('#tGrid').checked = this.r.s.grid; break;
          case 'KeyP': this.togglePause(); break;
          case 'BracketRight': case 'Period': this.timeStep(1); break;
          case 'BracketLeft': case 'Comma': this.timeStep(-1); break;
          case 'Equal': case 'NumpadAdd': this.cam.throttle = U.clamp(this.cam.throttle * 2, 1e-3, 1e3); break;
          case 'Minus': case 'NumpadSubtract': this.cam.throttle = U.clamp(this.cam.throttle / 2, 1e-3, 1e4); break;
          case 'KeyU': document.body.classList.toggle('panel-hidden'); break;
          case 'KeyX': this.cam.vel = [0, 0, 0]; this.cam.angVel = [0, 0, 0]; this.cam.cancelAuto(); break;
          case 'Escape': if (this.cam.auto) this.cam.cancelAuto(); else this.select(null); break;
          default: return;
        }
        e.preventDefault();
      });
      window.addEventListener('keyup', (e) => this.cam.keys.delete(e.code));
      window.addEventListener('blur', () => this.cam.keys.clear());
    }
    // Опорная точка облёта/панорамы: выбранный объект или тело-якорь, только если он
    // виден ближе к центру экрана; иначе — точка прямо перед камерой (никаких «прыжков» к Солнцу)
    orbitPivot() {
      const cam = this.cam, cv = this.lc;
      const w = cv.clientWidth, h = cv.clientHeight;
      const cands = [];
      if (this.selected) cands.push(this.selected.obj);
      if (cam.anchor) cands.push(cam.anchor);
      for (const o of cands) {
        const p = this.r.project(o.pos || [0, 0, 0]);
        if (p && p.onScreen && Math.hypot(p.x - w / 2, p.y - h / 2) < Math.min(w, h) * 0.3) return { getPos: () => o.pos || [0, 0, 0], name: o.name };
      }
      const p = v3.madd(cam.pos, cam.forward, Math.max(cam.dEff, 1e-12) * 1.2);
      return { getPos: () => p, name: '' };
    }

    // выбор объекта по клику
    pick(x, y) {
      const sc = this.scene, r = this.r;
      let best = null, bd = 16;
      const test = (o, pos, bonus) => {
        const p = r.project(pos);
        if (!p || !p.onScreen) return;
        const rad = o.radius ? r.pxRadius(o.radius * (o.ring ? o.ring[1] : 1), p.d) : 0;
        const d = Math.max(0, Math.hypot(p.x - x, p.y - y) - rad) - (bonus || 0);
        if (d < bd) { bd = d; best = o; }
      };
      for (const s of sc.systems) { test(s.star, s.star.pos, 3); for (const b of s.bodies) test(b, b.pos, b.kind === 'planet' ? 4 : 2); }
      const mag = (o) => o.absMag + 5 * Math.log10(Math.max(v3.dist(this.cam.pos, o.pos), 1e-12) / 32.6156);
      for (const s of sc.catalog.stars) if (mag(s) < r.s.magLimit + 1) test(s, s.pos, 1);
      for (const c of sc.catalog.binaries) if (mag(c) < r.s.magLimit + 1 || r.pxRadius(c.radius, v3.dist(this.cam.pos, c.pos)) > 1) test(c, c.pos, 1.5);
      // ~25 000 реальных звёзд HYG (видимые с текущей точки)
      const lim = r.s.magLimit + 0.5;
      for (const s of sc.catalog.hygStars) if (mag(s) < lim) test(s, s.pos, 0.5);
      // объекты глубокого космоса: из видимых — ближайший к курсору (тысячи невидимых тусклых галактик не перехватывают клик)
      let bestD = null, bdd = Infinity;
      for (const o of sc.catalog.dsos) {
        const pr = r.project(o.pos);
        if (!pr || !pr.onScreen) continue;
        if (o.lite && r.dsoVisible && !r.dsoVisible(o, pr.d)) continue;
        const rad = Math.min(r.pxRadius(o.radius, pr.d), 60), dd = Math.hypot(pr.x - x, pr.y - y);
        if (dd < Math.max(rad, 10) && dd - rad * 0.5 < bdd) { bdd = dd - rad * 0.5; bestD = o; }
      }
      if (bestD && (!best || bd > 6)) { best = bestD; bd = 6; }
      test(sc.bh, sc.bh.pos, 2);
      for (const pr of sc.probes) if (v3.len(this.cam.pos) < 30000 * MW.C.AU_LY) test(pr, pr.pos, 3);
      if (!best || bd > 4) {
        for (let li = 0; li < sc.local.levels.length; li++) {
          const L = sc.local.levels[li];
          if (!L.pos) continue;
          for (let i = 0; i < L.count; i++) {
            const pos = [L.pos[i * 3], L.pos[i * 3 + 1], L.pos[i * 3 + 2]];
            const dd = v3.dist(this.cam.pos, pos);
            const m = L.props[i * 9 + 6] + 5 * Math.log10(Math.max(dd, 1e-12) / 32.6156);
            if (m > r.s.magLimit) continue;
            const p = r.project(pos);
            if (!p || !p.onScreen) continue;
            const d = Math.hypot(p.x - x, p.y - y) + m * 0.3;
            if (d < bd) { bd = d; best = sc.local.star(li, i); }
          }
        }
      }
      return best;
    }

    toast(msg) {
      const t = $('#toast');
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(this._tt);
      this._tt = setTimeout(() => t.classList.remove('show'), 2600);
    }

    /* ---------------- кадр: HUD и подписи ---------------- */
    frame() {
      const cam = this.cam, sc = this.scene;
      const sunD = v3.len(cam.pos);
      const gcD = v3.dist(cam.pos, MW.C.GC_POS);
      let where = 'Межзвёздное пространство';
      if (sunD < 0.02) where = 'Солнечная система';
      else if (sc.active && v3.dist(cam.pos, sc.active.star.pos) < 0.05) where = 'Система ' + sc.active.star.name;
      else if (v3.dist(cam.pos, sc.bh.pos) < 1) where = 'Окрестности Стрельца A*';
      else if (gcD > 70000 || Math.abs(cam.pos[2] - MW.C.GC_POS[2]) > 15000) where = gcD > 400000 ? 'Межгалактическое пространство' : 'Над диском Галактики';
      if (cam.auto) where = '⟫ Автопилот → ' + cam.auto.target.name;
      $('#hWhere').textContent = where;
      $('#hSpeed').textContent = U.fmtSpeed(cam.speed);
      $('#hThrottle').textContent = '×' + (cam.throttle >= 10 ? Math.round(cam.throttle) : cam.throttle.toPrecision(2));
      $('#hSun').textContent = U.fmtDist(sunD);
      const lb = MW.coords.galToLB(cam.pos);
      $('#hGal').textContent = sunD > 0.01 ? 'l ' + lb.l.toFixed(1) + '°, b ' + lb.b.toFixed(1) + '°' : '—';
      const date = new Date((sc.jd - 2440587.5) * 86400000);
      $('#hDate').textContent = isFinite(date.getTime()) && date.getUTCFullYear() > -9999 && date.getUTCFullYear() < 9999 ? date.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'JD ' + sc.jd.toFixed(1);
      $('#hRate').textContent = sc.paused ? 'пауза' : this.fmtRate(sc.timeScale);
      $('#hFps').textContent = Math.round(this.app.fps) + ' fps';
      if (this.liveCells) for (const [cell, fn] of this.liveCells) cell.textContent = fn();
      this.drawLabels();
    }

    drawLabels() {
      const cv = this.lc, ctx = this.ctx;
      const w = cv.clientWidth, h = cv.clientHeight, dpr = MW.dpr();
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const r = this.r, cam = this.cam, sc = this.scene;
      const occ = [];
      const free = (x, y, wd) => { for (const o of occ) if (Math.abs(o[0] - x) < (o[2] + wd) / 2 + 4 && Math.abs(o[1] - y) < 13) return false; occ.push([x, y, wd]); return true; };
      const selName = this.selected ? this.selected.obj.name : null;
      // диски близких тел закрывают подписи объектов позади них
      const occl = [];
      for (const sys of sc.systems) for (const b of [sys.star, ...sys.bodies]) {
        const rel = v3.sub(b.pos, cam.pos), d = v3.len(rel);
        if (r.pxRadius(b.radius, d) > 3) occl.push({ rel, r2: b.radius * b.radius, d });
      }
      // перекрыт ли луч камера→точка сферой близкого тела (проверка в 3D, работает и у поверхности)
      const hidden = (pos) => {
        const dv = v3.sub(pos, cam.pos), L = v3.len(dv);
        for (const o of occl) {
          if (o.d >= L * 0.999) continue;
          const t = v3.dot(o.rel, dv) / L;
          if (t > 0 && o.d * o.d - t * t < o.r2) return true;
        }
        return false;
      };
      const label = (text, pos, color, opts = {}) => {
        if (!opts.force && text === selName) return null;
        const p = r.project(pos);
        if (!p || !p.onScreen) return null;
        if (occl.length && hidden(pos)) return null;
        ctx.font = (opts.bold ? '600 ' : '') + (opts.size || 12) + 'px "Segoe UI", system-ui, sans-serif';
        const tw = ctx.measureText(text).width;
        const ox = opts.center ? -tw / 2 : 8, oy = opts.center ? 4 : -6;
        if (!opts.force && !free(p.x + ox + tw / 2, p.y + oy, tw)) return p;
        ctx.globalAlpha = opts.alpha === undefined ? 1 : opts.alpha;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillText(text, p.x + ox + 1, p.y + oy + 1);
        ctx.fillStyle = color;
        ctx.fillText(text, p.x + ox, p.y + oy);
        if (opts.mark) { ctx.strokeStyle = color; ctx.globalAlpha *= 0.6; ctx.beginPath(); ctx.arc(p.x, p.y, opts.mark, 0, Math.PI * 2); ctx.stroke(); }
        ctx.globalAlpha = 1;
        return p;
      };
      // выделенный объект
      if (this.selected) {
        const o = this.selected.obj;
        const pos = o.pos || [0, 0, 0];
        const p = r.project(pos);
        if (p && p.onScreen) {
          const rad = Math.max(10, Math.min(r.pxRadius((o.radius || 0) * (o.ring ? o.ring[1] : o.kind === 'probe' ? 0.3 : 1.1), p.d) + 6, Math.min(w, h) * 0.45));
          ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.85;
          ctx.beginPath();
          for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; ctx.moveTo(p.x + Math.cos(a - 0.3) * rad, p.y + Math.sin(a - 0.3) * rad); ctx.arc(p.x, p.y, rad, a - 0.3, a + 0.3); }
          ctx.stroke(); ctx.globalAlpha = 1; ctx.lineWidth = 1;
          label(o.name, pos, '#ffd27a', { force: true, bold: true, size: 13 });
        }
      }
      if (!this.labels) return;
      const sunD = v3.len(cam.pos);
      // Фильтр подписей по масштабу: объекты внутри диска Галактики (звёзды, туманности, скопления, пульсары,
      // остатки сверхновых) подписываются, только пока камера ближе ~20 000 св. лет к ним; от 12 000 подписи
      // плавно гаснут. Издали остаются рукава, Солнце, центр Галактики, галактики и внегалактические ориентиры.
      const GAL_IN = new Set(['nebula', 'snr', 'planetary', 'cluster', 'globular', 'pulsar', 'xray']);
      const galFade = (d) => 1 - U.smoothstep(12000, 20000, d);
      // тела систем
      for (const sys of sc.systems) {
        const dSys = v3.dist(cam.pos, sys.star.pos);
        if (dSys < 3000 * MW.C.AU_LY) {
          label(sys.star.name, sys.star.pos, '#ffe9a8', { bold: true });
          for (const b of sys.bodies) {
            if (b.kind === 'moon') { const dp = v3.dist(cam.pos, b.parentBody.pos); if (dp > b.parentBody.radius * 400) continue; }
            label(b.name, b.pos, b.kind === 'moon' ? '#a9b4c8' : '#cfe0ff', { size: b.kind === 'moon' ? 11 : 12 });
          }
        } else if (!sys.isSolar && galFade(dSys) > 0.02) label(sys.star.name, sys.star.pos, '#ffe9a8', { alpha: galFade(dSys) });
      }
      if (sunD >= 3000 * MW.C.AU_LY) label('☉ Солнце', [0, 0, 0], '#ffe27a', { bold: true });
      if (sunD < 20000 * MW.C.AU_LY) for (const pr of sc.probes) label(pr.name, pr.pos, MW.color.hex(pr.color), { size: 12, bold: true });
      // звёзды каталога
      const lim = sunD < 200 ? 2.3 : 3.3;
      for (const s of sc.catalog.stars) {
        const dd = v3.dist(cam.pos, s.pos);
        const m = s.absMag + 5 * Math.log10(Math.max(dd, 1e-9) / 32.6156);
        if (m > lim && dd > 30) continue;
        const gf = galFade(dd); if (gf <= 0.02) continue;
        label(s.name, s.pos, '#d9e4ff', { size: 11, alpha: U.clamp(1.2 - (m - lim + 2) * 0.25, 0.45, 1) * gf });
      }
      if (!this._namedHyg) this._namedHyg = sc.catalog.hygStars.filter((s) => s.proper);
      for (const s of this._namedHyg) {
        const dd = v3.dist(cam.pos, s.pos);
        const m = s.absMag + 5 * Math.log10(Math.max(dd, 1e-9) / 32.6156);
        if (m > lim - 0.3 && dd > 20) continue;
        const gf = galFade(dd); if (gf <= 0.02) continue;
        label(s.name, s.pos, '#c3cfee', { size: 10.5, alpha: U.clamp(1.1 - (m - lim + 2) * 0.25, 0.4, 0.9) * gf });
      }
      // созвездия
      if (r.s.constellations && sunD < 1500) {
        for (const c of MW.catalog.constellations) {
          if (c.asterism) continue;
          label(c.name.toUpperCase(), v3.madd(cam.pos, c.dir, 1e6), 'rgba(120,170,255,0.75)', { size: 10, center: true });
        }
      }
      // DSO
      for (const c of sc.catalog.binaries) {
        const dd = v3.dist(cam.pos, c.pos);
        const m = c.absMag + 5 * Math.log10(Math.max(dd, 1e-9) / 32.6156);
        if (galFade(dd) > 0.02 && (dd < 3 || (m < lim && v3.dist(c.pos, c.primary.pos) / dd > 0.004))) label(c.name, c.pos, '#d9e4ff', { size: 11, alpha: galFade(dd) });
      }
      for (const o of sc.catalog.dsos) {
        const dO = v3.dist(cam.pos, o.pos);
        // ориентиры (квазары, скопления галактик, известные остатки сверхновых) подписываются всегда, когда видны
        const landmark = o.vis === 'quasar' || o.vis === 'galcluster' || o.vis === 'xray' || (o.vis === 'snr' && o.lite && !o.ngc);
        if (o.vis === 'pulsar' && (o.lite ? dO > Math.max(40, o.radius * 4000) : dO > 3000)) continue;
        if (!landmark && (o.vis === 'globular' || o.vis === 'planetary' || o.vis === 'snr') && dO > 40000 && o !== (this.selected && this.selected.obj)) continue;
        // лёгкие объекты каталогов — только видимые с текущей точки
        if (o.lite && r.dsoVisible && !r.dsoVisible(o, dO)) continue;
        // NGC/IC подписываются, только если яркие или камера рядом; Мессье — всегда
        if (!landmark && o.ext && !o.messier && o.vis !== 'pulsar' && !((o.mag ?? 99) < 6.5 || dO < o.radius * 60)) continue;
        if (o.ext && o.messier && o.vis === 'galaxy' && dO > 1e8) continue;
        if (landmark && dO > Math.max(o.dist * 40, 6e10)) continue;
        // объекты внутри диска (в т.ч. ориентиры вроде Кассиопеи A, Лебедя X-1) — только вблизи
        const gf = GAL_IN.has(o.vis) ? galFade(dO) : 1;
        if (gf <= 0.02) continue;
        label(o.name, o.pos, { nebula: '#ff9ab0', snr: '#ffb27a', planetary: '#7af0d0', globular: '#ffe4a8', cluster: '#a8c8ff', galaxy: '#d8c8ff', pulsar: '#8fd4ff', quasar: '#9fc0ff', galcluster: '#ffd9a0', xray: '#b6c8ff' }[o.vis] || '#ddd', { size: 11, bold: landmark, alpha: gf });
      }
      label('Стрелец A*', sc.bh.pos, '#ffb060', { bold: v3.dist(cam.pos, sc.bh.pos) < 2000 });
      if (sunD > 6000) for (const a of MW.galaxy.armLabels()) label(a.name, a.pos, 'rgba(170,200,255,0.8)', { size: 12, center: true });
    }
  }

  MW.UI = UI;
})();
