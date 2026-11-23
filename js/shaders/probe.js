'use strict';
/* =====================================================================
 *  Процедурная 3D-модель «Вояджера»: трассировка SDF из примитивов
 *  в импосторе. Размеры в метрах по чертежам JPL:
 *   антенна HGA Ø3,66 м с контррефлектором на распорках, десятигранный
 *   корпус Ø1,78 м с Золотой пластинкой, штанга РИТЭГов (3 оребрённых
 *   цилиндра), научная штанга с платформой и камерами ISS, штанга
 *   магнитометра 13 м, две антенны плазменных волн по 10 м.
 *  Ось +z смотрит на Землю (≈ на Солнце).
 * ===================================================================== */
(function () {
  const MW = window.MW;
  const G = MW.GLSL;

  G.probeFS = G.header + G.noise + G.ray + `
uniform vec3 u_c;
uniform float u_r, u_rb, u_full, u_rbM, u_pxPerRad;
uniform mat3 u_bodyRot;
uniform vec3 u_sunDir, u_sunCol;
uniform float u_variant;   // 0 — Вояджер-1, 1 — Вояджер-2 (одинаковы, отличаются мелочами)
out vec4 o;
float gPix;
const float FD = 1.4, ZV = 0.3, RD = 1.83;

float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdCapsule(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - max(r, gPix); }
float sdCylZ(vec3 p, float r, float h){ vec2 d = abs(vec2(length(p.xy), p.z)) - vec2(r, h); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
float sdCylX(vec3 p, float r, float h){ return sdCylZ(p.yzx, r, h); }

// материал: 1 антенна, 2 корпус, 3 штанги, 4 РИТЭГ, 5 золото, 6 приборы, 7 контррефлектор, 8 золотая термоизоляция
vec2 mapS(vec3 p){
  vec2 r = vec2(1e9, 0.0);
  // параболическая антенна: z = ZV + ρ²/4F, тонкая оболочка, обрезанная по Ø3,66 м
  float rho = length(p.xy);
  float dz = (p.z - ZV - rho * rho / (4.0 * FD)) / sqrt(1.0 + rho * rho / (4.0 * FD * FD));
  float dish = max(abs(dz) - 0.03, rho - RD);
  if (dish < r.x) r = vec2(dish, 1.0);
  // контррефлектор и четыре распорки
  float sub = sdCylZ(p - vec3(0.0, 0.0, ZV + FD), 0.24, 0.03);
  if (sub < r.x) r = vec2(sub, 7.0);
  float zr = ZV + RD * RD / (4.0 * FD);
  for (int i = 0; i < 4 + u_zero; i++){
    float a = float(i) * 1.5708 + 0.785;
    float st = sdCapsule(p, vec3(cos(a) * 1.45, sin(a) * 1.45, ZV + 1.45 * 1.45 / (4.0 * FD)), vec3(cos(a) * 0.2, sin(a) * 0.2, ZV + FD - 0.02), 0.018);
    if (st < r.x) r = vec2(st, 3.0);
  }
  float horn = sdCylZ(p - vec3(0.0, 0.0, ZV + 0.25), 0.12, 0.25);
  if (horn < r.x) r = vec2(horn, 6.0);
  // десятигранный корпус Ø1,78 м, высота 0,47 м
  float an = 3.14159265 / 10.0;
  float ang = atan(p.y, p.x);
  float fa = mod(ang + an, 2.0 * an) - an;
  float bus = max(length(p.xy) * cos(fa) - 0.85, abs(p.z) - 0.235);
  if (bus < r.x) r = vec2(bus, 2.0);
  // топливный бак и блок двигателей снизу
  float tank = sdCylZ(p - vec3(0.0, 0.0, -0.4), 0.42, 0.18);
  if (tank < r.x) r = vec2(tank, 8.0);
  // Золотая пластинка на боковой грани корпуса (направление −y)
  vec3 q = p - vec3(0.0, -0.84, 0.0);
  float rec = sdCylZ(q.xzy, 0.155, 0.012);
  if (rec < r.x) r = vec2(rec, 5.0);
  // штанга РИТЭГов (−x) и три оребрённых цилиндра
  float bR = sdCapsule(p, vec3(-0.8, 0.0, -0.1), vec3(-3.2, 0.0, -0.25), 0.035);
  if (bR < r.x) r = vec2(bR, 3.0);
  for (int i = 0; i < 3 + u_zero; i++){
    vec3 c = vec3(-1.75 - float(i) * 0.55, 0.0, -0.17 - float(i) * 0.035);
    vec3 pr = p - c;
    float fin = smoothstep(0.55, 0.95, cos(6.0 * atan(pr.z, pr.y)));
    float rtg = sdCylX(pr, 0.19 + 0.1 * fin, 0.24) * 0.7;
    if (rtg < r.x) r = vec2(rtg, 4.0);
  }
  // научная штанга (+x) с приборами и сканирующей платформой
  float bS = sdCapsule(p, vec3(0.8, 0.0, 0.0), vec3(3.0, 0.0, 0.05), 0.04);
  if (bS < r.x) r = vec2(bS, 3.0);
  float crs = sdBox(p - vec3(1.55, 0.0, 0.18), vec3(0.22, 0.18, 0.14));
  if (crs < r.x) r = vec2(crs, 8.0);
  float lecp = sdCylZ(p - vec3(2.1, 0.0, 0.17), 0.12, 0.12);
  if (lecp < r.x) r = vec2(lecp, 6.0);
  float plat = sdBox(p - vec3(3.05, 0.0, -0.05), vec3(0.28, 0.25, 0.2));
  if (plat < r.x) r = vec2(plat, 6.0);
  // камеры ISS: узкоугольная (длинная) и широкоугольная
  float nac = sdCapsule(p, vec3(3.05, 0.12, -0.25), vec3(3.05, 0.12, -1.05), 0.09);
  if (nac < r.x) r = vec2(nac, 6.0);
  float wac = sdCapsule(p, vec3(3.05, -0.13, -0.25), vec3(3.05, -0.13, -0.6), 0.06);
  if (wac < r.x) r = vec2(wac, 6.0);
  float iris = sdCylZ(p - vec3(3.3, 0.0, -0.4), 0.2, 0.15);
  if (iris < r.x) r = vec2(iris, 8.0);
  // штанга магнитометра 13 м (раскладная ферма Astromast) с датчиками
  vec3 m0 = vec3(-0.5, 0.75, 0.1), m1 = vec3(-4.2, 12.4, 0.6);
  float mag = sdCapsule(p, m0, m1, 0.03);
  if (mag < r.x) r = vec2(mag, 3.0);
  float ms1 = sdCapsule(p, mix(m0, m1, 0.5) - vec3(0.1), mix(m0, m1, 0.5) + vec3(0.1), 0.07);
  float ms2 = sdCapsule(p, m1 - vec3(0.1), m1 + vec3(0.05), 0.08);
  float ms = min(ms1, ms2);
  if (ms < r.x) r = vec2(ms, 8.0);
  // антенны плазменных волн (две по 10 м)
  float pw1 = sdCapsule(p, vec3(0.3, -0.8, -0.2), vec3(5.5, -8.5, -1.2), 0.012);
  float pw2 = sdCapsule(p, vec3(-0.3, -0.8, -0.2), vec3(-5.5, -8.5, -1.2), 0.012);
  float pw = min(pw1, pw2);
  if (pw < r.x) r = vec2(pw, 3.0);
  return r;
}
vec3 calcN(vec3 p, float e){
  // тетраэдрическая разность в цикле: mapS встраивается один раз, а не четыре
  vec3 n = vec3(0.0);
  for (int i = 0; i < 4 + u_zero; i++){
    vec3 k = 0.5773 * (2.0 * vec3(float(((i + 3) >> 1) & 1), float((i >> 1) & 1), float(i & 1)) - 1.0);
    n += k * mapS(p + k * e).x;
  }
  return normalize(n);
}
float softShadow(vec3 p, vec3 L){
  float res = 1.0, t = 0.03;
  for (int i = 0; i < 40 + u_zero; i++){
    float h = mapS(p + L * t).x;
    res = min(res, 12.0 * h / t);
    t += clamp(h, 0.02, 0.6);
    if (res < 0.02 || t > 16.0) break;
  }
  return clamp(res, 0.0, 1.0);
}
vec3 matCol(float m, vec3 p, out float spec, out float rough){
  spec = 0.04; rough = 0.6;
  if (m < 1.5){ spec = 0.05; return vec3(0.86, 0.86, 0.84) * (0.95 + 0.05 * fbm(p * 8.0, 2)); }
  if (m < 2.5){
    // грани корпуса: чередование серебристой и тёмной термозащиты
    float an = 3.14159265 / 10.0;
    float sec = floor((atan(p.y, p.x) + an) / (2.0 * an));
    spec = 0.5; rough = 0.35;
    return mod(sec, 2.0) < 0.5 ? vec3(0.55, 0.56, 0.58) : vec3(0.12, 0.12, 0.13);
  }
  if (m < 3.5){ spec = 0.4; rough = 0.3; return vec3(0.62, 0.6, 0.56); }
  if (m < 4.5){ spec = 0.15; rough = 0.5; return vec3(0.16, 0.16, 0.17); }
  if (m < 5.5){
    // Золотая пластинка: позолоченная алюминиевая крышка с гравировкой
    spec = 0.9; rough = 0.12;
    vec2 q = p.xz;
    float ring = 0.85 + 0.15 * sin(length(q) * 400.0);
    return vec3(1.0, 0.76, 0.33) * ring;
  }
  if (m < 6.5){ spec = 0.2; rough = 0.4; return vec3(0.07, 0.07, 0.075); }
  if (m < 7.5){ return vec3(0.8, 0.8, 0.78); }
  // золотистая многослойная термоизоляция
  spec = 0.6; rough = 0.25;
  float crinkle = 0.8 + 0.2 * fbm(p * 30.0, 3);
  return vec3(0.85, 0.62, 0.25) * crinkle;
}
void main(){
  vec3 rdW = rayDir();
  float tcW = dot(u_c, rdW);
  if (tcW < 0.0 && u_full < 0.5) discard;
  // луч в системе аппарата, единицы — метры
  vec3 ro = (u_bodyRot * (-u_c)) * (u_rbM / u_rb);
  vec3 rd = u_bodyRot * rdW;
  float Rm = u_rbM;
  float b = dot(ro, rd), c = dot(ro, ro) - Rm * Rm, h = b * b - c;
  if (h < 0.0) discard;
  h = sqrt(h);
  float t0 = max(-b - h, 0.0), t1 = -b + h;
  if (t1 <= 0.0) discard;
  float distM = length(ro);
  gPix = distM / u_pxPerRad * 0.5;
  float t = t0, m = 0.0;
  bool hit = false;
  for (int i = 0; i < 128 + u_zero; i++){
    vec3 p = ro + rd * t;
    vec2 d = mapS(p);
    float eps = max(t / u_pxPerRad * 0.35, 1e-4);
    if (d.x < eps){ hit = true; m = d.y; break; }
    t += d.x * 0.9;
    if (t > t1) break;
  }
  if (!hit) discard;
  vec3 p = ro + rd * t;
  vec3 n = calcN(p, max(t / u_pxPerRad * 0.5, 2e-4));
  vec3 L = normalize(u_bodyRot * u_sunDir);
  float spec, rough;
  vec3 alb = matCol(m, p, spec, rough);
  float ndl = max(dot(n, L), 0.0);
  float sh = ndl > 0.0 ? softShadow(p + n * 0.01, L) : 0.0;
  vec3 V = -rd, H = normalize(L + V);
  float nh = max(dot(n, H), 0.0);
  float sp = pow(nh, mix(400.0, 20.0, rough)) * spec * 3.0;
  float fres = pow(1.0 - max(dot(n, V), 0.0), 5.0);
  // свет далёкого Солнца + слабый «звёздный» заполняющий свет + рассеяние от Млечного Пути
  vec3 col = u_sunCol * (alb * ndl + sp) * sh;
  // заполняющий свет: «небо» Млечного Пути и условная подсветка для осмотра теневой стороны
  float hemi = 0.5 + 0.5 * dot(n, normalize(vec3(0.3, 0.8, -0.4)));
  col += alb * (0.07 + 0.11 * hemi) * vec3(0.85, 0.9, 1.0) + vec3(0.05, 0.06, 0.08) * fres;
  // контровой свет от Солнца по краям
  col += u_sunCol * pow(1.0 - max(dot(n, V), 0.0), 3.0) * max(dot(-V, L), 0.0) * 0.35;
  o = vec4(col, 1.0);
}`;
})();
