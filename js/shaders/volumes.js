'use strict';
/* =====================================================================
 *  Объёмные шейдеры: туманности (ray-marching по fBm), черная дыра
 *  Стрелец A* (интегрирование геодезических Шварцшильда + аккреционный
 *  диск с доплеровским усилением), пост-обработка (линза, bloom, ACES).
 * ===================================================================== */
(function () {
  const MW = window.MW;
  const G = MW.GLSL;

  // ---------- Туманности ----------
  G.nebulaFS = G.header + G.noise + G.ray + `
uniform vec3 u_c;
uniform float u_rb, u_full;
uniform mat3 u_rot;          // мир → локальная система туманности
uniform int u_kind;          // 0 эмиссионная (M42), 1 планетарная (M57), 2 остаток СН (M1), 3 отражательная, 4 гигантская H II
uniform float u_seed, u_bright, u_time;
uniform vec3 u_col1, u_col2, u_col3;
uniform float u_steps;       // базовое число шагов на диаметр
uniform vec4 u_par;          // параметры вида (синхротрон, тонкая оболочка, узлы, скорость вращения пульсара)
out vec4 o;
vec3 SP;
// эллипс (центр c, полуоси r, поворот ang) — приближённое расстояние со знаком
float sdEll(vec2 p, vec2 c, vec2 r, float ang){ p -= c; float cs = cos(ang), sn = sin(ang); p = vec2(cs * p.x + sn * p.y, -sn * p.x + cs * p.y); return (length(p / r) - 1.0) * min(r.x, r.y); }
// силуэт Конской Головы (Barnard 33): шея от кромки облака, наклонённая голова, морда вниз, ухо
float horse(vec2 q){
  float neck = sdEll(q, vec2(0.085, -0.03), vec2(0.06, 0.14), -0.22);
  float head = sdEll(q, vec2(0.035, 0.115), vec2(0.078, 0.058), 0.5);
  float snout = sdEll(q, vec2(-0.045, 0.06), vec2(0.062, 0.03), 0.8);
  float ear = sdEll(q, vec2(0.085, 0.185), vec2(0.017, 0.042), -0.35);
  return min(min(neck, head), min(snout, ear));
}
void sampleNeb(vec3 p, out vec3 emis, out float absb){
  float r = length(p);
  emis = vec3(0.0); absb = 0.0;
  if (u_kind == 0){
    vec3 s = p / vec3(1.0, 0.8, 0.55);
    float rs = length(s);
    vec3 w = vec3(fbm(s * 1.4 + SP, 4), fbm(s * 1.4 + SP + 5.2, 4), fbm(s * 1.4 + SP + 9.1, 4));
    vec3 q = s + w * 0.5;
    float f = fbm(q * 2.2 + SP, 6) * 0.5 + 0.5;
    float fil = ridged(q * 3.0 + SP * 1.3, 5);
    float body = smoothstep(1.0, 0.25, rs);
    float d = body * pow(smoothstep(0.42, 0.88, f * 0.75 + fil * 0.4), 2.0);
    float core = exp(-rs * rs * 16.0);
    float hot = exp(-rs * rs * 4.0);
    vec3 c = mix(u_col2, u_col1, smoothstep(0.1, 0.6, rs + 0.15 * (f - 0.5)));
    emis = c * d * 0.9 + mix(u_col2, vec3(1.0, 0.95, 0.9), 0.5) * (core * 1.1 + hot * d * 0.7);
    float dust = smoothstep(0.55, 0.85, fbm(q * 2.5 + SP + 3.3, 5) * 0.5 + 0.5) * smoothstep(1.0, 0.3, rs);
    float lane = smoothstep(0.22, 0.0, abs(s.y - 0.35 - 0.15 * s.x + 0.1 * w.x)) * smoothstep(0.2, 0.6, s.x + 0.3) * body;
    // плотные тёмные глобулы с резким краем — перекрывают свечение позади себя (3D-объём)
    float glob = smoothstep(0.625, 0.655, fbm(q * 4.5 + SP + 11.0, 4) * 0.5 + 0.5) * smoothstep(0.95, 0.3, rs);
    absb = dust * 4.0 + lane * 3.0 + glob * 18.0;
  } else if (u_kind == 7){
    // Конская Голова: светящийся лист H-α (IC 434, ионизован σ Ориона сверху) с вертикальными прожилками;
    // перед ним — плотное тёмное облако L1630 с ровной кромкой, из которой поднимается силуэт головы (B33).
    vec2 xy = p.xy;
    float wv = fbm(vec3(xy * 5.0, 1.0) + SP, 4);
    float sheet = exp(-pow((p.z - 0.15) / 0.22, 2.0)) * smoothstep(1.0, 0.55, length(xy));
    float stri = fbm(vec3(p.x * 9.0, p.y * 1.6, p.z * 3.0) + SP, 5) * 0.5 + 0.5;
    float grad = smoothstep(-0.6, 0.7, p.y);
    emis = u_col1 * sheet * (0.35 + 1.3 * stri) * (0.25 + 1.2 * grad);
    // кромка облака и силуэт (рваные края — шум)
    float edge = -0.07 + 0.035 * fbm(vec3(p.x * 7.0, 0.0, 2.0) + SP, 3);
    vec2 qh = xy + 0.012 * vec2(fbm(vec3(xy * 22.0, 3.0) + SP, 3), fbm(vec3(xy * 22.0, 7.0) + SP, 3));
    float dsil = min(p.y - edge, horse((qh - vec2(-0.05, -0.04)) / 2.1) * 2.1);   // голова ~ четверть поперечника IC 434
    float cloud = smoothstep(0.012, -0.01, dsil) * smoothstep(-0.75, -0.55, p.z) * smoothstep(0.12, 0.0, p.z) * smoothstep(1.0, 0.7, length(xy));
    // светящийся фронт ионизации по краю облака
    float rim = exp(-pow(dsil / 0.01, 2.0)) * smoothstep(-0.4, -0.05, p.z) * smoothstep(0.1, -0.05, p.z);
    emis += u_col2 * rim * 1.6;
    // голубая отражательная туманность NGC 2023 в облаке
    emis += u_col3 * exp(-dot(xy - vec2(-0.38, -0.36), xy - vec2(-0.38, -0.36)) / 0.006) * exp(-pow((p.z + 0.45) / 0.1, 2.0)) * 2.0;
    absb = cloud * (22.0 + 10.0 * wv) + sheet * 0.15;
  } else if (u_kind == 1){
    // толстый тор (бочка), видимый с торца: яркое кольцо и более тёмный центр
    float rho = length(vec2(p.x / 0.85, p.y));
    float n = fbm(p * 5.0 + SP, 5);
    float q = length(vec2(rho, p.z * 0.6));
    float shell = exp(-pow((rho - 0.58 - 0.05 * n) / 0.14, 2.0)) * exp(-pow(p.z / 0.55, 2.0));
    float inner = smoothstep(0.55, 0.0, rho) * exp(-pow(p.z / 0.4, 2.0)) * 0.12;
    float halo = exp(-pow((rho - 0.85) / 0.1, 2.0)) * exp(-pow(p.z / 0.6, 2.0)) * 0.12 * (0.6 + n);
    vec3 c = mix(u_col1, u_col2, smoothstep(0.35, 0.62, q));
    c = mix(c, u_col3, smoothstep(0.6, 0.8, q + 0.1 * n));
    float knots = smoothstep(0.2, 0.7, fbm(p * 14.0 + SP, 4));
    // «кометные узлы» (Улитка): радиальные капли на внутреннем крае кольца
    vec2 wk = worley(vec3(atan(p.y, p.x) * 9.0, rho * 22.0, p.z * 8.0) + SP).xy;
    float cometary = u_par.z * smoothstep(0.18, 0.05, wk.x) * exp(-pow((rho - 0.5) / 0.1, 2.0)) * exp(-pow(p.z / 0.4, 2.0));
    emis = c * (shell * (1.2 + 0.8 * knots) + inner) + u_col3 * halo + u_col3 * cometary * 1.5;
    absb = shell * knots * 0.6 + cometary * 2.0;
  } else if (u_kind == 2){
    vec3 s = p / vec3(1.0, 0.72, 0.72);
    float rs = length(s);
    vec3 w = vec3(fbm(s * 2.0 + SP, 3), fbm(s * 2.0 + SP + 4.0, 3), fbm(s * 2.0 + SP + 8.0, 3));
    vec3 q = s + w * 0.25;
    float fil = pow(ridged(q * 3.0 + SP, 6), 2.0);
    float shell = u_par.y > 0.5 ? smoothstep(1.0, 0.88, rs) * smoothstep(0.62, 0.86, rs) * 1.6
                                : smoothstep(1.0, 0.75, rs) * smoothstep(0.15, 0.6, rs);
    float sync = exp(-rs * rs * 3.0) * (0.6 + 0.4 * fbm(q * 4.0 + SP, 4)) * u_par.x;
    vec3 fc = mix(u_col1, u_col2, smoothstep(0.2, 0.8, fbm(q * 5.0, 3) * 0.5 + 0.5));
    emis = fc * fil * shell * 2.2 + u_col3 * sync * 0.9;
    absb = fil * shell * 0.5;
  } else if (u_kind == 5){
    // оболочка с полостью (Розетка): ветер центрального скопления выдул центр
    vec3 w = vec3(fbm(p * 1.5 + SP, 3), fbm(p * 1.5 + SP + 4.0, 3), fbm(p * 1.5 + SP + 8.0, 3));
    vec3 q = p + w * 0.3;
    float rq = length(q);
    float shell = smoothstep(0.28, 0.55, rq) * smoothstep(1.0, 0.7, rq);
    float f = fbm(q * 3.0 + SP, 6) * 0.5 + 0.5;
    float d = shell * pow(smoothstep(0.35, 0.85, f), 1.5);
    emis = mix(u_col1, u_col2, smoothstep(0.4, 0.85, rq)) * d * 1.3;
    float globs = smoothstep(0.77, 0.81, fbm(q * 7.0 + SP + 2.0, 4) * 0.5 + 0.5) * shell;
    absb = globs * 18.0 + d * 0.3;
  } else if (u_kind == 6){
    // пульсар: вращающиеся лучи вдоль магнитной оси, экваториальный тор ветра и джеты
    float wv = u_time * u_par.w;
    vec3 m = normalize(vec3(sin(0.75) * cos(wv), sin(0.75) * sin(wv), cos(0.75)));
    float cosA = dot(p, m) / max(r, 1e-4);
    float beam = pow(abs(cosA), 70.0) * exp(-r * 2.4) * (0.75 + 0.25 * sin(r * 60.0 - u_time * 15.0));
    float rho = length(p.xy);
    float torus = exp(-pow((rho - 0.32) / 0.07, 2.0)) * exp(-pow(p.z / 0.05, 2.0)) * (0.6 + 0.6 * fbm(p * 12.0 + SP + vec3(0.0, 0.0, u_time * 0.2), 3));
    float jet = exp(-pow(rho / 0.025, 2.0)) * smoothstep(0.65, 0.0, abs(p.z)) * (0.5 + 0.5 * fbm(vec3(p.z * 20.0 - u_time, 1.0, 2.0) + SP, 2));
    float neb = exp(-r * r * 5.0) * (0.4 + 0.6 * fbm(p * 5.0 + SP, 4)) * 0.3;
    emis = u_col1 * beam * 5.0 + u_col2 * (torus * 1.5 + jet * 1.2) + u_col3 * neb;
    absb = 0.0;
  } else if (u_kind == 3){
    vec3 w = vec3(fbm(p * 1.8 + SP, 3), fbm(p * 1.8 + SP + 4.0, 3), fbm(p * 1.8 + SP + 9.0, 3));
    vec3 q = p + w * 0.45;
    float f = fbm(q * 2.4 + SP, 6) * 0.5 + 0.5;
    float streak = fbm(vec3(q.x * 2.0, q.y * 6.0, q.z * 2.0) + SP, 4) * 0.5 + 0.5;
    float d = pow(smoothstep(0.5, 0.95, f * 0.65 + streak * 0.45), 1.5) * exp(-r * r * 3.0) * smoothstep(1.0, 0.7, r);
    emis = u_col1 * d * 1.2;
    absb = d * 0.3;
  } else {
    vec3 w = vec3(fbm(p * 1.3 + SP, 3), fbm(p * 1.3 + SP + 5.0, 3), fbm(p * 1.3 + SP + 9.0, 3));
    vec3 q = p + w * 0.4;
    float f = fbm(q * 2.0 + SP, 6) * 0.5 + 0.5;
    float d = smoothstep(0.35, 0.85, f) * smoothstep(1.0, 0.35, r);
    float hot = exp(-r * r * 5.0);
    vec3 c = mix(u_col1, u_col2, smoothstep(0.3, 0.8, ridged(q * 3.0 + SP, 4)));
    c = mix(c, u_col3, hot * 0.6);
    emis = c * (d * 1.3 + hot * 0.8);
    float pil = smoothstep(0.84, 0.9, ridged(q * vec3(2.0, 2.0, 0.7) + SP + 2.0, 5)) * smoothstep(1.0, 0.3, r);
    float glob = smoothstep(0.69, 0.72, fbm(q * 5.5 + SP + 6.0, 4) * 0.5 + 0.5) * smoothstep(1.0, 0.4, r);
    absb = pil * 12.0 + glob * 14.0 + smoothstep(0.6, 0.85, fbm(q * 3.0 + SP + 1.0, 4) * 0.5 + 0.5) * 2.0;
  }
}
void main(){
  SP = vec3(u_seed * 11.0, u_seed * 5.0, u_seed * 3.0);
  vec3 rd = rayDir();
  float tc = dot(u_c, rd);
  vec3 cpv = rd * tc - u_c;
  float b2 = dot(cpv, cpv);
  float rb2 = u_rb * u_rb;
  if (b2 >= rb2) discard;
  float hh = sqrt(rb2 - b2);
  float t0 = max(tc - hh, 0.0), t1 = tc + hh;
  if (t1 <= 0.0) discard;
  mat3 R = u_rot;
  vec3 ro = R * (-u_c) / u_rb;
  vec3 rdl = R * rd;
  float L0 = t0 / u_rb, L1 = t1 / u_rb;
  // базовый шаг: ~36 шагов на диаметр (вместо 72) — ступеньки убирает blue-noise джиттер
  float len = L1 - L0;
  float dt0 = max(len, 1e-4) / u_steps;
  // interleaved gradient noise — пространственный «синий» шум по экранным координатам (стабилен во времени)
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float t = L0 + ign * dt0;
  vec3 col = vec3(0.0);
  float T = 1.0;
  for (int i = 0; i < 96; i++){
    if (t >= L1) break;
    vec3 p = ro + rdl * t;
    // адаптивный шаг: вне плотного ядра шагаем крупнее
    float rr = length(p);
    if (rr > 1.0) { t += dt0 * 2.0; continue; }
    vec3 e; float a;
    sampleNeb(p, e, a);
    float dens = e.r + e.g + e.b + a;
    float dt = dens < 0.03 ? dt0 * 2.5 : (dens < 0.15 ? dt0 * 1.5 : dt0);
    dt = min(dt, L1 - t);
    col += T * e * dt;
    T *= exp(-a * dt);
    if (T < 0.05) break;          // ранний выход: непрозрачность ≥ 0.95
    t += dt;
  }
  o = vec4(col * u_bright, (1.0 - T) * 0.85);
}`;

  // ---------- Черная дыра: трассировка лучей в метрике Шварцшильда ----------
  G.blackholeFS = G.header + G.noise + G.ray + `
uniform vec3 u_c;
uniform float u_rb, u_full;
uniform float u_scale;        // D / Rs
uniform mat3 u_rot;           // мир → система диска (z — ось вращения)
uniform float u_time, u_rIn, u_rOut, u_bright;
uniform sampler2D u_scene;
uniform mat4 u_view, u_proj;
out vec4 o;
vec3 diskColor(vec3 hp, vec3 vel, float rr, out float opa){
  float ang = atan(hp.y, hp.x);
  float omega = 0.6 / pow(rr, 1.5);
  float a2 = ang - omega * u_time * 2.0;
  vec3 q = vec3(cos(a2) * rr, sin(a2) * rr, 0.0);
  float n1 = fbm(vec3(q.xy * 0.45, rr * 0.3), 5) * 0.5 + 0.5;
  float n2 = fbm(vec3(rr * 1.6, a2 * 2.0, 3.0), 4) * 0.5 + 0.5;
  float rings = 0.65 + 0.35 * sin(rr * 6.0 + n1 * 4.0);
  opa = smoothstep(u_rIn, u_rIn + 0.6, rr) * (1.0 - smoothstep(u_rOut * 0.55, u_rOut, rr)) * (0.55 + 0.45 * n1 * rings);
  float x = u_rIn / rr;
  float Tprof = pow(max(x * x * x * (1.0 - sqrt(x)), 0.0), 0.25) / 0.488;
  vec3 vdir = normalize(vec3(-hp.y, hp.x, 0.0));
  float beta = clamp(sqrt(0.5 / max(rr - 1.0, 0.1)), 0.0, 0.75);
  float gamma = 1.0 / sqrt(1.0 - beta * beta);
  float cosT = dot(vdir, -normalize(vel));
  float dop = 1.0 / (gamma * (1.0 - beta * cosT));
  float grav = sqrt(max(1.0 - 1.0 / rr, 0.0));
  float g = dop * grav;
  float T = 6200.0 * Tprof * g;
  vec3 c = pow(blackbody(T), vec3(1.5)) * pow(g, 3.0) * Tprof * Tprof * 3.5 * (0.5 + 0.8 * n2 * n1);
  return c;
}
vec3 sceneDir(vec3 dirW){
  vec4 vp = u_view * vec4(dirW, 0.0);
  if (vp.z > -0.02) return vec3(0.0);
  vec4 cp = u_proj * vec4(vp.xyz, 1.0);
  vec2 uv = cp.xy / cp.w * 0.5 + 0.5;
  vec2 cuv = clamp(uv, 0.0, 1.0);
  float edge = 1.0 - smoothstep(0.0, 0.15, length(uv - cuv));
  return texture(u_scene, cuv).rgb * edge;
}
void main(){
  vec3 rd = rayDir();
  float tc = dot(u_c, rd);
  vec3 cpv = rd * tc - u_c;
  float b2 = dot(cpv, cpv);
  float rb2 = u_rb * u_rb;
  if (b2 >= rb2) discard;
  float hh = sqrt(rb2 - b2);
  float t0 = tc - hh;
  if (tc + hh <= 0.0) discard;
  float Rb = u_rb * u_scale;
  vec3 pW = (t0 > 0.0) ? (cpv - rd * hh) : (-u_c);
  vec3 pos = u_rot * (pW * u_scale);
  vec3 vel = u_rot * rd;
  vec3 hv = cross(pos, vel);
  float h2 = dot(hv, hv);
  vec3 col = vec3(0.0);
  float T = 1.0;
  bool captured = false;
  float rmin = 1e9;
  for (int i = 0; i < 360; i++){
    float r2 = dot(pos, pos);
    float r = sqrt(r2);
    rmin = min(rmin, r);
    if (r < 1.0){ captured = true; break; }
    if (r > Rb * 1.01 && dot(pos, vel) > 0.0) break;
    float dt = clamp(0.08 * (r - 0.9), 0.015, 2.5);
    vec3 acc = -1.5 * h2 * pos / (r2 * r2 * r);
    vec3 np = pos + vel * dt + 0.5 * acc * dt * dt;
    vec3 acc2 = -1.5 * h2 * np / pow(dot(np, np), 2.5);
    vec3 nv = vel + 0.5 * (acc + acc2) * dt;
    if (pos.z * np.z < 0.0){
      float f = pos.z / (pos.z - np.z);
      vec3 hp = mix(pos, np, f);
      float rr = length(hp.xy);
      if (rr > u_rIn && rr < u_rOut){
        float opa;
        vec3 dc = diskColor(hp, vel, rr, opa);
        col += T * dc * opa;
        T *= 1.0 - opa * 0.92;
      }
    }
    pos = np; vel = normalize(nv);
    if (T < 0.01) break;
  }
  col += T * vec3(1.0, 0.75, 0.5) * exp(-pow((rmin - 1.5) * 9.0, 2.0)) * 0.6;
  vec3 bg = vec3(0.0);
  if (!captured && T > 0.01){
    vec3 dw = transpose(u_rot) * vel;
    bg = sceneDir(dw);
  }
  o = vec4(col * u_bright + T * bg, 1.0);
}`;

  // ---------- Пост-обработка ----------
  G.lensFS = G.header + `
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_bhUV;      // экранная позиция ЧД
uniform vec3 u_bhDir;     // направление на ЧД в системе камеры
uniform float u_thetaE, u_thetaSh, u_tanHalf, u_aspect, u_on;
out vec4 o;
void main(){
  if (u_on < 0.5){ o = texture(u_src, v_uv); return; }
  vec2 ndc = v_uv * 2.0 - 1.0;
  vec3 d = normalize(vec3(ndc.x * u_tanHalf * u_aspect, ndc.y * u_tanHalf, -1.0));
  float th = atan(length(cross(d, u_bhDir)), dot(d, u_bhDir));
  if (th < u_thetaSh){ o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float beta = th - u_thetaE * u_thetaE / th;
  vec3 axis = cross(u_bhDir, d);
  float al = length(axis);
  vec3 sd = d;
  if (al > 1e-7){
    vec3 perp = normalize(cross(axis / al, u_bhDir));
    sd = u_bhDir * cos(beta) + perp * sin(beta);
  }
  if (sd.z > -0.01){ o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 suv = vec2(sd.x / (-sd.z) / (u_tanHalf * u_aspect), sd.y / (-sd.z) / u_tanHalf) * 0.5 + 0.5;
  vec2 cuv = clamp(suv, 0.0, 1.0);
  float edge = 1.0 - smoothstep(0.0, 0.1, length(suv - cuv));
  float soft = smoothstep(u_thetaSh, u_thetaSh * 1.08, th);
  o = vec4(texture(u_src, cuv).rgb * edge * soft, 1.0);
}`;

  // перенос объёма туманности из буфера половинного разрешения (премультиплицированный цвет)
  G.blitFS = G.header + `
in vec2 v_uv;
uniform sampler2D u_src;
out vec4 o;
void main(){ o = texture(u_src, v_uv); }`;

  G.downFS = G.header + `
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform float u_threshold, u_first;
out vec4 o;
vec3 s(vec2 off){ return texture(u_src, v_uv + off * u_texel).rgb; }
void main(){
  vec3 a = s(vec2(-2.0, 2.0)), b = s(vec2(0.0, 2.0)), c = s(vec2(2.0, 2.0));
  vec3 d = s(vec2(-2.0, 0.0)), e = s(vec2(0.0)), f = s(vec2(2.0, 0.0));
  vec3 g = s(vec2(-2.0, -2.0)), h = s(vec2(0.0, -2.0)), i = s(vec2(2.0, -2.0));
  vec3 j = s(vec2(-1.0, 1.0)), k = s(vec2(1.0, 1.0)), l = s(vec2(-1.0, -1.0)), m = s(vec2(1.0, -1.0));
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  if (u_first > 0.5){
    float br = max(col.r, max(col.g, col.b));
    float soft = clamp(br - u_threshold * 0.5, 0.0, u_threshold);
    soft = soft * soft / (4.0 * u_threshold + 1e-4);
    float w = max(soft, br - u_threshold) / max(br, 1e-4);
    col *= w;
    col = min(col, vec3(4000.0));
  }
  o = vec4(col, 1.0);
}`;

  G.upFS = G.header + `
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform float u_radius;
out vec4 o;
void main(){
  vec4 d = u_texel.xyxy * vec4(1.0, 1.0, -1.0, 0.0) * u_radius;
  vec3 s = texture(u_src, v_uv - d.xy).rgb;
  s += texture(u_src, v_uv - d.wy).rgb * 2.0;
  s += texture(u_src, v_uv - d.zy).rgb;
  s += texture(u_src, v_uv + d.zw).rgb * 2.0;
  s += texture(u_src, v_uv).rgb * 4.0;
  s += texture(u_src, v_uv + d.xw).rgb * 2.0;
  s += texture(u_src, v_uv + d.zy).rgb;
  s += texture(u_src, v_uv + d.wy).rgb * 2.0;
  s += texture(u_src, v_uv + d.xy).rgb;
  o = vec4(s / 16.0, 1.0);
}`;

  G.compositeFS = G.header + `
in vec2 v_uv;
uniform sampler2D u_scene, u_bloom;
uniform float u_bloomStr, u_exposure, u_time, u_vignette, u_art;
out vec4 o;
vec3 aces(vec3 x){
  const mat3 m1 = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 m2 = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  vec3 v = m1 * x;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(m2 * (a / b), 0.0, 1.0);
}
void main(){
  vec3 c = texture(u_scene, v_uv).rgb;
  vec3 bl = texture(u_bloom, v_uv).rgb;
  c = c + bl * u_bloomStr;
  c *= u_exposure;
  vec2 q = v_uv - 0.5;
  c *= 1.0 - u_vignette * dot(q, q) * 1.6;
  vec3 tm = aces(c);
  if (u_art > 0.5){
    // кинематографичный ACES с сохранением оттенка: яркие наложения не выгорают в белый,
    // синий, золотой и пурпурный остаются насыщенными
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float lt = aces(vec3(l)).g;
    vec3 hp = c * (lt / max(l, 1e-5));
    hp /= max(1.0, max(hp.r, max(hp.g, hp.b)));
    tm = mix(tm, hp, 0.62 * (1.0 - smoothstep(1.2, 7.0, l)));   // самые яркие ядра — кремово-белые, как на фото
    float tl = dot(tm, vec3(0.2126, 0.7152, 0.0722));
    tm = max(mix(vec3(tl), tm, 1.12), 0.0);
  }
  c = tm;
  c = pow(c, vec3(1.0 / 2.2));
  float n = fract(sin(dot(gl_FragCoord.xy + fract(u_time) * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;
  // ---------- Оптика камеры: дифракционные лучи, блики объектива, анаморфное свечение ----------
  // Источники (до 16 самых ярких точек в кадре) передаются из JS: экранная позиция (px), видимая яркость и цвет.
  // Лучи: 8 игольчатых (4 длинных + 4 коротких, как у телескопа с крестовиной), с лёгкой хроматической
  // дисперсией — красный «хвост» луча длиннее синего, вдоль луча слабая радужная рябь.
  // Блики (ghosts) — для самого яркого источника: полупрозрачные диски с радужной кромкой вдоль оси
  // «источник → центр кадра», плюс горизонтальная анаморфная полоса.
  G.flareFS = G.header + `
in vec2 v_uv;
uniform vec2 u_res;
uniform int u_n;
uniform vec4 u_src[16];      // x, y (px), z — яркость, w — поворот лучей
uniform vec3 u_scol[16];
uniform float u_ghost;
out vec4 o;
vec3 spectrum(float t){ t = fract(t); return clamp(vec3(1.5 - abs(t * 4.0 - 1.0), 1.5 - abs(t * 4.0 - 2.0), 1.5 - abs(t * 4.0 - 3.0)), 0.0, 1.0); }
void main(){
  vec2 fc = v_uv * u_res;
  if (v_uv.x > 1.0 || v_uv.y > 1.0) discard;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 16; i++){
    if (i >= u_n) break;
    vec4 s = u_src[i];
    vec2 d = fc - s.xy;
    float I = s.z;
    float L = (16.0 + 34.0 * log2(1.0 + I)) * u_res.y / 1080.0;
    if (dot(d, d) > L * L * 1.6) continue;
    vec3 acc = vec3(0.0);
    for (int k = 0; k < 4; k++){
      float a = s.w + float(k) * 0.7853982;
      vec2 dir = vec2(cos(a), sin(a));
      float along = abs(dot(d, dir));
      float perp = abs(dot(d, vec2(-dir.y, dir.x)));
      float w = 0.5 + 0.7 * along / L;
      float core = exp(-perp * perp / (w * w));
      vec3 len = L * vec3(1.0, 0.88, 0.76) * (k == 0 || k == 2 ? 1.0 : 0.5);
      vec3 fall = exp(-along / (len * 0.3));
      vec3 tint = mix(vec3(1.0), spectrum(along / (L * 0.22) + 0.15), 0.3 * smoothstep(0.08, 0.4, along / L));
      acc += core * fall * tint;
    }
    col += u_scol[i] * acc * sqrt(I) * 0.55;
  }
  if (u_n > 0 && u_ghost > 0.001){
    vec2 p0 = u_src[0].xy, c = u_res * 0.5;
    vec2 axis = c - p0;
    float sc = u_res.y;
    for (int j = 0; j < 6; j++){
      float t = j == 0 ? 0.55 : j == 1 ? 1.15 : j == 2 ? 1.42 : j == 3 ? 1.78 : j == 4 ? 2.1 : 2.6;
      float rad = (j == 0 ? 0.03 : j == 1 ? 0.055 : j == 2 ? 0.016 : j == 3 ? 0.085 : j == 4 ? 0.04 : 0.13) * sc;
      vec2 g = p0 + axis * t;
      float rr = length(fc - g) / rad;
      if (rr > 1.3) continue;
      float disc = smoothstep(1.0, 0.75, rr) * 0.1;
      float rim = exp(-pow((rr - 0.95) / 0.06, 2.0)) * 0.22;
      vec3 gc = mix(vec3(0.6, 0.8, 1.0), spectrum(rr * 0.9 + float(j) * 0.17), 0.45);
      col += gc * (disc + rim) * u_ghost * (j == 5 ? 0.35 : 1.0);
    }
    // анаморфная полоса через источник
    vec2 d0 = fc - p0;
    float streak = exp(-d0.y * d0.y / (1.6 * 1.6)) * exp(-abs(d0.x) / (u_res.x * 0.09));
    col += vec3(0.45, 0.65, 1.0) * streak * u_ghost * 0.6;
  }
  o = vec4(col, 0.0);
}`;

  // ---------- Автоэкспозиция: средняя лог-яркость кадра (сетка 4×4 выборок на пиксель маленькой цели) ----------
  // R — средний log2 яркости (упакован в 0…1), G — доля очень ярких выборок (Солнце/звезда вблизи в кадре)
  G.lumFS = G.header + `
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_cell;     // размер ячейки (в UV)
out vec4 o;
void main(){
  float acc = 0.0, br = 0.0;
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++){
    vec2 uv = v_uv - u_cell * 0.5 + u_cell * (vec2(float(x), float(y)) + 0.5) / 4.0;
    vec3 c = texture(u_src, uv).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    acc += log2(max(l, 1e-5));
    br += step(3.0, l);
  }
  acc /= 16.0; br /= 16.0;
  o = vec4(clamp((acc + 16.0) / 22.0, 0.0, 1.0), br, 0.0, 1.0);
}`;
})();
