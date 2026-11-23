'use strict';
/* =====================================================================
 *  Шейдеры космоса: небесная сфера (полоса Млечного Пути + звёздный фон +
 *  координатные сетки), частицы галактики (свет и пыль), звёзды по
 *  звёздной величине, линии.
 * ===================================================================== */
(function () {
  const MW = window.MW;
  const G = MW.GLSL;

  // ---------- Небесная сфера (на бесконечности) ----------
  G.skyFS = G.header + G.noise + G.ray + `
uniform float u_skyFade, u_grid, u_pixAng, u_starField, u_art;
uniform sampler2D u_pano;     // панорама ESO/NASA в галактических координатах (equirectangular)
uniform float u_panoK, u_panoGain;
uniform mat3 u_gal2eq, u_gal2ecl;
out vec4 o;
float gridLine(float v, float step, float w){
  float f = abs(fract(v / step + 0.5) - 0.5) * step;
  return 1.0 - smoothstep(0.0, w, f);
}
vec3 starLayer(vec3 d, float res, float dens, float bright){
  vec3 p = d * res;
  vec3 id = floor(p);
  vec3 h = hash33(id);
  if (h.x > dens) return vec3(0.0);
  vec3 sp = normalize(id + 0.3 + 0.4 * hash33(id + 17.0));
  float ang = length(cross(d, sp));
  float px = ang / u_pixAng;
  float mag = pow(h.y, 7.0);
  float core = exp(-px * px * 1.8);
  vec3 tint = mix(vec3(1.0, 0.72, 0.5), vec3(0.7, 0.82, 1.0), h.z);
  tint = mix(tint, vec3(1.0), 0.45);
  return tint * core * (0.08 + 2.2 * mag) * bright;
}
void main(){
  vec3 d = rayDir();
  vec3 col = vec3(0.0);
  if (u_skyFade > 0.001){
    float b = d.z;
    float l = atan(d.y, d.x);
    float gc = 0.5 + 0.5 * cos(l);
    float w = 0.1 + 0.07 * gc;
    float band = exp(-b * b / (w * w));
    float bul = exp(-(l * l) / 0.18 - (b * b) / 0.03);
    float n1 = fbm(d * 3.5 + vec3(1.3), 6) * 0.5 + 0.5;
    float n2 = fbm(d * 11.0 + vec3(4.1), 5) * 0.5 + 0.5;
    float n3 = fbm(d * 40.0, 4) * 0.5 + 0.5;
    float n4 = fbm(d * 150.0, 3) * 0.5 + 0.5;
    float clouds = band * (0.35 + 0.9 * n1 * n1) * (0.6 + 0.6 * n2) * (0.8 + 0.3 * n3) * (0.7 + 0.6 * n4);
    float rift = smoothstep(0.42, 0.72, fbm(d * vec3(5.0, 5.0, 14.0) + vec3(7.7), 6) * 0.5 + 0.5 + 0.25 * gc);
    // ось провала извивается, ширина «дышит», а сам он разорван ridged fBm на отдельные облака
    float meander = 0.045 * fbm(d * vec3(2.2, 2.2, 1.0) + vec3(5.1), 3) + 0.02 * fbm(d * 7.0 + vec3(1.9), 2);
    float riftMask = exp(-pow(b - 0.01 - meander, 2.0) / (0.0016 + 0.005 * n1 * n1));
    float tear = smoothstep(0.22, 0.6, ridged(d * vec3(9.0, 9.0, 16.0) + vec3(4.4), 5));
    riftMask *= 0.25 + 0.75 * tear;
    riftMask *= 1.0 - 0.75 * smoothstep(0.25, 0.9, bul);
    // высокочастотные пылевые прожилки (ridged fBm) и тёмные глобулы (Worley) — без «мыла»
    float veins = ridged(d * vec3(26.0, 26.0, 64.0) + vec3(2.3), 6);
    float fine = ridged(d * vec3(90.0, 90.0, 180.0) + vec3(9.1), 4);
    float glob = 1.0 - smoothstep(0.04, 0.2, worley(d * 85.0 + vec3(3.0)).x);
    float dust = rift * riftMask * (0.45 + 0.75 * veins) * (0.75 + 0.4 * fine);
    dust += band * riftMask * (veins * veins * 0.35 + glob * 0.3) * smoothstep(0.2, 0.7, rift + 0.35);
    dust = clamp(dust, 0.0, 0.95);
    vec3 warm = vec3(1.0, 0.82, 0.62), cool = vec3(0.72, 0.8, 1.0);
    vec3 mw = mix(cool, warm, 0.35 + 0.5 * gc) * (clouds * (0.55 + 0.6 * gc) + bul * 1.1);
    float kb = 0.08;
    if (u_art > 0.5){
      // художественный HDR: янтарное ядро к Стрельцу, сапфировые края, розово-пурпурные облака H II
      vec3 aw = vec3(1.0, 0.6, 0.3), ac = vec3(0.32, 0.55, 1.0), am = vec3(1.0, 0.3, 0.68);
      float hII = smoothstep(0.62, 0.86, fbm(d * 9.0 + vec3(3.3), 4) * 0.5 + 0.5) * band;
      mw = mix(ac, aw, smoothstep(0.15, 0.95, gc + 0.2 * (n1 - 0.5))) * (clouds * (0.55 + 0.7 * gc) + bul * 1.4);
      mw += am * hII * clouds * 0.9;
      col += ac * exp(-b * b / 0.09) * 0.006 * u_skyFade;   // широкое голубоватое сияние диска
      kb = 0.12;
    }
    mw *= 1.0 - dust;
    col += mw * kb * u_skyFade;
    if (u_starField > 0.5){
      float sd = 0.25 + 0.75 * band + bul;
      float rs = clamp(0.0012 / u_pixAng, 0.6, 3.0);
      vec3 st = starLayer(d, 60.0 * rs, 0.3 * sd, 1.0) + starLayer(d, 110.0 * rs, 0.22 * sd, 0.6) + starLayer(d, 200.0 * rs, 0.12 * sd, 0.35);
      col += st * (1.0 - dust * 0.8) * u_skyFade * 0.5;
    }
  }
  if (u_panoK > 0.001){
    // реальное небо: центр кадра — центр Галактики (l = 0), долгота растёт влево, b = +90° сверху
    float l = atan(d.y, d.x), bb = asin(clamp(d.z, -1.0, 1.0));
    vec2 uv = vec2(0.5 - l / 6.2831853, 0.5 - bb / 3.14159265);
    vec2 uv2 = vec2(fract(uv.x + 0.5), uv.y);
    vec2 gx = dFdx(uv), gy = dFdy(uv), gx2 = dFdx(uv2), gy2 = dFdy(uv2);
    if (abs(gx2.x) + abs(gy2.x) < abs(gx.x) + abs(gy.x)){ gx = gx2; gy = gy2; }   // без шва на l = 180°
    vec3 pano = textureGrad(u_pano, uv, gx, gy).rgb * u_panoGain;
    col = mix(col, pano, u_panoK);
  }
  if (u_grid > 0.5){
    float pw = u_pixAng * 1.2;
    vec3 e = u_gal2eq * d;
    float ra = atan(e.y, e.x), dec = asin(clamp(e.z, -1.0, 1.0));
    float gr = max(gridLine(ra * cos(dec), 0.2618 * cos(dec), pw), gridLine(dec, 0.1745, pw));
    if (abs(dec) > 1.4) gr = gridLine(dec, 0.1745, pw);
    col += vec3(0.15, 0.32, 0.55) * gr * 0.35;
    float eq = 1.0 - smoothstep(0.0, pw * 1.5, abs(dec));
    col += vec3(0.25, 0.55, 0.9) * eq * 0.4;
    vec3 ec = u_gal2ecl * d;
    float ecl = 1.0 - smoothstep(0.0, pw * 1.5, abs(asin(clamp(ec.z, -1.0, 1.0))));
    col += vec3(0.9, 0.7, 0.2) * ecl * 0.35;
    float gpl = 1.0 - smoothstep(0.0, pw * 1.5, abs(asin(clamp(d.z, -1.0, 1.0))));
    col += vec3(0.8, 0.3, 0.6) * gpl * 0.3;
  }
  o = vec4(col, 1.0);
}`;

  // ---------- Частицы галактики (излучающие) ----------
  G.particleVS = G.header + `
layout(location=0) in vec2 a_corner;
layout(location=1) in vec3 i_pos;
layout(location=2) in vec4 i_col;
uniform mat4 u_view, u_proj;
uniform mat3 u_model;
uniform vec3 u_origin;
uniform float u_pxPerRad, u_minPx, u_maxPx, u_bright, u_nearFade;
uniform float u_art;   // 1 = художественный HDR: насыщенная палитра
uniform float u_dustMask; // 1 = пыль Млечного Пути: рваные облака вместо сплошной ленты
uniform float u_bigFade;  // 1 = гасить спрайты, раздутые на экране
float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float ridgedV(vec3 p){
  float s = 0.0, a = 0.5, prev = 1.0;
  for (int i = 0; i < 4; i++){ float n = 1.0 - abs(vnoise(p) * 2.0 - 1.0); n *= n; s += n * a * prev; prev = n; p = p * 2.07 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s;
}
out vec2 v_uv;
out vec3 v_col;
out float v_s;
out float v_seed;
// художественная палитра: тёплое → янтарно-золотое, холодное → сапфир/циан, H II → маджента
vec3 artGrade(vec3 c){
  float l = max(dot(c, vec3(0.3, 0.5, 0.2)), 1e-4);
  float cool = clamp((c.b - c.r) / l * 2.2, -1.0, 1.0);
  vec3 s = max(mix(vec3(l), c, cool > 0.0 ? 2.1 : 1.35), 0.0);
  float mag = clamp((min(c.r, c.b) - c.g) / l * 1.8, 0.0, 1.0);
  // старые звёзды диска — кремово-золотые (мягко), бар/балдж — насыщенный янтарь, молодые — сапфир/циан
  float warmK = smoothstep(0.35, 1.0, -cool) * 0.8;
  vec3 tint = cool > 0.0 ? mix(vec3(1.0), vec3(0.32, 0.62, 1.3), cool) : mix(vec3(1.0, 0.96, 0.9), vec3(1.3, 0.86, 0.42), warmK);
  tint = mix(tint, vec3(1.45, 0.32, 1.05), mag);
  return s * tint;
}
void main(){
  vec3 ip = i_pos;
  float dm = 1.0;
  if (u_dustMask > 0.5){
    // ridged fBm в мировых координатах рвёт пылевой слой на ветвящиеся облака и прожилки,
    // низкочастотный шум изгибает слой по высоте — нет ровной ленты вдоль Z = 0
    float r = ridgedV(i_pos / 1900.0);
    // вблизи Солнца пыль привязана к реальным облакам — там шумовая деформация не применяется
    float farK = smoothstep(1500.0, 4000.0, length(i_pos - vec3(-26000.0, 0.0, 20.0)));
    dm = mix(1.0, smoothstep(0.28, 0.62, r) * 2.0, farK);
    ip.z += ((vnoise(i_pos / 2600.0 + 7.3) - 0.5) * 1100.0 + (vnoise(i_pos / 700.0) - 0.5) * 260.0) * farK;
    dm *= smoothstep(2000.0, 5500.0, length(i_pos.xy));   // плавно гаснет в центре балджа
  }
  vec3 rel = u_model * ip + u_origin;
  float d = max(length(rel), 1e-6);
  float size = i_col.a;
  float pix = size / d * u_pxPerRad;
  float s = clamp(pix, u_minPx, u_maxPx);
  float energy = pix < u_minPx ? (pix * pix) / (u_minPx * u_minPx) : 1.0;
  float fade = smoothstep(u_nearFade * 0.35, u_nearFade, d / size);
  // далёкая пыль, сложенная вдоль луча зрения, не сливается в сплошную ленту по экватору
  if (u_dustMask > 0.5) dm *= mix(1.0, 0.3, smoothstep(6000.0, 22000.0, d));
  // крупные на экране газовые/пылевые спрайты плавно исчезают: вблизи нет «мыла» и чёрных клякс
  if (u_bigFade > 0.5) dm *= 1.0 - smoothstep(u_maxPx * 0.3, u_maxPx * 0.85, pix);
  float k = energy * fade * dm;
  vec4 vp = u_view * vec4(rel, 1.0);
  v_uv = a_corner;
  vec3 base = u_art > 0.5 ? artGrade(i_col.rgb) : i_col.rgb;
  v_col = base * k * u_bright;
  v_s = s;
  v_seed = fract(dot(i_pos, vec3(0.00731, 0.01173, 0.02317)));
  if (k < 1e-4 || vp.z > 0.0){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vp.xy += a_corner * (s / u_pxPerRad) * (-vp.z);
  gl_Position = u_proj * vp;
}`;
  // светящиеся частицы: чёткое яркое ядро (~1 px) + тонкий ореол
  G.particleFS = G.header + `
in vec2 v_uv;
in vec3 v_col;
in float v_s;
in float v_seed;
out vec4 o;
void main(){
  float r2 = dot(v_uv, v_uv);
  if (r2 > 1.0) discard;
  float rpx2 = r2 * v_s * v_s;
  float core = exp(-rpx2 / 1.1);
  float halo = (exp(-r2 * 9.0) - 0.0001) * 0.28;
  o = vec4(v_col * max(core * 1.6 + halo, 0.0), 0.0);
}`;
  // объёмный диффузный газ рукавов: мягкое свечение без ядра — связывает звёзды в единый вихрь
  G.gasFS = G.header + `
in vec2 v_uv;
in vec3 v_col;
in float v_s;
in float v_seed;
out vec4 o;
void main(){
  float r2 = dot(v_uv, v_uv);
  if (r2 > 1.0) discard;
  o = vec4(v_col * max(exp(-r2 * 2.6) - 0.074, 0.0), 0.0);
}`;
  // пыль: поглощение с прожилками (детерминированный шум по позиции частицы)
  G.dustFS = G.header + `
in vec2 v_uv;
in vec3 v_col;
in float v_s;
in float v_seed;
out vec4 o;
float vh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(vh(i), vh(i + vec2(1, 0)), f.x), mix(vh(i + vec2(0, 1)), vh(i + vec2(1, 1)), f.x), f.y); }
void main(){
  float r2 = dot(v_uv, v_uv);
  if (r2 > 1.0) discard;
  // вытянутое волокно: случайный поворот, анизотропное сжатие и деформация координат шумом (domain warping)
  float ang = v_seed * 6.2831853;
  vec2 rv = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * v_uv;
  vec2 q = vec2(rv.x * 0.55, rv.y * 2.2);
  vec2 sd = vec2(v_seed * 37.0, v_seed * 91.0);
  q += 0.45 * (vec2(vn(q * 2.0 + sd), vn(q * 2.0 + sd + 7.3)) - 0.5);
  q += 0.18 * (vec2(vn(q * 5.0 + sd + 3.1), vn(q * 5.0 + sd + 11.7)) - 0.5);
  float shape = exp(-dot(q, q) * 2.6) - 0.06;
  float n = vn(q * 3.0 + sd) * 0.55 + vn(q * 7.0 + sd + 5.1) * 0.3 + vn(q * 15.0 + sd + 9.7) * 0.15;
  float ridge = 1.0 - abs(n * 2.0 - 1.0);
  float fil = smoothstep(0.45, 0.95, ridge);
  float g = max(shape, 0.0) * mix(0.35, 1.4, fil) * smoothstep(1.0, 0.7, r2);
  o = vec4(v_col * max(g, 0.0), 0.0);
}`;

  // ---------- Звёзды (по абсолютной величине и расстоянию) ----------
  G.starVS = G.header + `
layout(location=0) in vec2 a_corner;
layout(location=1) in vec3 i_pos;
layout(location=2) in vec4 i_prop;   // rgb цвет, w = абсолютная звёздная величина
uniform mat4 u_view, u_proj;
uniform vec3 u_origin;
uniform float u_pxPerRad, u_magLimit, u_scale, u_fadeR, u_bright, u_innerR;
uniform int u_hide;
out vec2 v_uv;
out vec3 v_col;
out float v_spike;
out float v_core;
void main(){
  vec3 rel = i_pos + u_origin;
  float d = max(length(rel), 1e-12);
  float m = i_prop.w + 5.0 * log(d / 32.6156) / log(10.0);
  float v = min(u_magLimit - m, 22.0);
  float fade = u_fadeR > 0.0 ? 1.0 - smoothstep(0.75 * u_fadeR, u_fadeR, d) : 1.0;
  if (u_innerR > 0.0) fade *= smoothstep(u_innerR * 0.5, u_innerR, length(i_pos));
  vec4 vp = u_view * vec4(rel, 1.0);
  if (v <= 0.0 || fade <= 0.0 || gl_InstanceID == u_hide || vp.z > 0.0){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float vv = min(v, 14.0);
  float core = (1.0 + 0.32 * vv) * u_scale;
  float I = 0.22 * pow(1.3, vv) * smoothstep(0.0, 1.5, v) * fade * u_bright;
  float rad = core * 4.0;
  v_uv = a_corner * 4.0;
  v_col = i_prop.rgb * I;
  v_core = core;
  v_spike = smoothstep(8.5, 13.0, vv);
  vp.xy += a_corner * (rad / u_pxPerRad) * (-vp.z);
  gl_Position = u_proj * vp;
}`;
  G.starFSprite = G.header + `
in vec2 v_uv;
in vec3 v_col;
in float v_spike;
in float v_core;
out vec4 o;
void main(){
  float r2 = dot(v_uv, v_uv);
  if (r2 > 16.0) discard;
  // жёсткое ядро ~1–2 px (яркость звезды сохраняется, свечение даёт bloom) + тонкий ореол
  float rpx2 = r2 * v_core * v_core;
  float boost = max(v_core * v_core / (1.4 * 1.2), 1.0);
  float g = exp(-rpx2 / 1.2) * boost + 0.03 * exp(-r2 * 0.6) + 0.012 * exp(-r2 * 0.15);
  float sp = v_spike * (exp(-abs(v_uv.x) * 6.0) * exp(-v_uv.y * v_uv.y * 0.2) + exp(-abs(v_uv.y) * 6.0) * exp(-v_uv.x * v_uv.x * 0.2)) * 0.25;
  float edge = 1.0 - smoothstep(9.0, 16.0, r2);
  vec3 c = v_col * (g + sp) * edge;
  vec3 white = vec3(dot(v_col, vec3(0.33)));
  c += (white - v_col * 0.5) * max(exp(-r2 * 6.0) * 0.6, 0.0) * step(1.0, dot(v_col, vec3(0.33)));
  o = vec4(max(c, 0.0), 0.0);
}`;

  // ---------- Линии ----------
  G.lineVS = G.header + `
layout(location=0) in vec3 a_pos;
layout(location=1) in vec4 a_col;
uniform mat4 u_view, u_proj;
out vec4 v_col;
void main(){
  v_col = a_col;
  gl_Position = u_proj * u_view * vec4(a_pos, 1.0);
}`;
  G.lineFS = G.header + `
in vec4 v_col;
out vec4 o;
void main(){ o = vec4(v_col.rgb * v_col.a, v_col.a); }`;
})();
