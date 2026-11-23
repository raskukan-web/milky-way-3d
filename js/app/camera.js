'use strict';
/* =====================================================================
 *  Камера: свободный полёт 6DoF с инерцией, логарифмическая адаптация
 *  скорости по расстоянию до ближайшей поверхности, режим облёта,
 *  автопилот («гиперпрыжок») с интерполяцией в лог-пространстве.
 * ===================================================================== */
(function () {
  const MW = window.MW;
  const v3 = MW.v3, Q = MW.q;

  class Camera {
    constructor() {
      this.pos = [0, 0, 0];
      this.q = Q.ident();
      this.vel = [0, 0, 0];
      this.angVel = [0, 0, 0];
      this.throttle = 1;
      this.fov = 60 * MW.C.DEG;
      this.auto = null;
      this.anchor = null;
      this.speed = 0;
      this.dEff = 1;
      this.keys = new Set();
      this.mouseLook = [0, 0];
      this.orbitDelta = [0, 0];
      this.panDelta = [0, 0];
      this.pivot = null;
      this.viewH = 900;
    }
    get forward() { return Q.rot(this.q, [0, 0, -1]); }
    get right() { return Q.rot(this.q, [1, 0, 0]); }
    get up() { return Q.rot(this.q, [0, 1, 0]); }

    lookAt(target, upHint) { this.q = Q.lookRotation(v3.sub(target, this.pos), upHint || this.up); }

    cancelAuto() { if (this.auto) { this.auto = null; if (this.onAutoCancel) this.onAutoCancel(); } }

    /* target: { getPos(), arrive, litDir?, body? } */
    flyTo(target) {
      const tp = target.getPos();
      const d0 = Math.max(v3.dist(this.pos, tp), 1e-15);
      const d1 = target.arrive;
      let dir0 = v3.scale(v3.sub(this.pos, tp), 1 / d0);
      let dir1 = dir0;
      if (target.viewDir) dir1 = v3.norm(target.viewDir);
      else if (target.litDir) dir1 = v3.norm(v3.add(dir0, v3.scale(target.litDir, 1.3)));
      const ratio = Math.abs(Math.log(d0 / d1));
      this.auto = {
        target, t: 0, d0, d1, dir0, dir1, q0: this.q.slice(),
        dur: MW.util.clamp(1.6 + 0.33 * ratio + 0.4 * v3.dist(dir0, dir1), 1.5, 9),
      };
      this.anchor = null;
      this.vel = [0, 0, 0];
    }

    update(dt, env) {
      const k = this.keys;
      // --- автопилот ---
      if (this.auto) {
        const a = this.auto;
        a.t += dt;
        const s = Math.min(a.t / a.dur, 1);
        const e = s * s * s * (s * (s * 6 - 15) + 10);
        const tp = a.target.getPos();
        const d = Math.exp(Math.log(a.d0) + (Math.log(a.d1) - Math.log(a.d0)) * e);
        let dir = v3.norm(v3.lerp(a.dir0, a.dir1, e));
        if (v3.len(dir) < 0.5) dir = a.dir0;
        this.pos = v3.madd(tp, dir, d);
        // aimAt (необязательно): куда смотреть вместо центра цели — например, между аппаратом и Солнцем
        const qLook = Q.lookRotation(v3.sub(a.target.aimAt ? a.target.aimAt(this.pos) : tp, this.pos), this.up);
        this.q = Q.slerp(a.q0, qLook, Math.min(1, s * 2.6));
        this.speed = (a.prevD !== undefined) ? Math.abs(a.prevD - d) / Math.max(dt, 1e-4) : 0;
        a.prevD = d;
        if (s >= 1) {
          const tgt = a.target;
          this.auto = null;
          if (tgt.body) this.anchor = tgt.body;
          this.pivot = tgt;
          if (this.onArrive) this.onArrive(tgt);
        }
        this.dEff = env.nearestDist(this.pos);
        return;
      }
      // --- ручное управление ---
      const dEff = env.nearestDist(this.pos);
      this.dEff = dEff;
      const boost = k.has('ShiftLeft') || k.has('ShiftRight') ? 8 : 1;
      // вдали от всех объектов линейный рост скорости сжимается в логарифмический,
      // а итог ограничен потолком — навигация в межгалактическом пространстве остаётся управляемой
      // На космологических масштабах (дальше ~10 млн св. лет от Солнца) потолок растёт с расстоянием:
      // до сферы реликтового излучения (~46 млрд св. лет) можно долететь за минуту, а у галактик скорость снова падает.
      const sunD = v3.len(this.pos);
      const cosmic = sunD > 1e7;
      const SOFT = 20000, VMAX = cosmic ? Math.max(3e5, sunD * 0.35) : 3e5;
      let scale = dEff <= SOFT ? Math.max(dEff, 1e-14) : SOFT * (1 + Math.log(dEff / SOFT));
      if (cosmic) scale = Math.max(scale, Math.min(dEff, sunD) * 0.3);
      const base = Math.min(scale * 0.9 * this.throttle * boost, VMAX);
      const inp = [0, 0, 0];
      if (k.has('KeyW')) inp[2] -= 1;
      if (k.has('KeyS')) inp[2] += 1;
      if (k.has('KeyA')) inp[0] -= 1;
      if (k.has('KeyD')) inp[0] += 1;
      if (k.has('KeyR') || k.has('Space')) inp[1] += 1;
      if (k.has('KeyF') || k.has('KeyC')) inp[1] -= 1;
      const want = Q.rot(this.q, inp);
      const wl = v3.len(want);
      const target = wl > 0 ? v3.scale(want, base / wl) : [0, 0, 0];
      const blend = 1 - Math.exp(-dt / (wl > 0 ? 0.18 : 0.12));
      // ограничение скорости текущей «тягой» — инерция не проносит мимо объектов
      this.vel = v3.lerp(this.vel, target, blend);
      const vl = v3.len(this.vel);
      if (vl > base * 1.05 && vl > 0) this.vel = v3.scale(this.vel, (base * 1.05) / vl);
      this.speed = v3.len(this.vel);
      this.pos = v3.madd(this.pos, this.vel, dt);

      // вращение: мышь, стрелки, крен Q/E
      const rot = [0, 0, 0];
      const kr = 1.4 * (k.has('ShiftLeft') ? 1.6 : 1);
      if (k.has('ArrowLeft')) rot[1] += kr;
      if (k.has('ArrowRight')) rot[1] -= kr;
      if (k.has('ArrowUp')) rot[0] += kr;
      if (k.has('ArrowDown')) rot[0] -= kr;
      if (k.has('KeyQ')) rot[2] += kr;
      if (k.has('KeyE')) rot[2] -= kr;
      const rb = 1 - Math.exp(-dt / 0.12);
      for (let i = 0; i < 3; i++) this.angVel[i] += (rot[i] - this.angVel[i]) * rb;
      const sens = this.fov / 60 * 0.0028 * 60;
      const mx = this.mouseLook[0] * sens * 0.0166, my = this.mouseLook[1] * sens * 0.0166;
      this.mouseLook = [0, 0];
      let q = this.q;
      const yaw = this.angVel[1] * dt - mx, pitch = this.angVel[0] * dt - my, roll = this.angVel[2] * dt;
      if (yaw) q = Q.mul(q, Q.axisAngle([0, 1, 0], yaw));
      if (pitch) q = Q.mul(q, Q.axisAngle([1, 0, 0], pitch));
      if (roll) q = Q.mul(q, Q.axisAngle([0, 0, 1], roll));
      this.q = Q.norm(q);

      // облёт вокруг опорной точки (ПКМ): позиция и ориентация поворачиваются вместе,
      // поэтому взгляд не «прыгает» на объект — сохраняется текущий ракурс
      if ((this.orbitDelta[0] || this.orbitDelta[1]) && this.pivot) {
        const pp = this.pivot.getPos();
        const ay = -this.orbitDelta[0] * 0.005, ax = -this.orbitDelta[1] * 0.005;
        const qr = Q.norm(Q.mul(Q.axisAngle(this.right, ax), Q.axisAngle(this.up, ay)));
        this.pos = v3.add(pp, Q.rot(qr, v3.sub(this.pos, pp)));
        this.q = Q.norm(Q.mul(qr, this.q));
      }
      this.orbitDelta = [0, 0];
      // панорамирование (СКМ): сдвиг параллельно экрану, масштаб — расстояние до опорной точки
      if (this.panDelta[0] || this.panDelta[1]) {
        const dist = this.pivot ? v3.dist(this.pos, this.pivot.getPos()) : Math.max(this.dEff, 1e-12) * 2;
        const k = dist * this.fov / Math.max(this.viewH || 900, 100);
        this.pos = v3.add(this.pos, v3.add(v3.scale(this.right, -this.panDelta[0] * k), v3.scale(this.up, this.panDelta[1] * k)));
      }
      this.panDelta = [0, 0];
    }
  }

  MW.Camera = Camera;
})();
