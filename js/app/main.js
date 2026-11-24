'use strict';
/* =====================================================================
 *  Точка входа: инициализация WebGL2, мира, камеры, UI и главный цикл.
 * ===================================================================== */
(function () {
  const MW = window.MW;

  function showError(e) {
    console.error(e);
    const el = document.getElementById('error');
    el.textContent = 'Ошибка: ' + (e && e.message ? e.message : e);
    el.style.display = 'block';
    document.getElementById('loading').style.display = 'none';
  }
  window.addEventListener('error', (ev) => showError(ev.error || ev.message));

  function start() {
    const status = document.getElementById('loadStatus');
    const step = (msg, fn) => new Promise((res, rej) => { status.textContent = msg; setTimeout(() => { try { res(fn()); } catch (e) { rej(e); } }, 30); });
    const app = { fps: 60 };
    window.app = app;
    // отладочные помощники (консоль): снимок кадра на dev-сервер и телепорт к объекту
    window.snap = (name) => new Promise((res) => requestAnimationFrame(() => {
      const g = app.glc.canvas, lc = document.getElementById('labels'), c = document.createElement('canvas');
      c.width = g.width; c.height = g.height;
      const x = c.getContext('2d'); x.drawImage(g, 0, 0); x.drawImage(lc, 0, 0, c.width, c.height);
      c.toBlob((b) => fetch('/' + name, { method: 'POST', body: b }).then(() => res(c.width + 'x' + c.height), () => res('fail')), 'image/jpeg', 0.88);
    }));
    window.tp = (o, mul, dir) => {
      if (app.scene) app.scene.lastCam = app.cam.pos;
      const t = app.scene.makeTarget(o), p = t.getPos();
      const d = dir || t.viewDir || (t.litDir ? MW.v3.norm(MW.v3.add(MW.v3.norm(MW.v3.sub(app.cam.pos, p)), MW.v3.scale(t.litDir, 1.3))) : MW.v3.norm(MW.v3.sub(app.cam.pos, p)));
      app.cam.cancelAuto(); app.cam.pos = MW.v3.madd(p, d, t.arrive * (mul || 1)); app.cam.lookAt(t.aimAt ? t.aimAt(app.cam.pos) : p, app.cam.up); app.cam.anchor = t.body || null;
    };
    step('Инициализация WebGL2…', () => { app.glc = new MW.GLContext(document.getElementById('gl')); })
      .then(() => step('Сборка Солнечной системы и каталога звёзд…', () => { app.scene = new MW.Scene(app.glc); }))
      .then(() => step('Компиляция шейдеров и генерация ~500 000 частиц Галактики…', () => { app.renderer = new MW.Renderer(app.glc, app.scene); }))
      .then(() => app.glc.waitPrograms((d, n) => { status.textContent = 'Компиляция шейдеров на GPU: ' + d + ' / ' + n + ' (после обновления — один раз, затем из кэша)'; }))
      .then(() => step('Подготовка камеры…', () => {
        app.cam = new MW.Camera();
        const t = app.scene.makeTarget({ kind: 'solarView' });
        app.cam.pos = MW.v3.scale(t.viewDir, t.arrive);
        app.cam.lookAt([0, 0, 0], MW.coords.ECL_POLE);
        app.ui = new MW.UI(app);
        document.getElementById('gpuName').textContent = app.glc.renderer;
        document.getElementById('partCount').textContent = app.renderer.particleCount.toLocaleString('ru-RU');
      }))
      .then(() => {
        document.getElementById('loading').classList.add('done');
        setTimeout(() => (document.getElementById('loading').style.display = 'none'), 900);
        app.ui.toast('Добро пожаловать! Двойной клик по объекту — автопилот. H — домой к Солнцу.');
        let last = performance.now();
        const loop = (now) => {
          try {
            const dt = Math.min(0.1, Math.max(0.0005, (now - last) / 1000));
            last = now;
            app.fps = app.fps * 0.95 + (1 / dt) * 0.05;
            app.scene.update(dt, app.cam);
            app.scene.applyAnchor(app.cam);
            app.cam.update(dt, app.scene);
            app.scene.collide(app.cam);
            app.renderer.render(app.cam, app.ui.selected);
            app.ui.frame(dt);
          } catch (e) {
            // ошибка кадра: показываем, восстанавливаем камеру и продолжаем работу
            if (!app._errShown) { showError(e); app._errShown = true; setTimeout(() => { document.getElementById('error').style.display = 'none'; app._errShown = false; }, 6000); }
            if (!app.cam.pos.every(Number.isFinite)) { app.cam.pos = [0, 0, 0.0003]; app.cam.vel = [0, 0, 0]; app.cam.auto = null; }
          }
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      })
      .catch(showError);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
