'use strict';
/* =====================================================================
 *  Общие GLSL-фрагменты: шум (simplex 3D, fBm, ridged, Worley),
 *  хеши, лучевые утилиты и вершинный шейдер «импостора» сферы.
 * ===================================================================== */
(function () {
  const MW = window.MW;
  const G = (MW.GLSL = MW.GLSL || {});

  G.header = `#version 300 es
precision highp float;
precision highp int;
`;

  G.noise = `
// u_zero никогда не задаётся (= 0), но компилятор этого не знает: циклы шума не разворачиваются
// полностью — иначе D3D/ANGLE компилирует большие шейдеры десятки секунд
uniform int u_zero;
vec3 mod289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm(vec3 p, int oct){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < min(oct, 12) + u_zero; i++){ s += a * snoise(p); p = p * 2.02 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s;
}
float fbmG(vec3 p, int oct, float lac, float gain){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < min(oct, 12) + u_zero; i++){ s += a * snoise(p); p = p * lac + vec3(5.3, 1.1, 7.7); a *= gain; }
  return s;
}
float ridged(vec3 p, int oct){
  float a = 0.5, s = 0.0, prev = 1.0;
  for (int i = 0; i < min(oct, 12) + u_zero; i++){
    float n = 1.0 - abs(snoise(p)); n *= n;
    s += n * a * prev; prev = n;
    p = p * 2.03 + vec3(3.1, 4.7, 1.3); a *= 0.5;
  }
  return s;
}
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3){ p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// Worley: x = F1, y = F2
vec2 worley(vec3 p){
  vec3 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int z = -1; z <= 1 + u_zero; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 r = g + hash33(i + g) - f;
    float d = dot(r, r);
    if (d < d1){ d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return sqrt(vec2(d1, d2));
}
`;

  G.ray = `
uniform mat3 u_camRot;     // базис камеры → мир (столбцы: right, up, back)
uniform vec2 u_res;
uniform float u_tanHalf;
uniform float u_aspect;
vec3 rayDir(){
  vec2 ndc = gl_FragCoord.xy / u_res * 2.0 - 1.0;
  return normalize(u_camRot * vec3(ndc.x * u_tanHalf * u_aspect, ndc.y * u_tanHalf, -1.0));
}
// пересечение луча (o + t d) со сферой (c, r): x = ближняя, y = дальняя; x > y — промах
vec2 raySphere(vec3 o, vec3 d, vec3 c, float r){
  vec3 oc = o - c;
  float b = dot(oc, d);
  float cc = dot(oc, oc) - r * r;
  float h = b * b - cc;
  if (h < 0.0) return vec2(1e20, -1e20);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
vec3 blackbody(float T){
  T = clamp(T, 1000.0, 40000.0) / 100.0;
  vec3 c;
  c.r = T <= 66.0 ? 1.0 : clamp(1.29293618606 * pow(T - 60.0, -0.1332047592), 0.0, 1.0);
  c.g = T <= 66.0 ? clamp(0.39008157876 * log(T) - 0.63184144378, 0.0, 1.0) : clamp(1.12989086089 * pow(T - 60.0, -0.0755148492), 0.0, 1.0);
  c.b = T >= 66.0 ? 1.0 : (T <= 19.0 ? 0.0 : clamp(0.54320678911 * log(T - 10.0) - 1.19625408914, 0.0, 1.0));
  // pow(0, y) в GLSL не определён (на D3D/ANGLE даёт NaN) — основание всегда > 0
  c = pow(max(c, vec3(1e-5)), vec3(2.2));
  return c / max(max(c.r, c.g), max(c.b, 1e-4));
}
`;

  // Вершинный шейдер импостора: квад, точно покрывающий силуэт ограничивающей сферы.
  G.impostorVS = G.header + `
layout(location=0) in vec2 a_corner;
uniform mat4 u_view, u_proj;
uniform vec3 u_c;      // центр относительно камеры (нормирован на расстояние)
uniform float u_rb;    // радиус ограничивающей сферы (в тех же единицах)
uniform float u_full;  // 1 = на весь экран
void main(){
  if (u_full > 0.5){ gl_Position = vec4(a_corner, 0.0, 1.0); return; }
  float d = length(u_c);
  vec3 n = u_c / d;
  float q = max(d * d - u_rb * u_rb, 1e-8);
  float dp = q / d;
  float rp = u_rb * sqrt(q) / d * 1.02;
  vec3 t1 = normalize(cross(n, abs(n.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(n, t1);
  vec3 p = n * dp + (t1 * a_corner.x + t2 * a_corner.y) * rp;
  gl_Position = u_proj * u_view * vec4(p, 1.0);
}`;

  G.fullscreenVS = G.header + `
out vec2 v_uv;
void main(){
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
})();
