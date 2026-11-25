'use strict';
/* =====================================================================
 *  Режим «На поверхности»: шейдеры ландшафта, неба и событий.
 *
 *  Ландшафт — радиальная сетка вокруг камеры (у ног шаг 0,25 м, дальше кольца плавно растут к горизонту);
 *  высоту вершина берёт билинейно из узлов решётки, неподвижной относительно планеты (карта грани куба),
 *  с геоморфингом между уровнями 2^l и 2^(l+1) — рельеф не «плывёт» и не идёт волнами при ходьбе. Всё считается в системе координат тела в метрах ОТНОСИТЕЛЬНО камеры —
 *  точность float32 не теряется даже у планеты радиусом 6 000 км.
 *  Высота = крупный рельеф по направлению n (материки, хребты, холмы, кратеры; шум симплекс)
 *         + мелкий рельеф в локальных метровых координатах (периодический шум с хэшем по решётке:
 *           период 4096 м, поэтому координаты остаются маленькими, а узор — непрерывным при ходьбе).
 *  Каждая октава включается, только если её длина волны больше шага сетки (без «дрожания» рельефа);
 *  ещё более мелкие детали (камни, песок, рябь, трещины льда) — нормалями во фрагментном шейдере.
 *  Порядок отрисовки — от дальних колец к ближним (алгоритм художника): для рельефа-«высотного поля»,
 *  видимого сверху, он точен, и буфер глубины не нужен.
 *
 *  Небо — однократное рассеяние (Рэлей + Ми + озон) в сферической атмосфере с параметрами конкретной
 *  планеты: на Марсе пыль сильнее рассеивает синий вперёд (голубой закат вокруг Солнца) и поглощает его
 *  в остальном небе (охристый день), на Титане — толстая оранжевая дымка толинов. Небо считается в
 *  уменьшенном разрешении и хранит две карты: добавочный свет (inscatter) и пропускание.
 * ===================================================================== */
(function () {
  const MW = window.MW;
  const G = MW.GLSL;

  // ---------- общие функции рельефа (вершинный шейдер, запрос высоты) ----------
  G.surfCommon = `
uniform float u_R;          // радиус тела, м
uniform float u_relief;     // амплитуда крупного рельефа, м
uniform float u_hill;       // амплитуда холмов, м
uniform vec4 u_terr;        // x кратеры, y дюны, z валуны, w доля «гор»
uniform vec4 u_terr2;       // x уровень моря (1 = есть океан/озёра), y лавовое озеро (cos радиуса), z «хребты льда», w Земля-маска
uniform int u_style;
uniform vec3 u_SP;          // сид тела
uniform vec3 u_sunB;        // направление на звезду (система тела)
uniform vec3 u_windB;       // направление ветра/дюн (касательное)
uniform sampler2D u_aux;    // служебная карта (у Земли g — океаны)
uniform float u_auxK;

// ---- хэш решётки и периодический value-шум с аналитическими производными ----
uint hu3(uvec3 v){
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v.x ^ v.y ^ v.z;
}
float hl(vec3 c, float per){
  vec3 m = per > 0.0 ? mod(c, per) : c + 32768.0;
  return float(hu3(uvec3(ivec3(m))) & 0xffffffu) / 16777215.0;
}
const float PM = 65536.0;   // период локальных координат шума, м
// x — значение (−1..1), yzw — градиент по x
vec4 vnoiseD(vec3 x, float per){
  vec3 i = floor(x), f = x - i;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = hl(i, per), b = hl(i + vec3(1, 0, 0), per), c = hl(i + vec3(0, 1, 0), per), d = hl(i + vec3(1, 1, 0), per);
  float e = hl(i + vec3(0, 0, 1), per), f1 = hl(i + vec3(1, 0, 1), per), g = hl(i + vec3(0, 1, 1), per), h = hl(i + vec3(1, 1, 1), per);
  float k1 = b - a, k2 = c - a, k3 = e - a, k4 = a - b - c + d, k5 = a - c - e + g, k6 = a - b - e + f1, k7 = -a + b + c - d + e - f1 - g + h;
  float v = a + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z;
  vec3 gr = du * vec3(k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z, k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x, k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y);
  return vec4(v * 2.0 - 1.0, gr * 2.0);
}
// периодический шум с длиной волны lam (м, степень двойки)
vec4 pn(vec3 loc, float lam){ return vnoiseD(loc / lam, PM / lam); }
// ближайшая точка ячеистого шума: x — расстояние (в долях ячейки), y — хэш ячейки, z — радиус объекта
vec3 cellNear(vec3 x, float per, float prob){
  vec3 i = floor(x), f = x - i;
  float best = 9.0, id = 0.0, rad = 0.0;
  for (int z = -1; z <= 1 + u_zero; z++) for (int y = -1; y <= 1; y++) for (int xx = -1; xx <= 1; xx++){
    vec3 g = vec3(float(xx), float(y), float(z));
    vec3 c = i + g;
    float h0 = hl(c, per);
    if (h0 > prob) continue;
    vec3 o = vec3(hl(c + 17.0, per), hl(c + 41.0, per), hl(c + 73.0, per));
    vec3 r = g + 0.15 + 0.7 * o - f;
    float rr = 0.12 + 0.3 * fract(h0 * 7.13 + o.x);
    float d = length(r) / rr;
    if (d < best){ best = d; id = h0; rad = rr; }
  }
  return vec3(best, id, rad);
}
// профиль кратера: d — расстояние в радиусах кратера (чаша + вал + выброс), в долях глубины; к d = 2,4 плавно → 0
float craterP(float d){
  if (d > 2.4) return 0.0;
  float bowl = d < 1.0 ? (d * d - 1.0) : 0.0;
  float rim = exp(-pow((d - 1.0) / 0.22, 2.0)) * 0.28;
  float ej = d > 1.0 ? 0.1 * exp(-(d - 1.0) * 2.2) * smoothstep(2.4, 1.5, d) : 0.0;
  return bowl + rim + ej;
}
// Поле кратеров: СУММА профилей всех соседних кратеров (× их радиус, в долях ячейки). Раньше брался только
// ближайший — на границах ячеек высота скачком менялась на десятки метров («ступени» на горизонте).
float craterSum(vec3 x, float per, float prob){
  vec3 i = floor(x), f = x - i;
  float h = 0.0;
  for (int z = -1; z <= 1 + u_zero; z++) for (int y = -1; y <= 1; y++) for (int xx = -1; xx <= 1; xx++){
    vec3 g = vec3(float(xx), float(y), float(z));
    vec3 c = i + g;
    float h0 = hl(c, per);
    if (h0 > prob) continue;
    vec3 o = vec3(hl(c + 17.0, per), hl(c + 41.0, per), hl(c + 73.0, per));
    float rr = 0.12 + 0.3 * fract(h0 * 7.13 + o.x);
    float d = length(g + 0.15 + 0.7 * o - f) / rr;
    h += craterP(d) * rr;
  }
  return h;
}

// ---- крупный рельеф по направлению n (м); dx — шаг сетки, м (октавы мельче шага не добавляются) ----
float landMask(vec3 n){
  if (u_terr2.w > 0.5){
    float m = 1.0 - smoothstep(0.35, 0.65, textureLod(u_aux, vec2(atan(n.y, n.x) / 6.2831853 + 0.5, 0.5 - asin(clamp(n.z, -1.0, 1.0)) / 3.14159265), 0.0).g);
    return m;
  }
  return 1.0;
}
float macroH(vec3 n, float dx){
  vec3 p = n + u_SP * 0.37;
  float R = u_R;
  // материки / низины
  float h = 0.55 * fbm(p * 1.4, 4);
  // горные системы: ridged-шум с искажением координат, маска гор
  vec3 w = vec3(fbm(p * 2.1 + 3.1, 3), fbm(p * 2.1 + 7.7, 3), fbm(p * 2.1 + 1.3, 3));
  float mMask = smoothstep(0.05, 0.45, fbm(p * 1.8 + 11.0, 3)) * u_terr.w;     // горы — отдельными массивами, между ними равнины
  float a = 0.5, rd = 0.0, prev = 1.0;
  vec3 q = p * (R / 90000.0) + w * 0.6;
  for (int i = 0; i < 9 + u_zero; i++){
    float lam = 90000.0 * pow(0.4925, float(i));
    float wk = smoothstep(dx * 2.0, dx * 4.0, lam);
    if (wk <= 0.0) break;
    float s = 1.0 - abs(snoise(q)); s *= s;
    rd += a * s * prev * wk; prev = mix(1.0, s, 0.7);
    q = q * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5;
  }
  h += mMask * (rd * 1.6 - 0.45);
  h *= u_relief;
  // холмы и плато: fBm с длиной волны 12 км → 1,5 км
  float hh = 0.0; a = 1.0;
  vec3 r = p * (R / 12000.0) + 5.0;
  for (int i = 0; i < 4 + u_zero; i++){
    float lam = 12000.0 * pow(0.4925, float(i));
    float wk = smoothstep(dx * 2.0, dx * 4.0, lam);
    if (wk <= 0.0) break;
    hh += a * snoise(r) * wk;
    r = r * 2.03 + vec3(4.1, 1.3, 7.9); a *= 0.55;
  }
  h += hh * u_hill;
  // крупные кратеры (поперечник 60 → 4 км): чаша, вал, выбросы
  if (u_terr.x > 0.0){
    float cs = 80000.0;
    for (int i = 0; i < 3 + u_zero; i++){
      // плавно, а не обрывом, и только когда кратер покрыт несколькими вершинами: радиальный шаг сетки в ~4 раза
      // крупнее окружного — иначе одиночные вершины давали тонкие «пунктирные» дуги вдоль колец
      float wk = smoothstep(dx * 6.0, dx * 12.0, cs);
      if (wk <= 0.0) break;
      h += craterSum(n * (R / cs) + u_SP * 3.0 + float(i) * 17.0, 0.0, 0.55 * u_terr.x) * cs * 0.22 * u_terr.x * wk;
      cs *= 0.25;
    }
  }
  // земля: суша/океан по карте (береговая линия искажена шумом)
  if (u_terr2.w > 0.5){
    float lm = landMask(normalize(n + 0.004 * vec3(fbm(p * 40.0, 3), fbm(p * 40.0 + 3.0, 3), fbm(p * 40.0 + 6.0, 3))));
    h = mix(-1800.0 - abs(h) * 0.3, max(h, 0.0) * 0.6 + 30.0, smoothstep(0.3, 0.7, lm));
  }
  // лавовое озеро под звездой: ровная поверхность расплава
  if (u_terr2.y > 0.0){
    float sub = dot(n, u_sunB) + 0.03 * fbm(p * 30.0, 3);
    float lake = smoothstep(u_terr2.y - 0.01, u_terr2.y + 0.01, sub);
    h = mix(h, -60.0, lake);
  }
  return h;
}

// ---- мелкий рельеф в локальных метровых координатах (периодический шум, период 4096 м) ----
float localH(vec3 loc, float dx){
  float h = 0.0;
  // бугры и неровности: 512 м → 2 м (амплитуда ~ длине волны, как у естественных поверхностей)
  float lam = 512.0, amp = u_hill * 0.06;
  for (int i = 0; i < 9 + u_zero; i++){
    float wk = smoothstep(dx * 2.0, dx * 4.0, lam);
    if (wk <= 0.0) break;
    h += pn(loc, lam).x * amp * wk;
    lam *= 0.5; amp *= 0.5;
  }
  // малые кратеры (поперечник ~300 м и ~40 м)
  if (u_terr.x > 0.0){
    float cs = 512.0;
    for (int i = 0; i < 2 + u_zero; i++){
      float wk = smoothstep(dx * 6.0, dx * 12.0, cs);
      if (wk <= 0.0) break;
      h += craterSum(loc / cs + float(i) * 5.0, PM / cs, 0.5 * u_terr.x) * cs * 0.2 * u_terr.x * wk;
      cs *= 0.125;
    }
  }
  // дюны: поперечные гряды вдоль ветра, гребни слегка извилистые
  if (u_terr.y > 0.0 && dx < 10.0){
    float ph = dot(loc, u_windB) / 46.0 + 0.6 * pn(loc, 256.0).x + 0.25 * pn(loc, 64.0).x;
    float dune = pow(1.0 - abs(sin(ph * 3.14159)), 1.6);
    float field = smoothstep(-0.2, 0.4, pn(loc + 3000.0, 1024.0).x);
    h += dune * 4.0 * u_terr.y * field * (1.0 - smoothstep(5.0, 10.0, dx));   // ≥ 9 узлов на волну дюны
  }
  // ледяные миры: двойные хребты (Европа) — два параллельных вала с ложбиной посередине, сотни метров в поперечнике
  if ((u_style == 3 || u_style == 9) && u_terr2.z > 0.0){
    float rr = 1.0 - abs(pn(loc + vec3(0.0, 0.0, 700.0), 2048.0).x + 0.35 * pn(loc, 512.0).x);
    float wk = smoothstep(dx * 2.0, dx * 6.0, 120.0);
    h += (smoothstep(0.93, 0.985, rr) - 0.7 * smoothstep(0.985, 0.998, rr)) * 120.0 * u_terr2.z * wk;
  }
  // валуны (поперечник ~1–2 м)
  // (решётка у ног — 0,5 м, фильтр октав 0,75 м: валуны берутся в рельеф и у сетки, и у запроса высоты)
  if (u_terr.z > 0.0 && dx < 1.2){
    // валун: гладкий неправильный купол (без резкого края — иначе он читается как кратер)
    vec3 c = cellNear(loc / 4.0, PM / 4.0, 0.35 * u_terr.z);
    float bd = c.x * (1.0 + 0.25 * pn(loc, 1.0).x);
    if (bd < 1.0) h += pow(1.0 - bd * bd, 1.6) * c.z * 4.0 * 0.6 * (1.0 - smoothstep(0.6, 1.2, dx));
  }
  return h;
}
// полная высота; океан и озёра — ровная поверхность (u_terr2.x: 1 — море на уровне 0, 2 — озёра Титана)
float seaLevel(){ return u_terr2.x > 1.5 ? -150.0 : 0.0; }
float Hfull(vec3 n, vec3 loc, float dx){
  float h = macroH(n, dx) + localH(loc, dx);
  if (u_terr2.x > 0.5) h = max(h, seaLevel());
  return h;
}
`;

  // ---------- вершинный шейдер ландшафта ----------
  G.terrainVS = G.header + G.noise + G.surfCommon + `
layout(location=0) in vec2 a_grid;      // x — номер кольца, y — номер луча
uniform float u_NR, u_NA, u_s1, u_c;    // кольца: s(j) = s1·(e^(c·j) − 1)/c — у ног шаг s1, дальше плавный рост
uniform vec3 u_n0, u_E, u_Nn;           // базис в точке под камерой (система тела)
uniform float u_camAlt;                 // высота камеры над уровнем R, м
uniform vec3 u_pmod;                    // точка под камерой в локальных координатах шума (м, по модулю PM)
uniform vec4 u_faceC[6];                // камера в карте каждой грани куба, м: xy — по модулю 4096, zw — по модулю 2^24
uniform mat3 u_b2v;                     // система тела → система камеры (вид)
uniform mat4 u_proj;
uniform int u_shSteps;
uniform float u_pen;                    // полутень: угловой радиус звезды
out vec3 v_p;       // позиция относительно камеры (система тела), м
out vec3 v_n;       // направление от центра тела
out vec3 v_N;       // нормаль (крупный + средний рельеф)
out vec3 v_loc;
out float v_h, v_sh, v_dx, v_s;
/* Грани куба (0..5 = +x, −x, +y, −y, +z, −z): перестановка осей, после которой грань — «+z».
   Карта грани — гномоническая проекция: точка (u, v) = R·(x/z, y/z). Решётка рельефа задана в этой карте,
   т. е. неподвижна относительно планеты (одна и та же для любого положения камеры). */
vec3 toF(vec3 v, int f){
  if (f == 0) return vec3(v.y, v.z, v.x);
  if (f == 1) return vec3(-v.y, v.z, -v.x);
  if (f == 2) return vec3(v.z, v.x, v.y);
  if (f == 3) return vec3(-v.z, v.x, -v.y);
  if (f == 4) return v;
  return vec3(-v.x, v.y, -v.z);
}
vec3 fromF(vec3 w, int f){
  if (f == 0) return vec3(w.z, w.x, w.y);
  if (f == 1) return vec3(-w.z, -w.x, w.y);
  if (f == 2) return vec3(w.y, w.z, w.x);
  if (f == 3) return vec3(w.y, -w.z, -w.x);
  if (f == 4) return w;
  return vec3(-w.x, w.y, -w.z);
}
void main(){
  float j = a_grid.x;
  // Сетка у ног сверхплотная (шаг s1 ≈ 0,25 м → решётка 0,5 м) и плавно, без скачков, расширяется к горизонту
  float s = u_s1 * (exp(u_c * j) - 1.0) / u_c;
  float th = a_grid.y / u_NA * 6.2831853;
  vec3 dir = cos(th) * u_E + sin(th) * u_Nn;
  float ang = s / u_R;
  float s2 = sin(ang * 0.5);
  vec3 dn = -2.0 * s2 * s2 * u_n0 + sin(ang) * dir;     // n − n0 без потери точности у ног
  vec3 n = normalize(u_n0 + dn);
  vec3 loc = u_pmod + u_R * dn;
  // шаг сетки (м): по радиусу и по окружности
  float dxm = max(u_s1 + u_c * s, s * 6.2831853 / u_NA);
  /* ---- высота: решётка, неподвижная относительно планеты, + геоморфинг уровней ----
     Раньше вершина «прыгала» в ближайший узел решётки — при ходьбе узлы перескакивали, и рельеф шёл волнами.
     Теперь вершина скользит вместе с камерой, а высоту берёт билинейно из 4 узлов решётки уровня l
     (шаг 2^l м в карте грани): эта поверхность — функция только точки планеты (нормали normalize(n0 + dn)),
     поэтому земля стоит монолитно. Уровень детализации непрерывен по расстоянию: на переходе l → l+1
     высота плавно смешивается с решёткой вдвое крупнее (vertex morphing) — без «щелчков» между уровнями. */
  vec3 an = abs(n);
  int f = an.x >= an.y && an.x >= an.z ? (n.x > 0.0 ? 0 : 1) : an.y >= an.z ? (n.y > 0.0 ? 2 : 3) : (n.z > 0.0 ? 4 : 5);
  vec3 cF = toF(u_n0, f), dF = toF(dn, f), vF = cF + dF;
  vec4 FC = u_faceC[f];
  bool rel = cF.z > 0.15;                   // камера видит грань под небольшим углом — считаем относительно неё
  float cosT = vF.z / length(vF);
  float J = cosT * sqrt(cosT);              // масштаб карты: метров поверхности на метр карты (гномоника)
  float Lf = clamp(log2(2.0 * dxm / J), -2.0, 23.0);
  float l0 = floor(Lf);
  float mW = smoothstep(0.55, 1.0, Lf - l0);
  vec2 dU = rel ? u_R * (dF.xy * cF.z - cF.xy * dF.z) / (vF.z * cF.z) : u_R * vF.xy / vF.z;
  vec3 Pc = cF / max(cF.z, 1e-3);
  float L0 = 1.0 / max(cF.z, 1e-3);
  // нормаль и тени — по гладкой полосе рельефа (вдвое крупнее решётки): её скольжение вместе с сеткой незаметно
  float sig = exp2(l0 + mW) * J;
  float ddN = 2.0 * sig;
  vec3 t1 = normalize(dir - n * dot(dir, n));
  if (j < 0.5) t1 = u_E;
  vec3 t2 = cross(n, t1);
  float eM = max(ddN, 40.0), eL = max(ddN, 0.05);   // крупный рельеф — шаг ≥ 40 м (точность float)
  float mu = dot(n, u_sunB);
  int nSh = (u_shSteps > 0 && mu > -0.15) ? u_shSteps : 0;
  float t = max(sig * 2.0, 3.0);
  float tmax = clamp(u_relief * 25.0, 2000.0, 80000.0);
  float kk = pow(tmax / t, 1.0 / float(max(nSh - 1, 1)));
  vec2 c0 = vec2(0.0), d1 = vec2(0.0), d2 = vec2(0.0);
  float h = 0.0, sh = 1.0;
  // Все вызовы функции высоты — в ОДНОМ цикле (8 узлов решётки двух уровней, три точки для нормали, шаги тени
  // к звезде): так тяжёлая функция встраивается компилятором один раз (D3D/ANGLE иначе компилирует минутами).
  for (int i = 0; i < 52 + u_zero; i++){
    if (i >= 11 + nSh) break;
    vec3 nn = n, ll = loc; float dd = ddN, w = 0.0;
    if (i < 8){
      int lv = i / 4, cr = i - lv * 4;
      w = lv == 0 ? 1.0 - mW : mW;
      if (w <= 0.0) continue;
      float q = exp2(l0 + float(lv));
      vec2 cm = q <= 4096.0 ? FC.xy : FC.zw;
      vec2 uv = rel ? (cm + dU) / q : dU / q;
      vec2 i0 = floor(uv), fx = uv - i0;
      vec2 ab = vec2(float(cr & 1), float(cr >> 1));
      vec2 wb = mix(1.0 - fx, fx, ab);
      w *= wb.x * wb.y;
      if (w <= 0.0) continue;
      vec3 dnC;
      if (rel){
        vec3 dl = vec3(((i0 + ab) * q - cm) / u_R, 0.0);
        vec3 P1 = Pc + dl;
        float L1 = length(P1);
        float dL = (2.0 * dot(Pc, dl) + dot(dl, dl)) / (L0 + L1);
        dnC = fromF(dl / L1 - Pc * (dL / (L0 * L1)), f);
      } else {
        dnC = fromF(normalize(vec3((i0 + ab) * q / u_R, 1.0)), f) - u_n0;
      }
      nn = normalize(u_n0 + dnC); ll = u_pmod + u_R * dnC;
      dd = 1.5 * q * J;                       // фильтр октав — по уровню решётки: узел одинаков для всех вершин
    }
    else if (i == 9){ nn = normalize(n + t1 * (eM / u_R)); ll = loc + t1 * eL; }
    else if (i == 10){ nn = normalize(n + t2 * (eM / u_R)); ll = loc + t2 * eL; }
    else if (i >= 11){ nn = normalize(n + u_sunB * (t / u_R)); ll = loc + u_sunB * t; dd = max(max(ddN, t * 0.12), 1.25); }   // валуны тень по вершинам не отбрасывают (иначе «пунктир» вдоль колец)
    vec2 r = vec2(macroH(nn, dd), localH(ll, dd));
    if (i < 8){
      float hq = r.x + r.y;
      if (u_terr2.x > 0.5) hq = max(hq, seaLevel());
      h += w * hq;
    }
    else if (i == 8) c0 = r;
    else if (i == 9) d1 = r - c0;
    else if (i == 10) d2 = r - c0;
    else {
      float hq = r.x + r.y;
      if (u_terr2.x > 0.5) hq = max(hq, seaLevel());
      float alt = h + mu * t + t * t / (2.0 * u_R);
      sh = min(sh, clamp((alt - hq) / (t * u_pen * 2.0 + 0.5) + 0.5, 0.0, 1.0));
      t *= kk;
    }
  }
  vec3 N = normalize(n - t1 * (d1.x / eM + d1.y / eL) - t2 * (d2.x / eM + d2.y / eL));
  if (u_terr2.x > 0.5 && h <= seaLevel() + 0.01) N = n;
  sh *= smoothstep(-0.12, 0.02, dot(N, u_sunB) + 0.05);
  vec3 p = (u_R + h) * dn + (h - u_camAlt) * u_n0;
  v_p = p; v_n = n; v_N = N; v_loc = loc; v_h = h; v_sh = sh; v_dx = 0.75 * ddN; v_s = s;
  gl_Position = u_proj * vec4(u_b2v * p, 1.0);
}`;


  // ---------- фрагментный шейдер ландшафта ----------
  G.terrainFS = G.header + G.noise + G.surfCommon + `
in vec3 v_p, v_n, v_N, v_loc;
in float v_h, v_sh, v_dx, v_s;
uniform sampler2D u_tex, u_albMap;
uniform float u_albK;           // 1 — базовый цвет из карты альбедо орбитального шейдера (цвета совпадают с орбитой)
uniform vec4 u_texP;            // x доля реальной карты, y ширина карты (тексели), z уровень мипа на 1 м пикселя
uniform vec3 u_col1, u_col2, u_col3;
uniform vec3 u_sunC;            // освещённость от звезды у поверхности (с учётом пропускания атмосферы)
uniform vec3 u_amb;             // рассеянный свет неба
uniform vec3 u_upB;             // «вверх» в точке камеры (система тела)
uniform vec3 u_parL; uniform vec3 u_parC;   // отражённый свет планеты-хозяина (Юпитер над Европой)
uniform float u_pixAng;         // угловой размер пикселя
uniform float u_time, u_micro;
uniform vec4 u_ev;              // x иней, y жар (свечение трещин), z глинт океана, w лавовое свечение
uniform float u_camAlt;
uniform sampler2D u_skyIn, u_skyT;
uniform vec2 u_res;
uniform vec4 u_atm;             // x есть атмосфера, y радиус «земли» для неба, z верх атмосферы, w радиус камеры
uniform mat3 u_b2l;             // система тела → локальная (E, N, U)
out vec4 o;
vec2 eqUV(vec3 n){ return vec2(atan(n.y, n.x) / 6.2831853 + 0.5, 0.5 - asin(clamp(n.z, -1.0, 1.0)) / 3.14159265); }
// Микрорельеф нормалями — от масштаба, который уже не передаёт сетка (~4 её шага; с высоты 250 км это километры),
// до 2 пикселей (у ног — сантиметры). Скалы — ridged (острые гребни), лёд и песок — плавный шум; плюс малые кратеры
// с сохранностью u_terr.x. Октав — по пресету (u_microOct), каждая гасится у предела разрешения (без мерцания).
uniform int u_microOct;
float microH(vec3 loc, float pix){
  float h = 0.0;
  float lam = exp2(clamp(ceil(log2(max(v_dx * 6.0, 0.25))), -3.0, 12.0));
  float rough = (u_style == 2 || u_style == 6) ? 0.024 : (u_style == 3 || u_style == 9 || u_style == 5) ? 0.012 : 0.03;
  bool smoothN = u_style == 3 || u_style == 9 || u_style == 5;
  for (int i = 0; i < 18 + u_zero; i++){
    if (i >= u_microOct || lam < pix * 2.0) break;
    // верхняя граница — плавная (без «пунктирных» колец там, где меняется шаг сетки), нижняя — у предела пикселя
    float w = smoothstep(pix * 2.5, pix * 7.0, lam) * (1.0 - smoothstep(v_dx * 3.0, v_dx * 6.0, lam));
    float nz = pn(loc + 7.0, lam).x;
    float v = smoothN ? nz : (1.0 - abs(nz)) * 1.4 - 0.75;
    h += v * lam * rough * w;
    lam *= 0.5;
  }
  // малые кратеры: сотни метров → десятки сантиметров (только у тел, где они сохраняются)
  if (u_terr.x > 0.01){
    float cs = 512.0;
    for (int i = 0; i < 4 + u_zero; i++){
      if (cs < pix * 6.0) break;
      // дополнение к кратерам сетки: что сетка не берёт (вес 1 − smoothstep(6dx, 12dx)), рисуется нормалями
      float wc = (1.0 - smoothstep(v_dx * 6.0, v_dx * 12.0, cs)) * smoothstep(pix * 6.0, pix * 15.0, cs);
      if (wc > 0.0){
        h += craterSum(loc / cs + float(i) * 5.0, PM / cs, 0.5 * u_terr.x) * cs * 0.2 * u_terr.x * wc;   // те же кратеры, что у сетки
      }
      cs *= 0.125;
    }
  }
  // камешки
  if (u_terr.z > 0.0 && pix < 0.05){
    vec3 c = cellNear(loc / 0.5 + 3.0, PM / 0.5, 0.45 * u_terr.z);
    if (c.x < 1.0) h += pow(1.0 - c.x * c.x, 1.6) * c.z * 0.6 * 0.5 * smoothstep(0.05, 0.015, pix);
  }
  // рябь песка
  if (u_terr.y > 0.0 && pix < 0.08){
    float ph = dot(loc, u_windB) / 0.35 + 2.0 * pn(loc, 2.0).x;
    h += 0.012 * u_terr.y * sin(ph * 6.2831853) * smoothstep(0.08, 0.02, pix);
  }
  return h * u_micro;
}
void main(){
  vec3 n = normalize(v_n);
  float dist = length(v_p);
  vec3 rd = v_p / dist;
  float pix = max(dist * u_pixAng, 1e-3);
  // ---- альбедо ----
  vec3 alb = mix(u_col1, u_col2, smoothstep(-0.4, 0.5, fbm(n * 6.0 + u_SP, 4)));
  if (u_texP.x > 0.0){
    float lod = max(0.0, log2(pix * u_texP.y / (6.2831853 * u_R)));
    // карта × усиление (у тёмных ИК-мозаик, как у Титана), но не темнее четверти процедурной палитры
    vec3 tc = max(textureLod(u_tex, eqUV(n), lod).rgb * u_texP.z, alb * 0.25);
    alb = mix(alb, tc, u_texP.x);
  }
  // базовый цвет — ровно тот, что виден с орбиты (палитра, биомы, тон); детали ниже меняют только яркость
  if (u_albK > 0.0){
    vec3 orb = textureLod(u_albMap, eqUV(n), 0.0).rgb;
    float lo = dot(orb, vec3(0.2126, 0.7152, 0.0722)), la = dot(alb, vec3(0.2126, 0.7152, 0.0722));
    // мелкая структура реальной карты сохраняется как яркость поверх орбитального цвета
    alb = orb * (u_texP.x > 0.0 ? clamp(la / max(lo, 1e-3), 0.5, 1.8) : 1.0);
  }
  float dn1 = pn(v_loc, 32.0).x, dn2 = pn(v_loc + 11.0, 4.0).x;
  {
    float texM = u_texP.x > 0.0 ? 6.2831853 * u_R / u_texP.y : 4096.0;
    float la = exp2(clamp(ceil(log2(texM)), 0.0, 14.0)), ad = 0.0, aw = 0.5;
    for (int i = 0; i < 18 + u_zero; i++){
      if (i >= u_microOct || la < pix * 3.0) break;
      ad += pn(v_loc + 31.0, la).x * aw * smoothstep(pix * 3.0, pix * 8.0, la);
      la *= 0.5; aw *= 0.8;
    }
    alb *= clamp(1.0 + 0.32 * ad, 0.45, 1.6);
  }
  vec3 N = normalize(v_N);
  float spec = 0.0, rough = 0.6;
  vec3 emis = vec3(0.0);
  float water = 0.0;
  // ---- стили поверхности ----
  if (u_style == 1){          // Марс: охристая пыль, тёмный базальтовый песок дюн, камни
    float dune = smoothstep(0.3, 0.9, u_terr.y) * smoothstep(-0.1, 0.5, pn(v_loc + 3000.0, 1024.0).x);
    alb = mix(alb, alb * vec3(0.55, 0.5, 0.48), dune * 0.6);
  } else if (u_style == 2 || u_style == 6){   // Земля и землеподобные: океан, растительность; «глазное яблоко» — лёд вне подсолнечного океана
    bool ice = u_terr2.z > 0.0 && dot(n, u_sunB) + 0.02 * fbm(n * 40.0, 3) < u_terr2.z - 1.0;
    if (ice){ alb = vec3(0.74, 0.79, 0.86) * (0.9 + 0.1 * dn1); spec = 0.3; rough = 0.3; }
    else if (v_h < 1.5 && u_terr2.x > 0.0){ water = 1.0; alb = u_style == 2 ? vec3(0.015, 0.04, 0.07) : u_col3 * 0.25; spec = 1.0; rough = 0.08; }
    else if (u_style == 6){
      float snow = smoothstep(2200.0, 3200.0, v_h + 400.0 * fbm(n * 400.0, 2));
      alb = mix(alb, vec3(0.8, 0.82, 0.85), snow);
    }
  } else if (u_style == 3 || u_style == 9){   // лёд: Европа, Плутон, Энцелад, Тритон
    float lin = smoothstep(0.86, 0.97, ridged(n * (u_R / 25000.0) + u_SP, 4));
    float crack = smoothstep(0.9, 0.98, 1.0 - abs(pn(v_loc, 64.0).x)) * smoothstep(20.0, 2.0, pix);
    alb = alb * vec3(1.05, 1.1, 1.18);      // водяной лёд: светлый, с голубизной
    float rr = 1.0 - abs(pn(v_loc + vec3(0.0, 0.0, 700.0), 2048.0).x + 0.35 * pn(v_loc, 512.0).x);
    float ridge = smoothstep(0.9, 0.985, rr) * u_terr2.z;
    alb = mix(alb, alb * vec3(0.72, 0.52, 0.4), max(max(lin * u_terr2.z, crack * 0.6), ridge * 0.7));
    spec = 0.35; rough = 0.25;
  } else if (u_style == 4){   // Ио: сера, тёмные кальдеры, пятна свежей лавы
    float cal = cellNear(n * (u_R / 40000.0) + u_SP, 0.0, 0.4).x;
    alb = mix(alb, vec3(0.08, 0.06, 0.05), smoothstep(1.0, 0.7, cal));
    emis += vec3(1.0, 0.35, 0.08) * smoothstep(0.45, 0.2, cal) * 0.6 * (0.7 + 0.3 * sin(u_time * 0.7 + cal * 20.0));
  } else if (u_style == 5){   // Титан: тёмный углеводородный песок, светлая ледяная галька, метановые озёра
    if (u_terr2.x > 0.0 && v_h < -148.5){ water = 1.0; alb = vec3(0.01, 0.008, 0.005); spec = 1.0; rough = 0.05; }
  } else if (u_style == 7 || u_style == 8){   // раскалённые каменные и лавовые миры
    float sub = dot(n, u_sunB);
    vec3 w1 = vec3(pn(v_loc, 256.0).x, pn(v_loc + 1300.0, 256.0).x, pn(v_loc + 2300.0, 256.0).x);
    vec3 q = v_loc / 128.0 + w1 * 1.3;
    float r1 = 1.0 - abs(vnoiseD(q, PM / 128.0).x); float r2 = 1.0 - abs(vnoiseD(q * 2.0 + 4.0, PM / 64.0).x);
    float rid = r1 * r1 * 0.65 + r2 * r2 * 0.35 * r1;
    float wdt = 0.04 + 0.05 * (pn(v_loc, 512.0).x * 0.5 + 0.5);
    float fis = smoothstep(1.0 - wdt, 1.0 - wdt * 0.3, rid);
    float cool = smoothstep(1.0 - wdt * 3.0, 1.0 - wdt, rid) * (1.0 - fis);
    float heat = u_style == 8 ? max(u_ev.w, 0.6) : u_ev.y * smoothstep(0.0, 0.6, sub);
    alb = mix(vec3(0.035, 0.032, 0.03), vec3(0.1, 0.09, 0.08), smoothstep(-0.5, 0.6, dn1));
    alb = mix(alb, vec3(0.16, 0.05, 0.03), cool * 0.7 * step(0.01, heat));
    float lake = u_terr2.y > 0.0 ? smoothstep(u_terr2.y - 0.012, u_terr2.y + 0.01, sub + 0.03 * fbm(n * 30.0 + u_SP, 3)) : 0.0;
    float flick = 0.85 + 0.15 * sin(u_time * 1.3 + dot(v_loc, vec3(0.05)));
    emis += vec3(1.0, 0.3, 0.05) * fis * 1.4 * heat * flick * smoothstep(40.0, 4.0, pix * 3.0 / max(wdt, 0.02));
    emis += vec3(0.55, 0.09, 0.03) * cool * 0.25 * heat;
    if (lake > 0.0){
      float crust = smoothstep(0.1, 0.45, pn(v_loc + vec3(u_time * 0.3), 16.0).x * 0.5 + pn(v_loc, 4.0).x * 0.25 + 0.2);
      alb = mix(alb, mix(vec3(0.2, 0.05, 0.02), vec3(0.05, 0.03, 0.025), crust), lake);
      emis += vec3(1.0, 0.33, 0.06) * lake * (1.0 - 0.85 * crust) * (0.9 + 0.4 * pn(v_loc + vec3(u_time * 0.4), 8.0).x);
    }
  }
  // ---- нормаль: микрорельеф производными экранного пространства (bump mapping по Миккельсену) ----
  float hm = microH(v_loc, pix);
  if (water > 0.5){
    // рябь: две системы волн, бегущих по ветру
    vec3 wl = v_loc + u_windB * u_time * 1.6;
    hm = 0.04 * pn(wl, 2.0).x + 0.02 * pn(wl + 9.0, 0.5).x;
    hm *= smoothstep(0.4, 0.02, pix) * u_micro;
    N = n;
  }
  vec3 dpx = dFdx(v_p), dpy = dFdy(v_p);
  float dhx = dFdx(hm), dhy = dFdy(hm);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  if (abs(det) > 1e-12){
    vec3 grd = sign(det) * (dhx * r1 + dhy * r2);
    N = normalize(abs(det) * N - grd);
  }
  // ---- освещение ----
  float ndl = max(dot(N, u_sunB), 0.0);
  float sh = v_sh;
  vec3 col = alb * (u_sunC * ndl * sh + u_amb * (0.55 + 0.45 * dot(N, n)) + u_parC * max(dot(N, u_parL), 0.0)) / 3.14159;
  vec3 V = -rd;
  vec3 Hh = normalize(V + u_sunB);
  float nh = max(dot(N, Hh), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  if (spec > 0.0){
    float sp = pow(nh, mix(2000.0, 30.0, rough)) * mix(60.0, 2.0, rough);
    col += u_sunC * sp * sh * spec * fres * (water > 0.5 ? 1.0 : 0.3);
    if (water > 0.5){
      // отражение неба: зенит/горизонт
      vec3 rf = reflect(rd, N);
      col += fres * u_amb * mix(0.6, 1.4, clamp(dot(rf, n), 0.0, 1.0)) * 0.35;
    }
  }
  // иней: блёстки отдельных кристаллов
  if (u_ev.x > 0.0 && pix < 0.2){
    vec3 cc = floor(v_loc / 0.0625);
    float hh = hl(cc, PM / 0.0625);
    vec3 fn = normalize(N + 0.6 * (vec3(hl(cc + 3.0, PM / 0.0625), hl(cc + 7.0, PM / 0.0625), hl(cc + 11.0, PM / 0.0625)) - 0.5));
    float gl = pow(max(dot(fn, Hh), 0.0), 900.0) * step(0.93, hh);
    col += u_sunC * gl * 25.0 * sh * u_ev.x * smoothstep(0.2, 0.03, pix);
  }
  col += emis;
  // ---- воздушная перспектива: та же атмосфера, что и у неба, на отрезке до точки рельефа ----
  if (u_atm.x > 0.5){
    vec2 uv = gl_FragCoord.xy / u_res;
    vec3 In = texture(u_skyIn, uv).rgb, T = texture(u_skyT, uv).rgb;
    vec3 rdl = u_b2l * rd;
    vec3 o0 = vec3(0.0, 0.0, u_atm.w);
    float b = dot(o0, rdl);
    float cg = dot(o0, o0) - u_atm.y * u_atm.y, hg = b * b - cg;
    float L = hg > 0.0 && -b - sqrt(hg) > 0.0 ? -b - sqrt(hg) : -b + sqrt(max(b * b - (dot(o0, o0) - u_atm.z * u_atm.z), 0.0));
    float f = clamp(dist / max(L, 1.0), 0.0, 1.0);
    vec3 Td = pow(max(T, vec3(1e-4)), vec3(f));
    vec3 Id = In * (1.0 - Td) / max(1.0 - T, vec3(1e-3));
    col = col * Td + Id;
  }
  o = vec4(col, 1.0);
}`;

  // ---------- запрос высоты рельефа под камерой (для «приземления» на высоту глаз) ----------
  G.terrQueryFS = G.header + G.noise + G.surfCommon + `
uniform vec3 u_n0, u_pmod, u_sunTan;
out vec4 o;
// пиксель 0 — высота под камерой; 1…7 — профиль рельефа к звезде (30 м … 120 км): закрыта ли она горами
void main(){
  int i = int(gl_FragCoord.x);
  float d = i == 0 ? 0.0 : 30.0 * pow(4.0, float(i - 1));
  float a = d / u_R, s2 = sin(a * 0.5);
  vec3 dn = -2.0 * s2 * s2 * u_n0 + sin(a) * u_sunTan;
  // под камерой — тот же фильтр октав, что у узлов решётки у ног (0,75 м): наблюдатель идёт ровно по видимой земле
  float h = Hfull(normalize(u_n0 + dn), u_pmod + u_R * dn, i == 0 ? 0.75 : max(0.75, d * 0.05));
  o = vec4(h, 0.0, 0.0, 1.0);
}`;

  // ---------- небо: однократное рассеяние в атмосфере планеты (MRT: свет, пропускание) ----------
  G.surfSkyFS = G.header + G.noise + G.ray + `
uniform mat3 u_w2l;          // мир → локальная система (E, N, U)
uniform mat3 u_l2b;          // локальная → система тела
uniform vec3 u_camB;         // позиция камеры в системе тела (м) — для облаков
uniform float u_camR, u_Rg, u_Rt;
uniform vec3 u_bR, u_bMs, u_bMa, u_bO, u_gM;   // коэффициенты (1/м): Рэлей, Ми (рассеяние, поглощение), озон; асимметрия Ми
uniform vec2 u_H;            // шкалы высот Рэлея и Ми, м
uniform vec3 u_sunL, u_sunE; // направление на звезду (локально) и освещённость над атмосферой
uniform float u_sunAng;
uniform int u_steps;
uniform vec4 u_cloud;        // x покрытие, y высота слоя, z толщина, w масштаб ячеек (м)
uniform vec3 u_cloudC;
uniform vec3 u_windL;        // ветер (система тела), м/с
uniform float u_wt;          // модельное время, с
uniform vec4 u_aur;          // x яркость полярного сияния, y смещение по времени
uniform vec4 u_glow;         // свечение ночного неба (airglow): rgb — яркость слоя в зените, w — высота слоя, м (0 — нет)
uniform vec3 u_diff;         // диффузный свет многократного рассеяния очень плотной атмосферы (Венера)
uniform vec4 u_pl[6];        // столбы (гейзеры, пылевые вихри): xy — положение (лок., м), z высота, w ширина
uniform vec4 u_plC[6];       // цвет, w — активность (0 — нет)
layout(location=0) out vec4 oIn;
layout(location=1) out vec4 oT;
vec3 dens(float z){
  return vec3(exp(-z / u_H.x), exp(-z / u_H.y), max(0.0, 1.0 - abs(z - 25000.0) / 15000.0));
}
float phaseR(float mu){ return 0.0596831 * (1.0 + mu * mu); }
vec3 phaseM(float mu){
  vec3 g = u_gM, g2 = g * g;
  return 0.1193662 * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, vec3(1e-4)), vec3(1.5)));
}
// дельта-масштабирование (Joseph et al. 1976): свет, рассеянный пылью почти вперёд, остаётся в пучке —
// поэтому низкое Солнце на Марсе видно, а вокруг него — яркий голубой ореол
vec3 extAt(vec3 d){ return u_bR * d.x + (u_bMs * (1.0 - u_gM * u_gM) + u_bMa) * d.y + u_bO * d.z; }
// оптическая толща к звезде из точки p (лок.)
vec3 sunOD(vec3 p){
  vec2 hs = raySphere(p, u_sunL, vec3(0.0, 0.0, -u_camR), u_Rt);
  float L = max(hs.y, 0.0);
  vec2 hg = raySphere(p, u_sunL, vec3(0.0, 0.0, -u_camR), u_Rg - 50.0);
  if (hg.x > 0.0 && hg.x < hg.y) return vec3(1e4);       // звезда за горизонтом
  vec3 od = vec3(0.0);
  float dt = L / 5.0;
  for (int i = 0; i < 5 + u_zero; i++){
    vec3 q = p + u_sunL * (dt * (float(i) + 0.5));
    float z = length(q + vec3(0.0, 0.0, u_camR)) - u_Rg;
    od += extAt(dens(max(z, 0.0))) * dt;
  }
  return od;
}
void main(){
  vec3 rdW = rayDir();
  vec3 rd = normalize(u_w2l * rdW);
  vec3 C = vec3(0.0, 0.0, -u_camR);
  vec2 ht = raySphere(vec3(0.0), rd, C, u_Rt);
  vec2 hg = raySphere(vec3(0.0), rd, C, u_Rg);
  bool ground = hg.x > 0.0 && hg.x < hg.y;
  float L = ground ? hg.x : max(ht.y, 0.0);
  vec3 In = vec3(0.0), od = vec3(0.0);
  float mu = dot(rd, u_sunL);
  vec3 pR = vec3(phaseR(mu)), pM = phaseM(mu);
  int ns = u_steps;
  float dt = L / float(ns);
  for (int i = 0; i < 32 + u_zero; i++){
    if (i >= ns) break;
    float t = dt * (float(i) + 0.5);
    vec3 p = rd * t;
    float z = max(length(p - C) - u_Rg, 0.0);
    vec3 d = dens(z);
    vec3 e = extAt(d) * dt;
    vec3 Ts = exp(-(od + e * 0.5) - sunOD(p));
    // рэлеевский свет ×2,6: многократное рассеяние в чистом воздухе (яркость голубого неба втрое выше однократной)
    In += exp(-(od + e * 0.5)) * Ts * (u_bR * 2.6 * d.x * pR + u_bMs * d.y * pM) * dt;
    od += e;
  }
  // кратное рассеяние (приближение): доля света, рассеянного много раз, — с альбедо однократного рассеяния
  // и освещённостью сверху; у пыльных и дымных атмосфер (Марс, Титан) именно оно делает небо светлым
  vec3 T = exp(-od);
  float sunUp = smoothstep(-0.12, 0.05, u_sunL.z);
  vec3 alb = (u_bR + u_bMs) / max(u_bR + u_bMs + u_bMa, vec3(1e-12));
  vec3 tauV = (u_bR * u_H.x + (u_bMs * (1.0 - u_gM * u_gM) + u_bMa) * u_H.y);
  vec3 Tsun = exp(-tauV / max(u_sunL.z + 0.15, 0.05));
  float tauDust = dot((u_bMs + u_bMa) * u_H.y, vec3(0.3333));
  In += (1.0 - T) * alb * alb * 0.1 * sunUp * (0.25 + 0.75 * clamp(u_sunL.z * 2.0, 0.0, 1.0)) * (0.3 + 0.7 * Tsun) * clamp(tauDust / 0.4, 0.0, 1.0);
  In *= u_sunE;
  // ---- облака: тонкий слой на высоте u_cloud.y, сносимый ветром ----
  if (u_cloud.x > 0.0){
    float rc = u_Rg + u_cloud.y;
    vec2 hc = raySphere(vec3(0.0), rd, C, rc);
    float tc = u_camR < rc ? hc.y : hc.x;
    if (tc > 0.0 && (!ground || tc < L)){
      vec3 pl = rd * tc;
      vec3 pb = u_camB + u_l2b * pl - u_windL * u_wt;
      float sc = u_cloud.w;
      float f = fbm(pb / sc, 5) * 0.6 + fbm(pb / (sc * 0.23) + 7.0, 3) * 0.25;
      float cov = u_cloud.x;
      // доля неба под облаками ≈ cov: порог по распределению шума (среднее 0,5, σ≈0,12)
      float thr = 0.5 + 0.28 * (0.5 - cov);
      float dc = smoothstep(thr - 0.03, thr + 0.12, f * 0.5 + 0.5);
      float far = 1.0 - smoothstep(25000.0, 140000.0, tc);   // у горизонта облака редеют (без ряби)
      float a = dc * far * 0.92;
      vec3 Ts = exp(-sunOD(pl));
      float cmu = mu;
      float ph = 0.6 + 2.2 * pow(max(cmu, 0.0), 12.0) + 0.2;
      // облако — диффузный отражатель (альбедо ~0,7): освещено звездой и небом, светлее неба в 2–4 раза
      vec3 cl = u_cloudC * u_sunE * Ts * ph * (0.3 + 0.7 * (1.0 - dc * 0.6)) * 0.13 + u_cloudC * u_sunE * 0.025 * sunUp;
      vec3 Tc = exp(-od * clamp(tc / max(L, 1.0), 0.0, 1.0));
      In = In * (1.0 - a * 0.6) + cl * a * Tc;
      T *= 1.0 - a;
    }
  }
  // ---- полярное сияние: светящиеся занавесы на высоте 100–300 км ----
  if (u_aur.x > 0.0 && rd.z > -0.05){
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 10 + u_zero; i++){
      float zz = 100000.0 + 20000.0 * float(i);
      vec2 ha = raySphere(vec3(0.0), rd, C, u_Rg + zz);
      float ta = ha.y;
      if (ta <= 0.0) continue;
      vec3 pl = rd * ta;
      vec3 pb = u_camB + u_l2b * pl;
      float cur = fbm(pb / 260000.0 + vec3(0.0, 0.0, u_aur.y * 0.03), 3);
      float band = exp(-pow((cur + 0.08 * fbm(pb / 40000.0 + u_aur.y * 0.1, 2)) / 0.035, 2.0));
      float ray = 0.6 + 0.4 * fbm(pb / 9000.0 + vec3(u_aur.y * 0.4), 2);
      vec3 c = mix(vec3(0.15, 1.0, 0.35), vec3(1.0, 0.18, 0.25), smoothstep(160000.0, 260000.0, zz));
      acc += c * band * ray * exp(-pow((zz - 130000.0) / 90000.0, 2.0));
    }
    In += acc * u_aur.x * 0.06;
  }
  // ---- свечение ночного неба (airglow): тонкий излучающий слой верхней атмосферы. Луч у горизонта идёт вдоль
  //      слоя дольше (эффект ван Рейна) — над горизонтом мягкая светлая полоса, зенит темнее; поглощение нижней
  //      атмосферы ослабляет её у самого горизонта, но не гасит (рассеянный свет) ----
  if (u_glow.w > 0.0 && !ground){
    float rr = u_Rg / (u_Rg + u_glow.w);
    float vr = min(inversesqrt(max(1.0 - rr * rr * (1.0 - rd.z * rd.z), 1e-4)), 7.0);
    In += u_glow.rgb * vr * (0.3 + 0.7 * T);
  }
  // ---- столбы: гейзеры криовулканов и пылевые вихри ----
  for (int i = 0; i < 6 + u_zero; i++){
    vec4 P = u_pl[i], Pc = u_plC[i];
    if (Pc.w <= 0.0) continue;
    vec3 B = vec3(P.x, P.y, -(P.x * P.x + P.y * P.y) / (2.0 * u_camR) - (u_camR - u_Rg));
    vec3 ax = normalize(B - C);
    // ближайшее сближение луча с осью столба
    vec3 w0 = -B;
    float bb = dot(rd, ax), dd = dot(rd, w0), ee = dot(ax, w0);
    float den = max(1.0 - bb * bb, 1e-5);
    float tr = (bb * ee - dd) / den, za = (ee - bb * dd) / den;
    if (tr <= 0.0 || (ground && tr > L)) continue;
    vec3 q1 = rd * tr, q2 = B + ax * za;
    float dperp = length(q1 - q2);
    float zr = za / P.z;
    if (zr < 0.0 || zr > 1.25) continue;
    float wid = P.w * (0.35 + 1.6 * zr);
    float k = exp(-pow(dperp / wid, 2.0)) * smoothstep(1.25, 0.6, zr) * smoothstep(0.0, 0.05, zr);
    k *= 0.75 + 0.25 * fbm(vec3(dperp / wid * 2.0, za / P.w * 0.7 - u_wt * 0.2, float(i)), 2);
    k *= Pc.w;
    vec3 lit = u_sunE * (0.35 + 1.6 * pow(max(mu, 0.0), 6.0)) * smoothstep(-0.1, 0.05, u_sunL.z + zr * 0.05);
    In = In * (1.0 - k * 0.35) + Pc.rgb * lit * k * 0.3;
    T *= 1.0 - k * 0.45;
  }
  // rgb — пропускание до земли/космоса (для воздушной перспективы рельефа), a — 0 под горизонтом (фон закрыт землёй)
  In += u_diff * (1.0 - T);
  oIn = vec4(In, 1.0);
  oT = vec4(T, ground ? 0.0 : 1.0);
}`;

  // ---------- наложение неба на сцену: фон × пропускание × «дневная засветка» + свет неба ----------
  G.surfCompFS = G.header + `
in vec2 v_uv;
uniform sampler2D u_src, u_skyIn, u_skyT;
uniform float u_veil;
out vec4 o;
void main(){
  vec3 s = texture(u_src, v_uv).rgb;
  vec4 Ta = texture(u_skyT, v_uv);
  vec3 T = Ta.rgb * Ta.a, In = texture(u_skyIn, v_uv).rgb;
  float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
  float veil = mix(u_veil, 1.0, smoothstep(1.5, 12.0, l));     // днём тусклые звёзды тонут в свете неба, звезда — нет
  o = vec4(s * T * veil + In, 1.0);
}`;

  // ---------- марево раскалённого воздуха и пепел (после ландшафта) ----------
  G.surfPostFS = G.header + `
in vec2 v_uv;
uniform sampler2D u_src;
uniform float u_time, u_heat, u_ash, u_aspect;
uniform vec3 u_upV;           // «вверх» в системе камеры
uniform float u_tanHalf;
out vec4 o;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 ndc = v_uv * 2.0 - 1.0;
  vec3 rd = normalize(vec3(ndc.x * u_tanHalf * u_aspect, ndc.y * u_tanHalf, -1.0));
  float el = dot(rd, u_upV);
  vec2 uv = v_uv;
  if (u_heat > 0.0){
    // марево: дрожание у горизонта (горячий воздух над раскалённой поверхностью)
    float band = exp(-pow((el + 0.01) / 0.04, 2.0));
    float w = sin(v_uv.y * 420.0 + u_time * 9.0 + sin(v_uv.x * 37.0 + u_time * 2.3) * 2.0) + 0.6 * sin(v_uv.y * 977.0 - u_time * 13.0);
    uv.x += w * 0.0009 * band * u_heat;
    uv.y += w * 0.0005 * band * u_heat;
  }
  vec3 c = texture(u_src, uv).rgb;
  if (u_ash > 0.0){
    // пепел и тлеющие частицы: три слоя разной глубины падают и сносятся ветром
    for (int L = 0; L < 3; L++){
      float sc = 40.0 + 45.0 * float(L);
      vec2 p = vec2(ndc.x * u_aspect, ndc.y) * sc + vec2(u_time * (0.6 + 0.3 * float(L)), u_time * (1.4 + 0.8 * float(L)));
      vec2 ci = floor(p), f = fract(p) - 0.5;
      float h = h12(ci + float(L) * 17.0);
      if (h > 0.07) continue;
      vec2 off = vec2(h12(ci + 3.1), h12(ci + 7.7)) - 0.5;
      float d = length((f - off * 0.6) * vec2(1.0, 0.55));
      float k = smoothstep(0.09, 0.02, d) * u_ash;
      vec3 ac = h < 0.012 ? vec3(1.6, 0.45, 0.1) : vec3(0.05, 0.045, 0.04);
      c = h < 0.012 ? c + ac * k : mix(c, ac, k * 0.6);
    }
  }
  o = vec4(c, 1.0);
}`;
})();
