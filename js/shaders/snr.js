'use strict';
/* =====================================================================
 *  Объёмная модель остатка сверхновой (общая для объёмных туманностей и инстансного рендера DSO).
 *  Честный 3D-шум в декартовых координатах с многослойным искажением (domain warping) и ridged fBm —
 *  волокна переплетаются как скомканное кружево, без сферических координат (нет «спиц» и полюсов).
 *  Форма оболочки деформирована крупным 3D-шумом: край рваный и асимметричный.
 *  Типы: 0 — молодой (Кеплер, Тихо, Кассиопея A): плотные бугристые выбросы (ejecta) от пурпурного и
 *        рубинового до бело-золотого в местах столкновения ударных волн + тонкая сине-циановая кромка
 *        рентгеновской внешней ударной волны;
 *        1 — старый (Петля Лебедя, IC 443): оболочка разорвана на отдельные дуги и тонкие ленты H-α и O III;
 *        2 — плерион (Краб): голубоватое синхротронное ядро от пульсара в сети розово-оранжевых волокон.
 * ===================================================================== */
(function () {
  const G = window.MW.GLSL;
  G.snr = `
void snrSample(vec3 p, float s, int typ, out vec3 e, out float a){
  e = vec3(0.0); a = 0.0;
  vec3 S = vec3(s * 37.1, s * 17.3, s * 29.7);
  // крупномасштабная деформация формы: рваный асимметричный край
  vec3 w1 = vec3(fbm(p * 1.25 + S, 3), fbm(p * 1.25 + S + 5.1, 3), fbm(p * 1.25 + S + 9.7, 3));
  vec3 pd = p + 0.2 * w1;
  float r = length(pd);
  if (r > 1.0) return;
  // двухуровневое искажение для волокон
  vec3 q = p * 2.1 + 0.9 * w1;
  vec3 w2 = vec3(fbm(q + S * 1.3, 3), fbm(q + S + 2.2, 3), fbm(q + S + 4.4, 3));
  q += 1.15 * w2;
  float fil = ridged(q * 1.6 + S, 4);
  if (typ == 1){
    // старый остаток: тонкие ленты на разорванной оболочке
    float shellR = 0.8 + 0.08 * fbm(p * 2.0 + S + 3.0, 3);
    float shell = exp(-pow((r - shellR) / 0.12, 2.0));
    float arcs = smoothstep(-0.12, 0.3, fbm(p * 1.1 + S + 13.0, 3));          // сохранились только отдельные дуги
    // тонкие ленты: только гребни ridged-шума (плюс более мелкий второй слой волокон)
    float rib = smoothstep(0.55, 0.92, fil) * 2.4 + smoothstep(0.7, 0.96, ridged(q * 3.4 + S + 5.0, 3)) * 1.4;
    float d = shell * arcs * rib;
    float oiii = smoothstep(-0.2, 0.35, fbm(p * 1.8 + S + 21.0, 3));          // O III и H-α разнесены в пространстве
    e = mix(vec3(1.0, 0.24, 0.3), vec3(0.3, 0.85, 1.0), oiii) * d * 6.0;
    a = d * 0.4;
  } else if (typ == 2){
    // плерион: синхротронная туманность внутри и сеть волокон по всему объёму
    float syn = exp(-r * r * 4.5) * (0.55 + 0.45 * fbm(q * 1.5 + S + 7.0, 3));
    float net = pow(clamp(fil, 0.0, 1.0), 4.0) * smoothstep(0.95, 0.55, r) * 1.8;
    vec3 fc = mix(vec3(1.0, 0.38, 0.35), vec3(1.0, 0.68, 0.32), smoothstep(-0.2, 0.4, w2.x));
    e = vec3(0.45, 0.62, 1.0) * syn * 1.1 + fc * net;
    a = net * 0.5;
  } else {
    // молодой остаток: скомканная оболочка выбросов + внешняя ударная волна
    float shellR = 0.74 + 0.07 * fbm(p * 2.3 + S + 3.0, 3);
    float body = smoothstep(shellR + 0.06, shellR - 0.3, r) * smoothstep(0.12, 0.5, r);
    float clump = fbm(q * 1.7 + S + 7.0, 3) * 0.5 + 0.5;
    float big = smoothstep(0.35, 0.75, fbm(p * 2.2 + S + 17.0, 3) * 0.5 + 0.5);   // крупные сгустки и тёмные провалы между ними
    float ej = smoothstep(0.5, 0.95, fil * 0.7 + clump * 0.55) * body * (0.25 + 0.75 * big);
    float hot = smoothstep(0.82, 1.1, fil * 0.75 + clump * 0.55 + 0.25 * big) * body;          // уплотнения в местах столкновений
    vec3 c = mix(vec3(0.5, 0.05, 0.4), vec3(1.0, 0.22, 0.48), smoothstep(0.0, 0.6, ej));
    c = mix(c, vec3(1.0, 0.82, 0.5), smoothstep(0.2, 1.0, hot));
    e = c * (ej * 2.0 + hot * 5.0);
    // тонкая сине-циановая кромка рентгеновской внешней ударной волны
    float rimR = shellR + 0.12;
    float rim = exp(-pow((r - rimR) / 0.013, 2.0)) * (0.35 + 0.65 * smoothstep(-0.3, 0.5, fbm(q * 3.0 + S + 11.0, 2)));
    e += vec3(0.25, 0.55, 1.0) * rim * 0.75;
    a = ej * 0.9 + hot * 0.5;
  }
}
// трассировка через единичную сферу (ro, rd — в единицах радиуса остатка)
uniform float u_marchK;   // множитель шагов (пресет качества)
vec4 snrMarch(vec3 ro, vec3 rd, float s, int typ, float jitter){
  float b = dot(ro, rd), c = dot(ro, ro) - 1.0, h = b * b - c;
  if (h <= 0.0) return vec4(0.0);
  h = sqrt(h);
  float t0 = max(-b - h, 0.0), t1 = -b + h;
  if (t1 <= 0.0) return vec4(0.0);
  float nSt = max(14.0, floor(44.0 * (u_marchK > 0.0 ? u_marchK : 1.0)));
  float dt = (t1 - t0) / nSt;
  float t = t0 + jitter * dt;
  vec3 col = vec3(0.0); float T = 1.0;
  for (int i = 0; i < 44 + u_zero; i++){
    if (t >= t1) break;
    vec3 e; float a;
    snrSample(ro + rd * t, s, typ, e, a);
    col += T * e * dt;
    T *= exp(-a * dt);
    if (T < 0.04) break;
    t += dt;
  }
  return vec4(col, 1.0 - T);
}
`;
})();
