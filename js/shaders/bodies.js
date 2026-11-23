'use strict';
/* =====================================================================
 *  Шейдеры тел: звезда (бурлящая плазма, пятна, протуберанцы, корона)
 *  и планета (рельеф fBm, океаны с бликами, облака, атмосфера, кольца).
 *  Отрисовка через трассировку лучей в «импосторе» — идеальная сфера на
 *  любом масштабе без проблем точности.
 * ===================================================================== */
(function () {
  const MW = window.MW;
  const G = MW.GLSL;

  /* Звезда. u_kind — физический тип:
       0 красный/оранжевый карлик (M, K): крупные медленные гранулы, огромные пятна, вспышки
       1 жёлтый карлик (F, G): мелкая грануляция, аккуратные пятна, мягкая корона
       2 горячая звезда (O, B, A): гладкая ослепительная фотосфера, УФ-ореол, потемнение к краю, сплющенность
       3 красный гигант/сверхгигант: гигантские пульсирующие ячейки, «дышащий» край, пылевая оболочка
       4 белый карлик: крошечный сверхгорячий шар с жёстким сиянием
     Рисунок задаёт u_seed (хэш ID звезды) — у каждой звезды он свой. */
  G.starFS = G.header + G.noise + G.ray + `
uniform vec3 u_c;
uniform float u_r, u_rb, u_full;
uniform mat3 u_bodyRot;
uniform float u_temp, u_time, u_seed, u_bright, u_gran, u_activity, u_corona, u_flat;
uniform int u_kind;
uniform vec4 u_rnd;    // четыре случайных числа звезды (хэш её ID и имени): сдвиг/поворот шума, масштаб пятен
out vec4 o;
// случайный поворот координат шума: у каждой звезды свой «срез» трёхмерного поля — без клонов
mat3 seedRot(vec4 r){
  float a = r.y * 6.2831853, b = acos(2.0 * r.z - 1.0), c = r.w * 6.2831853;
  mat3 A = mat3(cos(a), sin(a), 0.0, -sin(a), cos(a), 0.0, 0.0, 0.0, 1.0);
  mat3 B = mat3(1.0, 0.0, 0.0, 0.0, cos(b), sin(b), 0.0, -sin(b), cos(b));
  mat3 C = mat3(cos(c), sin(c), 0.0, -sin(c), cos(c), 0.0, 0.0, 0.0, 1.0);
  return A * B * C;
}
float h11(float x){ return fract(sin(x * 127.1 + u_seed * 311.7) * 43758.5453); }
vec3 hdir(float k){ float z = h11(k) * 2.0 - 1.0, a = h11(k + 7.3) * 6.2831853; float r = sqrt(1.0 - z * z); return vec3(r * cos(a), r * sin(a), z); }
void main(){
  vec3 rdW = rayDir();
  // луч в системе звезды; эллипсоид вращения (сжатие вдоль оси z) сводится к сфере масштабом
  vec3 ro = u_bodyRot * (-u_c), rb = u_bodyRot * rdW;
  vec3 S = vec3(1.0, 1.0, 1.0 / (1.0 - u_flat));
  vec3 roS = ro * S, rdS = normalize(rb * S);
  float tc = dot(-roS, rdS);
  if (tc < 0.0 && length(roS) > u_rb) discard;
  vec3 cp = roS + rdS * tc;
  float b = length(cp);
  vec3 dl = cp / max(b, 1e-30);
  // сдвиг в поле шума на десятки периодов ячеек — разные звёзды берут непересекающиеся участки
  vec3 SP = vec3(u_seed * 17.0, u_seed * 31.0, u_seed * 7.0) + u_rnd.xyz * vec3(97.3, 61.7, 83.1);
  mat3 SR = seedRot(u_rnd);
  float t = u_time;
  // «дышащий» неровный край красного гиганта и радиальная пульсация
  float limbR = 1.0;
  float puls = 1.0;
  if (u_kind == 3){
    // пульсация и неровность края в ~5 раз слабее: звезда — шар, а не бесформенный комок
    puls = 1.0 + 0.011 * sin(t * 0.25 + u_seed * 40.0) + 0.006 * sin(t * 0.61 + u_seed * 13.0);
    limbR = puls * (1.0 + 0.009 * fbm(dl * 2.2 + SP + vec3(0.0, 0.0, t * 0.04), 4));
  }
  float x = b / (u_r * limbR);
  vec3 base = blackbody(u_temp);
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  float aa = max(fwidth(x), 1e-4);
  float cover = 1.0 - smoothstep(1.0 - aa, 1.0 + aa * 0.5, x);
  if (cover > 0.0 && tc > 0.0){
    float xs = min(x, 0.99999);
    float zz = sqrt(1.0 - xs * xs);
    vec3 pS = cp - rdS * zz * u_r * limbR;
    vec3 nP = normalize(pS);                 // физические координаты (широта — для поясов пятен)
    vec3 n = SR * nP;                        // координаты рисунка: повёрнуты своим для каждой звезды углом
    vec3 nN = normalize(pS * S);             // нормаль эллипсоида
    float mu = max(dot(nN, -rb), 0.0);
    float I = 1.0, Tk = u_temp, spotK = 0.0;
    float ld = 1.0 - 0.62 * (1.0 - mu) - 0.18 * (1.0 - mu) * (1.0 - mu);
    vec3 flareC = vec3(0.0);
    if (u_kind == 0){
      // M/K-карлик: крупные медленно кипящие гранулы, огромные тёмные пятна, вспышки
      float tt = t * 0.05;
      vec3 q = n * u_gran;
      vec2 w = worley(q + SP + vec3(0.0, 0.0, tt));
      float cells = smoothstep(0.0, 0.6, w.y - w.x);
      vec2 w2 = worley(q * 2.3 + SP.yzx - vec3(tt * 0.7, 0.0, 0.0));
      float cells2 = smoothstep(0.0, 0.5, w2.y - w2.x);
      float turb = fbm(n * 3.0 + SP + vec3(0.0, tt * 0.3, tt * 0.2), 5);
      float plasma = 0.42 + 0.42 * cells + 0.14 * cells2 + 0.3 * turb;
      // масштаб и число пятен у каждой звезды свои
      float sp = fbm(n * (1.1 + 1.2 * u_rnd.w) + SP * 2.0 + vec3(t * 0.0015), 5) + 0.12 * fbm(n * 6.0 + SP, 3);
      // полутень с волокнистой структурой: мягкий широкий переход, а не пиксельный край
      float fib = fbm(n * 40.0 + SP, 3);
      float pen = smoothstep(0.08, 0.3, sp + 0.04 * fib) * clamp(u_activity, 0.0, 1.0);
      float umb = smoothstep(0.24, 0.46, sp) * clamp(u_activity, 0.0, 1.0);
      float fac = smoothstep(0.02, 0.18, sp) * (1.0 - smoothstep(0.1, 0.28, sp)) * 0.2 * u_activity;   // яркие факелы вокруг пятен
      I = clamp(plasma, 0.3, 1.6) * (1.0 - 0.38 * pen - 0.32 * umb) + fac;
      Tk *= 1.0 - 0.14 * umb - 0.05 * pen;
      spotK = max(umb, pen * 0.45);
      // вспышки: каждые ~20 с в случайной точке — быстрый подъём и экспоненциальный спад
      float ph = t * 0.05 + u_seed * 10.0;
      float k = floor(ph), f = fract(ph);
      float amp = smoothstep(0.0, 0.015, f) * exp(-f * 14.0) * step(0.35, h11(k + 3.1));
      vec3 fd = hdir(k);
      float fl = exp(-pow(length(n - fd) / 0.09, 2.0)) * (0.7 + 0.6 * fbm(n * 30.0 + SP, 3));
      flareC = vec3(0.85, 0.9, 1.0) * fl * amp * 6.0;
    } else if (u_kind == 1){
      // F/G-карлик: мелкая зернистая грануляция, сверхгрануляция, аккуратные пятна в королевских широтах
      float tt = t * 0.12;
      vec3 q = n * u_gran;
      vec2 w = worley(q + vec3(0.0, 0.0, tt));
      float cells = smoothstep(0.0, 0.55, w.y - w.x);
      vec2 w2 = worley(q * 2.7 + vec3(tt * 1.3, 0.0, 0.0));
      float cells2 = smoothstep(0.0, 0.5, w2.y - w2.x);
      vec3 warp = vec3(fbm(n * 2.0 + SP + vec3(tt * 0.1), 3), fbm(n * 2.0 + SP.yzx - vec3(tt * 0.1), 3), 0.0);
      float turb = fbm(n * 3.5 + warp * 0.8 + SP + vec3(0.0, tt * 0.2, tt * 0.1), 6);
      float plasma = 0.6 + 0.26 * cells + 0.14 * cells2 + 0.3 * turb;
      float lat = abs(nP.z);
      float band = smoothstep(0.08, 0.16, lat) * smoothstep(0.55, 0.38, lat);
      float sp = fbm(n * (3.8 + 2.4 * u_rnd.w) + SP * 2.0 + vec3(t * 0.002), 5);
      float pen = smoothstep(0.38, 0.54, sp + 0.03 * fbm(n * 50.0 + SP, 2)) * band * u_activity;
      float umb = smoothstep(0.52, 0.66, sp) * band * u_activity;
      float fac = smoothstep(0.15, 0.6, fbm(n * 9.0 + SP, 4)) * pow(1.0 - mu, 2.0) * 0.5;
      I = clamp(plasma, 0.3, 1.6) * (1.0 - 0.45 * pen - 0.3 * umb) + fac;
      Tk *= 1.0 - 0.18 * umb;
      spotK = max(umb, pen * 0.4) * 0.7;
    } else if (u_kind == 2){
      // горячая звезда: почти гладкая фотосфера, сильное потемнение к краю, гравитационное потемнение экватора
      float tt = t * 0.08;
      float turb = fbm(n * 4.0 + SP + vec3(tt, 0.0, tt * 0.5), 4);
      vec2 w = worley(n * u_gran + SP + vec3(0.0, 0.0, tt));
      I = 0.95 + 0.05 * turb + 0.03 * smoothstep(0.0, 0.5, w.y - w.x);
      ld = 0.18 + 0.82 * pow(mu, 0.85);
      float grav = 1.0 - u_flat * 1.4 * (1.0 - nN.z * nN.z);     // фон Цейпель: полюса горячее и ярче
      I *= grav; Tk *= mix(1.0, grav, 0.5);
    } else if (u_kind == 3){
      // красный гигант: гигантские конвективные ячейки (треть звезды), внутри — многослойная кипящая
      // грануляция и раскалённые волокна плазмы. HDR: ядра ячеек сияют бело-золотым, межъячеечные
      // провалы уходят в глубокий багровый.
      float tt = t * 0.02;
      // течение плазмы: координаты закручиваются и стекают к границам ячеек
      vec3 wv = vec3(fbm(n * 5.0 + SP + vec3(tt * 3.0, 0.0, 0.0), 3), fbm(n * 5.0 + SP.yzx - vec3(0.0, tt * 3.0, 0.0), 3), fbm(n * 5.0 + SP.zxy + vec3(0.0, 0.0, tt * 3.0), 3));
      vec3 wp = n + 0.045 * wv;
      vec2 w = worley(n * u_gran + SP + vec3(0.0, 0.0, tt));
      float big = smoothstep(0.0, 0.85, w.y - w.x);                       // крупные ячейки — мягкая модуляция
      vec2 w2 = worley(wp * u_gran * 4.5 + SP.zxy + vec3(tt * 4.0, 0.0, 0.0));
      float mid = smoothstep(0.0, 0.55, w2.y - w2.x);                     // средние ячейки
      vec2 w3 = worley(wp * u_gran * 16.0 + SP.yzx + vec3(0.0, t * 0.25, 0.0));
      float fine = smoothstep(0.0, 0.45, w3.y - w3.x);                    // мелкая кипящая грануляция
      float fil = pow(ridged(wp * u_gran * 7.0 + SP + vec3(tt * 6.0), 4), 4.0);   // раскалённые волокна
      float boil = fbm(wp * u_gran * 40.0 + SP + vec3(t * 0.2), 3);         // самая мелкая рябь
      float heat = (0.35 + 0.65 * big) * (0.55 + 0.45 * mid) * (0.75 + 0.25 * fine) + 0.4 * fil * big + 0.05 * boil;
      heat = clamp(heat, 0.0, 1.3);
      I = 0.12 + 2.6 * pow(heat, 1.6);                                    // обычная поверхность ~1, ядра до 3 (HDR), провалы ~0.25
      Tk *= 0.68 + 0.6 * heat;                                            // ядра ~1.4×T (бело-золотые), провалы ~0.75×T
      spotK = smoothstep(0.3, 0.1, heat) * 0.85;                          // багровые межъячеечные провалы
      ld = pow(mu, 0.6);
      I *= puls * puls;
    } else {
      // белый карлик: идеально гладкий, ослепительный
      I = 1.0 + 0.03 * fbm(n * 8.0 + SP, 3);
      ld = 0.45 + 0.55 * mu;
    }
    // никаких нулевых/отрицательных значений в pow() и цвете: температура ≥ 1800 K, яркость ≥ 0.15
    I = clamp(I, 0.15, 3.0);
    Tk = max(Tk, 1800.0);
    vec3 tint = pow(max(blackbody(max(Tk * (0.75 + 0.25 * mu) * (0.92 + 0.1 * min(I, 1.5)), 1800.0)), vec3(1e-4)), vec3(u_temp < 8000.0 ? 2.4 : 1.3));
    // пятна — глубокие багрово-красные, а не угольно-чёрные
    tint = mix(tint, vec3(0.62, 0.1, 0.035), clamp(spotK, 0.0, 1.0) * 0.75);
    col = max((tint * I * max(ld, 0.02) + flareC) * u_bright * cover, vec3(0.0));
    if (u_kind == 4) col = mix(col, vec3(0.75, 0.85, 1.0) * u_bright * 1.4 * cover, 0.35);
    alpha = cover;
  }
  // всё, что за краем диска: корона, протуберанцы, УФ-ореол, пылевая оболочка
  if (x > 0.97 && tc > 0.0){
    float hh = max(x - 1.0, 0.0);
    float rmax = u_rb / (u_r * limbR);
    float edge = 1.0 - smoothstep(rmax * 0.55, rmax, x);
    vec3 add = vec3(0.0);
    if (u_kind == 0 || u_kind == 1){
      float streak = fbm(dl * 3.0 + SP + vec3(0.0, 0.0, t * 0.01), 4);
      float streak2 = fbm(dl * 9.0 + vec3(hh * 0.8) + SP, 3);
      float soft = u_kind == 1 ? 1.0 : 0.6;
      float cor = 0.5 * exp(-hh * 6.0) + 0.2 * soft * exp(-hh * 1.6) * (0.55 + 0.9 * max(streak, -0.3) + 0.3 * streak2) + 0.04 * exp(-hh * 0.6);
      add += mix(base, vec3(1.0), 0.35) * cor * 0.9 * u_corona;
      float pr = 0.0;
      if (u_activity > 0.01 && hh < 0.5){
        float sc = u_kind == 0 ? 3.5 : 5.0;
        float f = fbm(dl * sc + vec3(0.0, hh * 5.0, t * 0.02) + SP, 5);
        float hmax = u_kind == 0 ? 0.5 : 0.35;
        float loops = smoothstep(0.3, 0.72, f) * smoothstep(hmax, 0.0, hh);
        float fil = fbm(dl * 22.0 + vec3(hh * 30.0, 0.0, t * 0.05), 3);
        pr = loops * (0.6 + 0.6 * fil) * u_activity * (u_kind == 0 ? 1.4 : 1.0);
        // выброс плазмы над вспышкой у края диска
        if (u_kind == 0){
          float ph = t * 0.05 + u_seed * 10.0;
          float k = floor(ph), ff = fract(ph);
          float amp = smoothstep(0.0, 0.015, ff) * exp(-ff * 8.0) * step(0.35, h11(k + 3.1));
          vec3 fd = transpose(SR) * hdir(k);   // вспышка задана в повёрнутых координатах рисунка
          vec3 fp = fd - dot(fd, rdS) * rdS;
          float side = exp(-pow(length(dl - normalize(fp + vec3(1e-6))) / 0.25, 2.0)) * smoothstep(0.6, 0.0, abs(dot(fd, rdS)));
          pr += side * amp * smoothstep(0.45, 0.0, hh) * (0.7 + 0.8 * fil) * 3.0;
        }
      }
      add += vec3(1.0, 0.3, 0.16) * pr * 0.9;
    } else if (u_kind == 2){
      // мощный голубой ультрафиолетовый ореол и тонкие стримеры звёздного ветра
      float wind = fbm(dl * 6.0 + vec3(0.0, 0.0, hh * 2.0 - t * 0.05) + SP, 3);
      float halo = 0.9 * exp(-hh * 7.0) + 0.45 * exp(-hh * 2.2) * (0.8 + 0.4 * wind) + 0.12 * exp(-hh * 0.7);
      add += mix(base, vec3(0.42, 0.58, 1.0), 0.65) * halo * u_corona * 1.2;
    } else if (u_kind == 3){
      // корона почти не видна — вместо неё хромосфера и сброшенная пылевая оболочка
      float chrom = 0.5 * exp(-hh * 14.0);
      float clump = fbm(dl * 3.0 + vec3(hh * 1.5) + SP + vec3(0.0, 0.0, t * 0.004), 5);
      float clump2 = fbm(dl * 9.0 + vec3(hh * 4.0) + SP * 1.7, 3);
      float shell = exp(-pow((hh - 0.55) / 0.45, 2.0)) * smoothstep(-0.1, 0.5, clump + 0.25 * clump2);
      float plume = smoothstep(0.35, 0.9, fbm(dl * 1.6 + SP.zxy, 4)) * exp(-hh * 1.3);
      add += base * chrom + vec3(0.75, 0.32, 0.12) * shell * 0.16 + vec3(0.9, 0.45, 0.2) * plume * 0.1;
    } else {
      // белый карлик: жёсткое компактное сияние
      float g = 1.6 * exp(-hh * 10.0) + 0.35 * exp(-hh * 2.5);
      add += vec3(0.62, 0.72, 1.0) * g;
    }
    col += add * u_bright * edge * (1.0 - alpha);
  }
  // пыль оболочки гиганта частично закрывает диск
  if (u_kind == 3 && alpha > 0.0){
    float dust = smoothstep(0.15, 0.7, fbm(dl * 3.0 + SP * 1.3 + vec3(0.0, 0.0, t * 0.004), 4));
    col *= 1.0 - 0.1 * dust;
  }
  o = vec4(max(col, vec3(0.0)), alpha);
}`;

  G.planetFS = G.header + G.noise + G.ray + `
uniform vec3 u_c;
uniform float u_r, u_rb, u_full;
uniform mat3 u_bodyRot;
uniform vec3 u_pole, u_sunDir, u_sunCol;
uniform int u_type, u_oct;
uniform float u_seed, u_time, u_bumpK, u_bumpEps, u_ambient, u_cloudRot, u_earthLod, u_micro, u_foot;
uniform vec3 u_col1, u_col2, u_col3;
uniform vec4 u_par;    // x: уровень океана, y: шапки/темп., z: облачность, w: турбулентность
uniform vec4 u_par2;   // x: особенность (1 БКП, 2 тёмное пятно, 3 шестиугольник), y: частота полос
uniform vec4 u_atmo;   // rgb рассеяние, w толщина (доли R)
uniform float u_atmoDens;
uniform vec4 u_ring;   // x внутр., y внешн. (в R), z непрозрачность, w тип
uniform vec3 u_ringCol;
uniform sampler2D u_earth;
uniform vec4 u_exo;    // экзопланеты: x стиль (1 нептун/гигант, 2 горячий юпитер, 3 лавовый мир, 4 каменный), y тепловое свечение, z длина хвоста (R), w ободок
uniform vec3 u_rim;    // цвет атмосферного ободка рассеяния
// реальные карты поверхностей: u_tex — цвет (sRGB→линейный), u_aux — служебная (Земля: R облака, G океаны,
// B ночные огни; Венера — радарная карта поверхности), u_nrm — нормали Земли, u_ringTex — профиль колец Сатурна
uniform sampler2D u_tex, u_aux, u_nrm, u_ringTex;
uniform vec4 u_texP;   // x вес карты (0…1, плавное появление), y уровень мип-карты, z масштаб высоты из яркости, w вес служебной карты
uniform vec4 u_texQ;   // x высота камеры над поверхностью (в R), y вес текстуры колец, z,w радиусы краёв текстуры колец (в R)
uniform float u_nrmK, u_hazeFloor;
uniform vec2 u_detail; // x: насколько карта растянута (0…1, тексель крупнее пикселя), y: частота детального шума
uniform vec4 u_rnd;    // четыре случайных числа тела (хэш ID и имени) — у каждого свой рисунок
out vec4 o;
vec3 SP;
float gLod = 0.0;      // уровень мип-карты в этом пикселе (у лимба — грубее: поверхность видна под углом)
float gRingW = 0.0;    // ширина пикселя в плоскости колец (в R) — для сглаживания узких колец
vec3 gL;               // направление на звезду в системе планеты
float gBand;           // 0..1 — светлая/тёмная полоса (для свечения ночной стороны)

vec2 eqUV(vec3 n){ return vec2(atan(n.y, n.x) / 6.2831853 + 0.5, 0.5 - asin(clamp(n.z, -1.0, 1.0)) / 3.14159265); }
vec3 earthTex(vec3 n){ return textureLod(u_earth, eqUV(n), u_earthLod).rgb; }
vec3 texC(vec3 n){ return textureLod(u_tex, eqUV(n), gLod).rgb; }
vec4 texA(vec3 n){ return textureLod(u_aux, eqUV(n), gLod); }
float earthLand(vec3 n){
#if FAM == 2
  // с реальной картой — точная береговая линия из маски океанов
  if (u_texP.w > 0.0){
    float lm = 1.0 - smoothstep(0.35, 0.65, texA(n).g);
    if (u_texP.w > 0.999) return lm;
    float r0 = earthTex(n).r;
    return mix(smoothstep(0.44, 0.56, r0 + 0.13 * fbm(n * 16.0 + SP, 4)), lm, u_texP.w);
  }
#endif
  float r = earthTex(n).r;
  float nz = 0.13 * fbm(n * 16.0 + SP, 4) + 0.05 * fbm(n * 64.0, 3);
  return smoothstep(0.44, 0.56, r + nz);
}
float craters(vec3 n, float f, float r){
  vec2 w = worley(n * f + SP);
  float d = w.x;
  return 0.5 * exp(-pow((d - r) / (r * 0.3), 2.0)) - 0.9 * smoothstep(r, r * 0.15, d);
}
float H0(vec3 n);
float H0p(vec3 n);
// сеть лавовых рек: ridged-шум с искажением координат
float lavaRiv(vec3 n){
  vec3 w = vec3(fbm(n * 2.5 + SP, 4), fbm(n * 2.5 + SP.yzx + 5.0, 4), fbm(n * 2.5 + SP.zxy + 9.0, 4));
  return ridged(n * 3.5 + w * 0.9 + SP, 5);
}
// микрорельеф: высокочастотные октавы включаются, когда поверхность занимает экран (u_micro → 1)
float H(vec3 n){
  float h = H0(n);
#if FAM < 3
  if (u_micro > 0.001 && u_type != 1 && u_type != 4 && u_type != 5 && u_type != 6 && u_type != 7 && u_type != 11 && u_type != 14 && u_type != 17){
    // амплитуда ~ 1/частота (склоны как у мелких кратеров), октавы мельче пикселя гасятся (без мерцания)
    float w1 = 1.0 - smoothstep(0.2, 0.5, 300.0 * u_foot);
    float w2 = 1.0 - smoothstep(0.2, 0.5, 1200.0 * u_foot);
    float w3 = 1.0 - smoothstep(0.2, 0.5, 4800.0 * u_foot);
    h += u_micro * (0.012 * w1 * craters(n, 300.0, 0.3) + 0.004 * w2 * ridged(n * 1200.0 + SP, 3) + 0.0012 * w3 * fbm(n * 4800.0 + SP, 2));
  }
#endif
  return h;
}
// Высота: реальная карта (яркость → рельеф) + процедурный рельеф. H0p() вызывается ровно в одном месте —
// D3D/ANGLE встраивает функции, и каждый лишний вызов тяжёлого рельефа удлинял компиляцию шейдера.
float H0(vec3 n){
  bool tx = u_texP.x > 0.0 && u_texP.z > 0.0;
  float ht = 0.0, msk = 0.0;
  if (tx){
    ht = u_texP.z * dot(texC(n), vec3(0.3, 0.59, 0.11));
#if FAM < 2
    // неотснятые районы мозаики (маска в u_aux): процедурный рельеф в стиле тела вместо размытого градиента
    if (u_texP.w > 0.0) msk = smoothstep(0.05, 0.6, texA(n).r) * u_texP.w;
#endif
    // детальная карта: когда тексель крупнее пикселя, мелкие неровности дорисовываются шумом (без «мыла»)
    if (u_detail.x > 0.0) ht += u_detail.x * u_texP.z * 0.3 * fbm(n * u_detail.y + SP, 3);
  }
  float hp = 0.0;
  if (!tx || u_texP.x < 0.999 || msk > 0.002) hp = H0p(n);
  if (!tx) return hp;
  ht = mix(ht, u_texP.z * (0.5 + 1.4 * hp), msk);
  return mix(hp, ht, u_texP.x);
}
float H0p(vec3 n){
#if FAM == 0
  if (u_type == 0 || u_type == 8){
    return 0.3 * fbm(n * 3.0 + SP, u_oct) + 0.3 * craters(n, 5.0, 0.33) + 0.18 * craters(n, 13.0, 0.3)
         + 0.1 * craters(n, 34.0, 0.28) + 0.05 * craters(n, 85.0, 0.25);
  }
  if (u_type == 9) return 0.2 * fbm(n * 4.0 + SP, 4);
  if (u_type == 10) return -0.3 * smoothstep(0.88, 1.0, ridged(n * 5.0 + SP, 4));
#elif FAM == 1
  // сеть лавовых русел — один раз на вызов (тяжёлая функция; встраивается в шейдер в одном месте)
  float lrv = (u_type == 15 || (u_exo.x > 4.5 && u_exo.x < 5.5)) ? lavaRiv(n) : 0.0;
  if (u_type == 3){
    return 0.4 * fbm(n * 2.0 + SP, u_oct) + 0.2 * craters(n, 8.0, 0.3) + 0.08 * craters(n, 25.0, 0.28)
         - 0.25 * smoothstep(0.85, 1.0, ridged(n * vec3(3.0, 3.0, 8.0) + SP, 4));
  }
  if (u_type == 15){
    return 0.35 * fbm(n * 3.0 + SP, u_oct) + 0.12 * craters(n, 9.0, 0.3) - 0.2 * smoothstep(0.8, 0.97, lrv);
  }
  if (u_type == 12 || u_type == 13 || u_type == 16){
    // резкость рельефа по массе: 1 — лёгкий мир (горы и кратеры), 0.15 — суперземля (сглажено гравитацией)
    float rk = u_par2.z > 0.0 ? u_par2.z : 0.5;
    float c = fbm(n * 1.7 + SP, 6) + 0.25 * fbm(n * 7.0 + SP * 1.3, u_oct);
    float m = ridged(n * 4.0 + SP * 0.7, u_oct);
    float h = c * (0.75 + 0.25 * rk) + 0.45 * (0.3 + 1.3 * rk) * m * smoothstep(-0.05, 0.2, c - u_par.x);
    float ck = u_type == 12 ? max(rk - 0.6, 0.0) * 2.0 : 0.4 + 1.2 * rk;
    h += ck * (0.25 * craters(n, 7.0, 0.3) + 0.12 * craters(n, 20.0, 0.28) + 0.05 * craters(n, 55.0, 0.25));
    // горячий мир в захвате: просевшие русла застывшей лавы
    if (u_exo.x > 4.5 && u_exo.x < 5.5) h -= 0.15 * smoothstep(0.84, 0.97, lrv);
    // «глазное яблоко»: ледяной панцирь в сотни метров сглаживает рельеф ложа
    if (u_exo.x > 5.5) h *= 0.35;
    // каньоны и рифтовые долины у экзопланет
    if (u_exo.x > 3.5) h -= 0.22 * smoothstep(0.86, 0.99, ridged(n * 2.6 + SP * 1.7, 4)) * smoothstep(-0.1, 0.2, c - u_par.x);
    return h;
  }
#elif FAM == 2
  float land = earthLand(n);
  float m = ridged(n * 6.0 + SP, u_oct);
  return land * (0.15 + 0.6 * m * m * smoothstep(0.1, 0.9, fbm(n * 2.0 + SP * 0.3, 3) * 0.5 + 0.6)) - (1.0 - land) * 0.2;
#endif
  return 0.0;
}
/// высота в точке, две пробы для нормали и (при косом свете) две пробы по направлению на звезду — для теней
// хребтов, кратеров и каньонов у терминатора. Всё в одном цикле: H() встраивается в шейдер один раз
// (HLSL/D3D встраивает все функции; иначе компиляция шейдера занимала десятки секунд).
float gShadow = 1.0;
vec3 heightAndBump(vec3 n, out float h0){
  vec3 t1 = normalize(cross(n, abs(n.z) < 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(n, t1);
  float e = u_bumpEps;
  vec3 Lt = gL - n * dot(gL, n);
  float lt = length(Lt);
  Lt = lt > 1e-4 ? Lt / lt : t1;
  float sinE = dot(n, gL);
  bool shad = u_bumpK > 0.0 && sinE > -0.05 && sinE < 0.5;
  int cnt = u_bumpK > 0.0 ? (shad ? 5 : 3) : 1;
  float hs[5];
  for (int i = 0; i < cnt + u_zero; i++){
    vec3 q = i == 0 ? n : i < 3 ? normalize(n + (i == 1 ? t1 : t2) * e) : normalize(n + Lt * e * (i == 3 ? 5.0 : 16.0));
    hs[i] = H(q);
  }
  h0 = hs[0];
  gShadow = 1.0;
  if (cnt == 1) return n;
  if (cnt == 5){
    float tanE = max(sinE, 0.0) / max(sqrt(1.0 - sinE * sinE), 1e-3);
    for (int k = 3; k < 5; k++){
      float dk = e * (k == 3 ? 5.0 : 16.0);
      float slope = (hs[k] - h0) * u_bumpK * 0.01 / dk;
      gShadow = min(gShadow, smoothstep(-0.18, 0.18, (tanE - slope) / max(tanE, 0.06)));
    }
  }
  vec3 gv = u_bumpK * ((hs[1] - h0) * t1 + (hs[2] - h0) * t2) / e * 0.01;
  float gl = length(gv);
  if (gl > 0.8) gv *= 0.8 / gl;       // мягкое ограничение крутизны — без «чернильных» теней в кратерах
  return normalize(n - gv);
}
vec3 gasBands(vec3 n){
  float tt = u_time * 0.004;
  float turb = u_par.w;
  // зональные течения: шум вытянут вдоль долготы, вихри на границах поясов
  vec3 a = n * vec3(2.5, 2.5, 7.0);
  vec3 w1 = vec3(fbm(a + SP + vec3(tt, 0.0, 0.0), 4), fbm(a + SP + vec3(0.0, tt, 7.0), 4), 0.0);
  vec3 q = n + 0.06 * turb * w1;
  float ed = fbm(n * vec3(6.0, 6.0, 26.0) + SP + w1 * 1.5 + vec3(tt * 2.0, 0.0, 0.0), 6);
  float l2 = q.z + 0.012 * turb * ed;
  float fr = u_par2.y;
  float b = 0.55 * sin(l2 * fr) + 0.3 * sin(l2 * fr * 0.53 + 1.3) + 0.15 * sin(l2 * fr * 2.17 + 0.4);
  float detail = sin(l2 * fr * 4.3 + 2.5 * ed);
  vec3 c = mix(u_col2, u_col1, smoothstep(-0.35, 0.35, b));
  c = mix(c, u_col3, 0.28 * smoothstep(0.2, 1.0, detail));
  c = mix(c, (u_col1 + u_col2) * 0.5, 0.2);
  float eddy = fbm(q * vec3(14.0, 14.0, 40.0) + SP * 1.7, 4);
  c *= 0.88 + 0.14 * ed + 0.1 * eddy;
  // белые овалы и тёмные «баржи»
  vec2 wv = worley(q * vec3(9.0, 9.0, 22.0) + SP);
  c = mix(c, u_col1 * 1.08, smoothstep(0.22, 0.08, wv.x) * 0.45 * turb * step(0.3, abs(sin(l2 * fr * 0.5))));
  float alat = abs(n.z);
  c = mix(c, u_col3 * 0.75 + vec3(0.05, 0.06, 0.08), smoothstep(0.82, 0.97, alat) * 0.7);
  // особенности
  float lon = atan(n.y, n.x), lat = asin(clamp(n.z, -1.0, 1.0));
  if (u_par2.x > 0.5 && u_par2.x < 2.5){
    float lat0 = u_par2.x < 1.5 ? -0.393 : -0.35;
    float sx = u_par2.x < 1.5 ? 0.13 : 0.09, sy = u_par2.x < 1.5 ? 0.065 : 0.05;
    float dl = lon - 0.8;
    float e = length(vec2(dl * cos(lat0) / sx, (lat - lat0) / sy));
    float ang = atan(lat - lat0, dl);
    float swirl = 0.5 + 0.5 * sin(e * 10.0 + ang * 2.0 + fbm(n * 30.0, 2) * 2.0);
    float spot = smoothstep(1.0, 0.55, e);
    vec3 sc = u_par2.x < 1.5 ? mix(vec3(0.72, 0.32, 0.18), vec3(0.85, 0.5, 0.32), swirl) : mix(vec3(0.06, 0.1, 0.32), vec3(0.12, 0.18, 0.45), swirl);
    c = mix(c, sc, spot * 0.9);
    if (u_par2.x > 1.5){ // белые облака-«скутеры» Нептуна
      float wc = smoothstep(0.55, 0.85, fbm(vec3(lon * 3.0, lat * 25.0, 1.0) + SP, 4)) * smoothstep(0.2, 0.0, abs(lat + 0.15));
      c = mix(c, vec3(0.9, 0.95, 1.0), wc * 0.7);
      c = mix(c, vec3(0.92, 0.96, 1.0), smoothstep(1.1, 0.9, e) * smoothstep(0.85, 1.0, e) * 0.6);
    }
  }
  if (u_par2.x > 2.5){ // шестиугольник Сатурна
    float colat = 1.5708 - lat;
    float a6 = mod(lon + 0.5236, 1.0472) - 0.5236;
    float rh = 0.27 / cos(a6);
    float inside = smoothstep(rh + 0.01, rh - 0.01, colat);
    c = mix(c, vec3(0.55, 0.58, 0.6), inside * 0.55);
    c = mix(c, vec3(0.5, 0.45, 0.38), smoothstep(0.015, 0.0, abs(colat - rh)) * 0.5);
  }
  return c;
}
// Поле вихрей на карте (долгота, широта): в каждой ячейке — вихрь со случайным центром, радиусом и знаком.
// Возвращает смещение координат: точка «закручивается» вокруг центров — спирали, антициклоны, фестоны.
vec2 swirlField(vec2 ll, float k, float amp){
  vec2 sc = vec2(k / 6.2831853, k * 0.5 / 3.14159265);
  vec2 g = ll * sc;
  vec2 c = floor(g);
  vec2 off = vec2(0.0);
  for (int j = -1; j <= 1 + u_zero; j++) for (int i = -1; i <= 1; i++){
    vec2 cc = c + vec2(float(i), float(j));
    vec2 wc = vec2(mod(cc.x, k), cc.y);
    vec2 hh = fract(sin(vec2(dot(wc, vec2(127.1, 311.7)), dot(wc, vec2(269.5, 183.3))) + u_seed * 37.0) * 43758.5453);
    vec2 d = g - (cc + 0.2 + 0.6 * hh);
    float r = 0.22 + 0.22 * hh.y;
    float w = exp(-dot(d, d) / (r * r));
    float ang = (hh.x < 0.5 ? -1.0 : 1.0) * amp * w;
    float cs = cos(ang), sn = sin(ang);
    off += vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y) - d;
  }
  return off / sc;
}
// Атмосфера экзо-гиганта/нептуна (уровень снимков «Юноны»): многоуровневое искажение координат,
// сотни вихрей на стыках поясов, фестоны, цепочки белых «жемчужин», крупные антициклоны.
vec3 exoBands(vec3 n){
  float tt = u_time * 0.006;
  float lon = atan(n.y, n.x), lat = asin(clamp(n.z, -1.0, 1.0));
  float fr = u_par2.y;
  // 1) крупномасштабное двухуровневое искажение (domain warping)
  vec3 a = n * vec3(2.6, 2.6, 7.0);
  vec3 q1 = vec3(fbm(a + SP + vec3(tt, 0.0, 0.0), 4), fbm(a + SP.yzx + 5.2 - vec3(tt, 0.0, 0.0), 4), 0.0);
  vec3 q2 = vec3(fbm(a * 1.7 + 2.5 * q1 + SP * 1.3, 4), fbm(a * 1.7 + 2.5 * q1 + SP.zxy + 8.1, 4), 0.0);
  // турбулентность сильнее всего на стыках поясов
  float edgeK = 1.0 - abs(sin(lat * fr));
  // 2) вихри двух масштабов на стыках поясов
  vec2 ll = vec2(lon, lat);
  vec2 sw = swirlField(ll + vec2(tt * 0.3, 0.0), 34.0, 4.5) * (0.35 + 0.65 * edgeK)
          + swirlField(ll + vec2(-tt * 0.5, 0.0) + q2.xy * 0.02, 90.0, 3.5) * (0.2 + 0.8 * edgeK);
  float l = lat + sw.y + 0.03 * u_par.w * q2.x * (0.3 + edgeK);
  float lo = lon + sw.x + 0.25 * q2.y;
  float b = 0.6 * sin(l * fr) + 0.3 * sin(l * fr * 1.9 + 1.7 + u_seed * 6.0) + 0.1 * sin(l * fr * 3.7 + 0.3);
  gBand = smoothstep(-0.2, 0.2, b);
  vec3 c = mix(u_col2, u_col1, gBand);
  // струйные течения и волокна вдоль параллелей
  float jet = pow(1.0 - abs(sin(l * fr * 2.3 + 0.8)), 12.0);
  c = mix(c, u_col3, 0.45 * jet);
  float streak = fbm(vec3(lo * 3.0, l * 80.0, u_seed * 9.0), 4);
  c *= 0.78 + 0.38 * streak;
  // фестоны: тёмные «завитки», свисающие с границы экваториальной зоны
  float fest = exp(-pow((abs(l) - 0.13) / 0.035, 2.0)) * pow(1.0 - abs(sin(lo * 9.0 + 3.0 * q1.x)), 6.0);
  c = mix(c, u_col2 * 0.45, fest * 0.75);
  // белые конвективные штормы, разорванные вихрями
  vec2 wv = worley(vec3(lo * 6.0, l * 18.0, u_seed * 3.0 + tt * 3.0));
  float storm = smoothstep(0.32, 0.05, wv.x) * smoothstep(0.35, 0.9, edgeK) * smoothstep(0.0, 0.4, q2.x + 0.25);
  c = mix(c, vec3(0.97, 0.98, 1.0), clamp(storm, 0.0, 1.0) * 0.8);
  // «нить жемчужин»: цепочка белых овалов на одной широте
  float latP = -0.55 + 0.3 * fract(u_seed * 5.3);
  float pc = lo * 7.0 / 1.0;
  float pd = length(vec2((fract(pc) - 0.5) / 7.0 * 6.2831853 * cos(latP) * 1.8, (l - latP) * 3.0));
  float pearl = smoothstep(0.09, 0.03, pd) * step(0.35, fract(sin(floor(pc) * 12.9898 + u_seed * 78.2) * 43758.5));
  c = mix(c, vec3(0.98), pearl * 0.9);
  c = mix(c, u_col2 * 0.5, smoothstep(0.12, 0.09, pd) * (1.0 - smoothstep(0.09, 0.05, pd)) * step(0.35, fract(sin(floor(pc) * 12.9898 + u_seed * 78.2) * 43758.5)) * 0.5);
  // крупные антициклоны с яркими облаками-спутниками
  for (int i = 0; i < 2 + u_zero; i++){
    float fi = float(i);
    float lat0 = (fract(u_seed * 7.31 + fi * 0.37) - 0.5) * 1.3;
    float lon0 = fract(u_seed * 3.7 + fi * 0.51) * 6.2831853 - 3.14159 + u_time * 0.004 * (1.0 + fi);
    float dlon = mod(lon - lon0 + 3.14159, 6.2831853) - 3.14159;
    vec2 e2 = vec2(dlon * cos(lat0) / (0.17 - fi * 0.05), (lat - lat0) / (0.085 - fi * 0.025));
    float e = length(e2);
    float ang = atan(e2.y, e2.x);
    float swirl = 0.5 + 0.5 * sin(e * 11.0 - ang * 2.0 + 3.0 * q2.x + u_time * 0.05);
    c = mix(c, mix(u_col2 * 0.3, u_col1 * 0.9, swirl * 0.6), smoothstep(1.0, 0.45, e) * 0.9);
    c = mix(c, vec3(0.95, 0.97, 1.0), smoothstep(0.3, 0.0, abs(e - 1.2)) * 0.6 * smoothstep(-0.2, 0.9, sin(ang + 1.2 + q1.x * 2.0)));
  }
  // полярная зона: мелкие циклоны вместо полос (как у полюсов Юпитера)
  float pol = smoothstep(0.62, 0.85, abs(n.z));
  vec2 wp = worley(n * 22.0 + SP);
  c = mix(c, mix(u_col3 * 0.7, u_col2 * 0.6, smoothstep(0.1, 0.5, wp.x)), pol * 0.7);
  // вращение: быстрое — много тонких контрастных поясов; медленное (захват) — гигантские спиральные
  // циклоны и шевронные облачные волны
  float slow = u_par2.z;
  c *= 0.9 + 0.2 * (1.0 - slow) * (0.5 + 0.5 * sin(l * fr * 3.3 + 2.0 * q2.x));
  if (slow > 0.01){
    for (int i = 0; i < 3 + u_zero; i++){
      float fi = float(i);
      float lat0 = (fract(u_rnd.x * 5.13 + fi * 0.31) - 0.5) * 1.4;
      float lon0 = fract(u_rnd.y * 2.9 + fi * 0.43) * 6.2831853 - 3.14159 + u_time * 0.002 * (1.0 + fi);
      float dlon = mod(lon - lon0 + 3.14159, 6.2831853) - 3.14159;
      vec2 e2 = vec2(dlon * cos(lat0), lat - lat0) / (0.42 - fi * 0.09);
      float e = length(e2), ang = atan(e2.y, e2.x);
      float spin = lat0 < 0.0 ? -1.0 : 1.0;
      float arms = 0.5 + 0.5 * sin(ang * 2.0 - log(max(e, 0.02)) * 5.0 * spin + 2.0 * q1.x - u_time * 0.03);
      float cyc = smoothstep(1.0, 0.15, e);
      c = mix(c, mix(u_col2 * 0.55, u_col1 * 1.05, arms), cyc * 0.75 * slow);
      c = mix(c, vec3(0.97), smoothstep(0.1, 0.0, e) * 0.5 * slow);
    }
    float chev = sin(l * fr * 1.3 + 7.0 * abs(fract(lo * 3.0 / 6.2831853) - 0.5) + q1.y * 2.0);
    c = mix(c, u_col3, smoothstep(0.55, 0.95, chev) * 0.3 * slow);
  }
  float lu = dot(c, vec3(0.3, 0.59, 0.11));
  // насыщенные, контрастные цвета (без «серости»)
  c = max(mix(vec3(lu), c, 1.6), 0.0);
  return pow(c, vec3(1.12)) * 1.06;
}
vec3 albedoP(vec3 n, float h, out float spec, out vec3 emis);
vec3 sat3(vec3 c, float k){ float l = dot(c, vec3(0.3, 0.59, 0.11)); return max(vec3(l) + (c - vec3(l)) * k, 0.0); }
// цвет по реальной карте с поправками по типу тела
vec3 texAlbedo(vec3 n, float h, out float spec, out vec3 emis){
  spec = 0.0; emis = vec3(0.0);
  vec3 c = texC(n);
#if FAM == 2
  // Земля: Blue Marble + маска океанов (блик) + ночные огни городов (Black Marble)
  vec4 ax = texA(n);
  float ocean = smoothstep(0.35, 0.65, ax.g) * u_texP.w;
  float seaIce = smoothstep(0.93, 0.97, abs(n.z));
  spec = ocean * (1.0 - seaIce);
  float lights = pow(max(ax.b, 0.0), 2.2) * u_texP.w;
  emis = vec3(1.0, 0.62, 0.3) * lights * 1.6;
  // мелкая неоднородность суши при подлёте в упор (поля, леса, осыпи)
  c *= 1.0 + u_micro * (1.0 - ocean) * 0.18 * fbm(n * 900.0 + SP, 3);
  return sat3(c, 1.12);
#elif FAM == 3
  float lat = asin(clamp(n.z, -1.0, 1.0));
  // детальная карта облаков: тонкие волокна вдоль параллелей, когда тексель крупнее пикселя
  if (u_detail.x > 0.0) c *= 1.0 + u_detail.x * 0.09 * fbm(n * vec3(u_detail.y, u_detail.y, u_detail.y * 4.0) + SP, 3);
  if (u_type == 1){
    // Венера: облака серной кислоты; ниже облачного слоя (~50 км) видна радарная карта поверхности
    c = sat3(c, 1.25);
    float under = (1.0 - smoothstep(0.004, 0.012, u_texQ.x)) * u_texP.w;
    vec3 surf = textureLod(u_aux, eqUV(n), gLod).rgb * vec3(1.0, 0.7, 0.42) * 0.55;
    return mix(c, surf, under);
  }
  if (u_type == 11){
    // Титан: в видимом свете — оранжевая дымка; карта Cassini (ИК) проступает слабо, у поверхности — отчётливо
    float l = dot(c, vec3(0.3, 0.59, 0.11));
    vec3 haze = mix(vec3(0.85, 0.58, 0.24), vec3(0.72, 0.45, 0.16), smoothstep(-0.4, 0.4, sin(lat * 9.0) + 0.5 * fbm(n * 3.0 + SP, 4)));
    float clear = 0.22 + 0.7 * (1.0 - smoothstep(0.01, 0.08, u_texQ.x));
    return mix(haze, vec3(0.95, 0.68, 0.35) * l * 1.3, clear);
  }
  if (u_type == 6){
    // Уран: насыщенный лазурный диск, едва заметные полосы и светлый полярный «капюшон»
    float lu = dot(c, vec3(0.3, 0.59, 0.11));
    c = mix(sat3(c, 1.3), vec3(0.1, 0.56, 1.0) * lu * 2.1, 0.85);
    float bnd = sin(lat * 22.0 + 0.6 * fbm(n * vec3(3.0, 3.0, 12.0) + SP, 3));
    c *= 0.95 + 0.05 * bnd;
    c = mix(c, vec3(0.8, 0.95, 0.97), smoothstep(0.55, 0.95, n.z) * 0.35);
    return c;
  }
  if (u_type == 7) return sat3(c, 1.5) * vec3(0.8, 0.95, 1.12);   // Нептун: глубокий кобальтовый синий
  if (u_type == 4 || u_type == 5) return sat3(c, 1.2);            // Юпитер, Сатурн: кремово-охристые пояса
  return c;
#else
  if (u_type == 9){
    // Ио: тусклые горячие точки активных вулканов на ночной стороне
    vec2 w = worley(n * 7.0 + SP);
    emis = vec3(1.0, 0.35, 0.08) * smoothstep(0.035, 0.0, w.x) * 0.35;
  }
  // неотснятые районы мозаики: процедурная поверхность в палитре снятой стороны (u_col1 — тёмные, u_col2 — светлые тона)
  if (u_texP.w > 0.0){
    float msk = smoothstep(0.05, 0.6, texA(n).r) * u_texP.w;
    if (msk > 0.002){
      float v = fbm(n * 2.2 + SP, 5) * 0.5 + 0.5, v2 = fbm(n * 30.0 + SP * 1.7, 3) * 0.5 + 0.5;
      float k = clamp(0.22 + 0.55 * v + 0.7 * (v2 - 0.5) + 0.35 * (h / max(u_texP.z, 1e-3) - 0.5), 0.0, 1.0);
      vec3 fc = mix(u_col1, u_col2, k);
      // свежие кратеры — яркие пятна льда (как на снятой стороне), трещины — тёмные
      vec2 wv = worley(n * 70.0 + SP * 0.37);
      fc = mix(fc, u_col2 * 1.3, smoothstep(0.16, 0.0, wv.x) * step(0.35, fract(wv.y * 7.31)) * 0.85);
      fc = mix(fc, u_col1 * 0.8, smoothstep(0.92, 0.99, ridged(n * 6.0 + SP, 3)) * 0.35);
      c = mix(c, fc, msk);
    }
  }
  // детальная карта и зернистость реголита при подлёте (поверх реальной карты)
  if (u_detail.x > 0.0) c *= 1.0 + u_detail.x * 0.12 * fbm(n * u_detail.y * 1.7 + SP, 3);
  c *= 1.0 + u_micro * 0.14 * fbm(n * 700.0 + SP, 3);
  return sat3(c, 1.08);
#endif
}
vec3 albedo(vec3 n, float h, out float spec, out vec3 emis){
  spec = 0.0; emis = vec3(0.0);
  vec3 pc = vec3(0.0);
  if (u_texP.x < 0.999) pc = albedoP(n, h, spec, emis);
  if (u_texP.x > 0.0){
    float sp2; vec3 em2;
    vec3 tc = texAlbedo(n, h, sp2, em2);
    pc = mix(pc, tc, u_texP.x); spec = mix(spec, sp2, u_texP.x); emis = mix(emis, em2, u_texP.x);
  }
  return pc;
}
vec3 albedoP(vec3 n, float h, out float spec, out vec3 emis){
  spec = 0.0; emis = vec3(0.0);
  float lat = n.z, alat = abs(n.z);
#if FAM == 1
  float lrv = (u_type == 15 || (u_exo.x > 4.5 && u_exo.x < 5.5)) ? lavaRiv(n) : 0.0;
#endif
#if FAM == 0
  if (u_type == 0){
    float v = fbm(n * 2.5 + SP, 4);
    vec3 c = mix(u_col1, u_col2, smoothstep(-0.4, 0.5, v));
    float rays = smoothstep(0.9, 1.0, ridged(n * 9.0 + SP * 2.0, 3)) * 0.12;
    return c * (0.9 + 0.22 * h) + rays;
  }
#endif
#if FAM == 0
  if (u_type == 8){
    float m = smoothstep(0.02, 0.25, fbm(n * 1.3 + SP, 5) + 0.18 * n.x);
    vec3 c = mix(vec3(0.6, 0.58, 0.55), vec3(0.22, 0.215, 0.21), m);
    float rays = smoothstep(0.92, 1.0, ridged(n * 7.0 + SP * 2.0, 3)) * 0.12;
    return c * (0.92 + 0.18 * h) + rays;
  }
#endif
#if FAM == 3
  if (u_type == 1){
    float a = lat * lat * 2.5 + u_time * 0.002;
    vec3 m = vec3(cos(a) * n.x - sin(a) * n.y, sin(a) * n.x + cos(a) * n.y, n.z);
    float f = fbm(m * vec3(2.0, 2.0, 6.0) + SP, 6);
    float g = fbm(m * vec3(5.0, 5.0, 14.0) + SP * 1.7, 4);
    return mix(vec3(0.95, 0.87, 0.66), vec3(0.8, 0.64, 0.4), smoothstep(-0.5, 0.6, f + 0.3 * g));
  }
#endif
#if FAM == 2
  if (u_type == 2){
    vec3 tx = earthTex(n);
    float land = earthLand(n);
    float desert = smoothstep(0.15, 0.7, tx.g + 0.2 * fbm(n * 9.0 + SP, 3));
    float ice = smoothstep(0.35, 0.7, tx.b + 0.1 * fbm(n * 12.0, 3));
    float seaIce = smoothstep(0.93, 0.97, alat + 0.02 * fbm(n * 10.0, 3));
    float v = fbm(n * 14.0 + SP, 4) * 0.5 + 0.5;
    vec3 forest = mix(vec3(0.03, 0.065, 0.022), vec3(0.075, 0.105, 0.04), v);
    vec3 lc = mix(forest, vec3(0.21, 0.19, 0.1), smoothstep(0.45, 0.85, v + 0.25 * desert) * smoothstep(0.75, 0.3, alat));
    lc = mix(lc, vec3(0.25, 0.24, 0.19), smoothstep(0.78, 0.88, alat));
    lc = mix(lc, mix(vec3(0.6, 0.46, 0.28), vec3(0.76, 0.62, 0.42), v), desert);
    lc = mix(lc, vec3(0.3, 0.27, 0.24), smoothstep(0.35, 0.7, h) * 0.6);
    lc = mix(lc, vec3(0.92), clamp(max(ice, smoothstep(0.62, 0.85, h) * 0.85), 0.0, 1.0));
    float shallow = smoothstep(0.25, 0.48, tx.r);
    vec3 oc = mix(vec3(0.004, 0.017, 0.055), vec3(0.02, 0.085, 0.13), shallow);
    oc = mix(oc, vec3(0.85, 0.9, 0.95), seaIce);
    spec = (1.0 - land) * (1.0 - seaIce);
    float pop = land * (1.0 - desert * 0.9) * (1.0 - ice) * smoothstep(0.85, 0.5, alat);
    float city = pow(max(fbm(n * 45.0 + SP, 4) * 0.5 + 0.5 - 0.35, 0.0) * 1.6, 3.0) + 0.6 * pow(max(fbm(n * 160.0, 3), 0.0), 4.0);
    emis = vec3(1.0, 0.62, 0.28) * pop * city * 0.4;
    return mix(oc, lc, land);
  }
#endif
#if FAM == 1
  if (u_type == 3){
    float f = fbm(n * 2.2 + SP, 5);
    vec3 c = mix(vec3(0.6, 0.29, 0.13), vec3(0.78, 0.46, 0.26), smoothstep(-0.3, 0.5, f));
    float dark = smoothstep(0.1, 0.35, fbm(n * 1.4 + SP * 1.9, 4));
    c = mix(c, vec3(0.3, 0.17, 0.1), dark * 0.7);
    float cap = smoothstep(0.88, 0.93, alat + 0.03 * fbm(n * 8.0, 3));
    return mix(c * (0.85 + 0.4 * h), vec3(0.95, 0.93, 0.9), cap);
  }
#endif
#if FAM == 3
  if (u_type == 4 || u_type == 5 || u_type == 6 || u_type == 7 || u_type == 14 || u_type == 17){
    if (u_exo.x < 0.5) return gasBands(n);
    vec3 c = exoBands(n);
    if (u_exo.x > 1.5){
      // горячий юпитер: тепловое свечение, горячее пятно смещено на восток, светящиеся трещины в облаках
      float a = 0.55;
      vec3 Lh = vec3(cos(a) * gL.x - sin(a) * gL.y, sin(a) * gL.x + cos(a) * gL.y, gL.z);
      float heat = u_exo.y * (0.3 + 0.7 * smoothstep(-0.4, 1.0, dot(n, Lh)));
      float cr = pow(ridged(n * vec3(5.0, 5.0, 13.0) + SP + vec3(u_time * 0.01, 0.0, 0.0), 5), 6.0);
      emis = vec3(0.95, 0.16, 0.04) * heat * (0.25 + 0.55 * (1.0 - gBand)) + vec3(1.0, 0.55, 0.2) * cr * heat * 1.8;
    }
    return c;
  }
#endif
#if FAM == 0
  if (u_type == 9){
    float f = fbm(n * 3.0 + SP, 5);
    vec3 c = mix(vec3(0.93, 0.86, 0.42), vec3(0.85, 0.6, 0.25), smoothstep(-0.2, 0.6, f));
    c = mix(c, vec3(0.95, 0.95, 0.85), smoothstep(0.3, 0.6, fbm(n * 5.0 + SP * 2.0, 3)) * 0.5);
    vec2 w = worley(n * 7.0 + SP);
    float volc = smoothstep(0.12, 0.05, w.x);
    c = mix(c, vec3(0.7, 0.25, 0.12), smoothstep(0.22, 0.12, w.x) * (1.0 - volc) * 0.6);
    c = mix(c, vec3(0.1, 0.07, 0.05), volc * 0.85);
    emis = vec3(1.0, 0.35, 0.08) * smoothstep(0.04, 0.0, w.x) * 0.6;
    return c;
  }
#endif
#if FAM == 0
  if (u_type == 10){
    vec3 c = mix(vec3(0.88, 0.84, 0.76), vec3(0.75, 0.68, 0.58), smoothstep(-0.3, 0.6, fbm(n * 2.0 + SP, 4)));
    float l1 = smoothstep(0.9, 0.98, ridged(n * 4.0 + SP, 3));
    float l2 = smoothstep(0.93, 0.99, ridged(n * 9.0 + SP * 3.0, 2)) * 0.7;
    return mix(c, vec3(0.5, 0.3, 0.18), clamp(l1 + l2, 0.0, 1.0) * 0.75);
  }
#endif
#if FAM == 3
  if (u_type == 11){
    return mix(vec3(0.85, 0.58, 0.24), vec3(0.72, 0.45, 0.16), smoothstep(-0.4, 0.4, sin(lat * 9.0) + 0.5 * fbm(n * 3.0 + SP, 4)));
  }
#endif
#if FAM == 1
  if (u_type == 12 || u_type == 13){
    if (u_exo.x > 4.5 && u_exo.x < 5.5){
      // горячий мир в приливном захвате: под звездой раскалённые трещины и русла лавы с багровым свечением,
      // к терминатору — тёмная остывшая вулканическая кора и жёлтые отложения серы
      float sub = dot(n, gL);
      float hotZ = smoothstep(0.15, 0.95, sub);
      vec3 crust = mix(u_col1, u_col2, smoothstep(-0.3, 0.6, fbm(n * 3.0 + SP, 5))) * (0.85 + 0.3 * clamp(h, -0.5, 1.0));
      float sulf = smoothstep(0.25, 0.65, fbm(n * 4.5 + SP * 1.3, 4)) * smoothstep(0.55, 0.05, sub) * smoothstep(-0.35, 0.05, sub);
      crust = mix(crust, vec3(0.62, 0.52, 0.16), sulf * 0.55);
      crust = mix(crust, vec3(0.16, 0.06, 0.035), hotZ * 0.55);
      // трещины: искажённые (не правильная сетка) и светятся не все — пятнами, где кора тоньше
      vec3 wq = n * 7.0 + 0.9 * vec3(fbm(n * 3.0 + SP, 3), fbm(n * 3.0 + SP.yzx + 4.1, 3), fbm(n * 3.0 + SP.zxy + 8.3, 3));
      vec2 wc = worley(wq + SP);
      float crack = (1.0 - smoothstep(0.0, 0.025 + 0.035 * hotZ, wc.y - wc.x)) * smoothstep(-0.15, 0.35, fbm(n * 4.0 + SP * 1.7, 3));
      float riv = smoothstep(0.84, 0.97, lrv);
      crust = mix(crust, vec3(0.05, 0.035, 0.03), crack * 0.6);
      float g = u_exo.y * pow(max(sub, 0.0), 1.4);
      float flick = 0.85 + 0.15 * fbm(n * 20.0 + vec3(u_time * 0.05), 2);
      emis = (vec3(1.0, 0.25, 0.05) * (crack * 1.3 + riv * 2.0) + vec3(0.55, 0.08, 0.02) * hotZ * 0.6) * g * flick;
      return crust;
    }
    if (u_exo.x > 5.5){
      // «глазное яблоко»: ледяной панцирь, талый тёмно-синий океан вокруг подсолнечной точки (u_par.x — косинус его радиуса)
      float sub = dot(n, gL);
      float edge = sub + 0.07 * fbm(n * 5.0 + SP, 4) + 0.025 * fbm(n * 28.0 + SP, 3);
      float ocean = smoothstep(u_par.x - 0.015, u_par.x + 0.015, edge);
      float shore = smoothstep(u_par.x - 0.09, u_par.x - 0.01, edge) * (1.0 - ocean);
      vec3 ice = mix(vec3(0.86, 0.9, 0.95), vec3(0.6, 0.68, 0.78), smoothstep(-0.2, 0.7, fbm(n * 3.5 + SP, 5)));
      ice = mix(ice, vec3(0.45, 0.58, 0.72), smoothstep(0.9, 0.985, ridged(n * 7.0 + SP, 3)) * 0.5);
      vec3 oc = mix(u_col3 * 1.8, u_col3 * 0.6, smoothstep(u_par.x, 1.0, sub));
      spec = ocean;
      return mix(mix(ice, vec3(0.35, 0.42, 0.48), shore * 0.7), oc, ocean);
    }
    float sea = u_par.x;
    float temp = 1.0 - alat * 1.1 - max(h - sea, 0.0) * 0.8 + u_par.y;
    if (h < sea){
      // морской лёд: плавная рваная кромка вместо резкой линии по широте
      float ice = smoothstep(0.12, -0.05, temp + 0.1 * fbm(n * 9.0 + SP, 4) + 0.04 * fbm(n * 40.0, 3));
      vec3 oc = mix(u_col3 * 1.6, u_col3 * 0.3, smoothstep(0.0, 0.25, sea - h));
      spec = 1.0 - ice;
      return mix(oc, vec3(0.86, 0.9, 0.95) * (0.9 + 0.12 * fbm(n * 30.0, 3)), ice);
    }
    if (u_type == 13){
      // горячая пустыня без воды: ржаво-охристые оксиды, тёмные базальтовые поля, светлые солончаки — без снега
      float v = fbm(n * 2.4 + SP, 5) * 0.5 + 0.5;
      vec3 c = mix(u_col1, u_col2, smoothstep(0.2, 0.85, v + 0.25 * clamp(h, -0.5, 1.0)));
      c = mix(c, u_col1 * 0.45, smoothstep(0.15, 0.4, fbm(n * 1.3 + SP * 1.9, 4)) * 0.6);
      c = mix(c, vec3(0.78, 0.7, 0.58), smoothstep(0.55, 0.8, fbm(n * 7.0 + SP * 0.7, 3)) * 0.35);
      return c * (0.9 + 0.2 * fbm(n * 40.0, 2));
    }
    float e = h - sea;
    vec3 c = mix(u_col1, u_col2, smoothstep(0.2, 0.8, fbm(n * 6.0 + SP, 3) * 0.5 + 0.5 + alat * 0.3));
    c = mix(c, vec3(0.72, 0.65, 0.48), smoothstep(0.02, 0.0, e) * 0.6);
    c = mix(c, vec3(0.34, 0.3, 0.27), smoothstep(0.15, 0.35, e));
    c = mix(c, vec3(0.93), clamp(smoothstep(0.32, 0.45, e) + smoothstep(0.15, 0.0, temp), 0.0, 1.0));
    return c * (0.9 + 0.2 * fbm(n * 40.0, 2));
  }
#endif
#if FAM == 1
  if (u_type == 15){
    // лавовый мир: тёмная базальтовая кора, светящиеся реки и трещины, магматический океан под звездой
    float glow = max(u_exo.y, 0.6);
    float rv = lrv;
    float riv = smoothstep(0.82, 0.97, rv);
    vec2 wc = worley(n * 7.0 + SP);
    float crack = 1.0 - smoothstep(0.0, 0.05, wc.y - wc.x);
    float sub = smoothstep(0.55, 0.95, dot(n, gL) + 0.25 * fbm(n * 4.0 + SP, 3)) * clamp(u_exo.y - 0.3, 0.0, 1.0);
    float flick = 0.85 + 0.15 * fbm(n * 20.0 + vec3(u_time * 0.05), 2);
    emis = (vec3(1.0, 0.36, 0.06) * (riv * 2.6 + crack * 0.8) * glow + vec3(1.0, 0.6, 0.16) * sub * 2.4) * flick;
    vec3 crust = mix(vec3(0.04, 0.036, 0.035), vec3(0.17, 0.14, 0.12), smoothstep(-0.3, 0.5, h));
    crust = mix(crust, vec3(0.32, 0.12, 0.05), smoothstep(0.7, 0.82, rv) * 0.7);
    return mix(crust, vec3(0.35, 0.12, 0.05), sub);
  }
#endif
#if FAM == 1
  if (u_type == 16){
    vec3 c = mix(vec3(0.85, 0.9, 0.97), vec3(0.6, 0.72, 0.85), smoothstep(-0.3, 0.6, fbm(n * 3.0 + SP, 5)));
    float cr = smoothstep(0.9, 0.99, ridged(n * 6.0 + SP, 3));
    return mix(c, vec3(0.25, 0.45, 0.7), cr * 0.6);
  }
#endif
  return u_col1;
}
float cloudDens(vec3 n){
  float a = u_cloudRot;
  vec3 m = vec3(cos(a) * n.x - sin(a) * n.y, sin(a) * n.x + cos(a) * n.y, n.z);
#if FAM == 2
  if (u_texP.w > 0.999){
    // реальные облака (медленно дрейфуют) + мелкие клочья при подлёте
    float c0 = texA(m).r;
    return smoothstep(0.12, 0.85, c0 + u_micro * 0.12 * fbm(m * 300.0 + SP, 3));
  }
#endif
  vec3 w = vec3(fbm(m * 2.0 + SP + 7.0, 3), fbm(m * 2.0 + SP + 13.0, 3), fbm(m * 2.0 + SP + 3.0, 3));
  float f = fbm(m * 3.0 + w * 0.8 + SP, max(u_oct, 5));
  if (u_exo.x > 5.5){
    // устойчивая конвективная шапка облаков ровно над подсолнечной точкой (результат моделей климата)
    float sub = dot(n, gL);
    return smoothstep(0.8, 0.96, sub + 0.12 * f) * 0.95 + smoothstep(0.55, 0.9, f * 0.5 + 0.5) * 0.2 * smoothstep(0.3, 0.9, sub);
  }
  float belt = 0.08 * cos(n.z * 9.0);
  return smoothstep(0.55 - u_par.z, 0.95 - u_par.z, f * 0.5 + 0.5 + belt);
}
// узкое кольцо с сохранением «эквивалентной ширины»: если кольцо уже пикселя, оно расплывается
// на пиксель с пропорционально меньшей плотностью — тонкая линия без мерцания и пропаданий
float narrowRing(float r, float r0, float w, float tau){
  float s = max(w, gRingW * 0.7);
  return tau * (w / s) * exp(-pow((r - r0) / s, 2.0));
}
float ringDensity(float r){
  if (u_ring.w < 1.5){
    float dT = 0.0;
    if (u_texQ.y > 0.0){
      // реальный радиальный профиль колец Сатурна (C, B, щель Кассини, A, щель Энке)
      float x = (r - u_texQ.z) / (u_texQ.w - u_texQ.z);
      float lod = log2(max(gRingW / ((u_texQ.w - u_texQ.z) / 4096.0), 1.0));
      dT = (x > 0.0 && x < 1.0) ? textureLod(u_ringTex, vec2(x, 0.5), lod).a : 0.0;
      // кольцо F (за пределами текстуры)
      dT += narrowRing(r, 2.326, 0.0012, 0.5);
      if (u_texQ.y > 0.999) return clamp(dT, 0.0, 1.0);
    }
    float d = 0.0;
    d += smoothstep(1.239, 1.26, r) * (1.0 - smoothstep(1.51, 1.527, r)) * 0.13;
    d += smoothstep(1.52, 1.535, r) * (1.0 - smoothstep(1.945, 1.951, r)) * (0.72 + 0.2 * sin(r * 180.0));
    d += smoothstep(1.947, 1.952, r) * (1.0 - smoothstep(2.02, 2.027, r)) * 0.05;
    d += smoothstep(2.02, 2.03, r) * (1.0 - smoothstep(2.262, 2.27, r)) * 0.55 * smoothstep(0.0025, 0.0035, abs(r - 2.214));
    d += exp(-pow((r - 2.326) / 0.004, 2.0)) * 0.5;
    d *= 0.75 + 0.5 * hash12(vec2(floor(r * 3000.0), 1.0));
    return clamp(mix(d, dT, u_texQ.y), 0.0, 1.0);
  } else if (u_ring.w < 2.5){
    // Уран (R = 25 559 км): узкие кольца 6, 5, 4, α, β, η, γ, δ, λ, ε по реальным радиусам; ширина
    // визуально увеличена в ~4 раза, чтобы кольца читались (как на длинных экспозициях Voyager 2 / JWST)
    float d = narrowRing(r, 1.6369, 0.0004, 0.5) + narrowRing(r, 1.6524, 0.0004, 0.5) + narrowRing(r, 1.6656, 0.0004, 0.5)
            + narrowRing(r, 1.7496, 0.0011, 0.6) + narrowRing(r, 1.7865, 0.0013, 0.55) + narrowRing(r, 1.8458, 0.0004, 0.45)
            + narrowRing(r, 1.8634, 0.0006, 0.7) + narrowRing(r, 1.8898, 0.0009, 0.6) + narrowRing(r, 1.9572, 0.0004, 0.35)
            + narrowRing(r, 2.0012, 0.0045, 0.95);
    // слабые пылевые кольца: ζ (внутреннее), ν (красноватое) и μ (голубое) — всего 13 колец
    d += 0.025 * smoothstep(1.47, 1.52, r) * smoothstep(1.625, 1.59, r);
    d += 0.035 * smoothstep(2.58, 2.66, r) * smoothstep(2.74, 2.66, r) + 0.025 * exp(-pow((r - 3.72) / 0.22, 2.0));
    return clamp(d, 0.0, 1.0);
  }
  float x = (r - u_ring.x) / (u_ring.y - u_ring.x);
  float d = 0.6 + 0.4 * sin(x * 37.0 + u_seed * 20.0) * sin(x * 11.0 + u_seed * 5.0);
  d *= smoothstep(0.0, 0.05, x) * smoothstep(1.0, 0.9, x);
  d *= 0.7 + 0.6 * hash12(vec2(floor(r * 800.0), u_seed * 100.0));
  float gap = smoothstep(0.012, 0.0, abs(x - fract(u_seed * 7.3) * 0.6 - 0.2));
  return clamp(d * (1.0 - gap), 0.0, 1.0);
}
vec4 shadeRing(float r, vec3 p, vec3 rd, vec3 L){
  float d = ringDensity(r) * u_ring.z;
  if (d <= 0.001) return vec4(0.0);
  vec3 col = u_ringCol;
  if (u_ring.w < 1.5) col = r < 1.527 ? vec3(0.55, 0.5, 0.44) : (r < 1.95 ? vec3(0.86, 0.78, 0.64) : vec3(0.78, 0.73, 0.65));
  if (u_ring.w > 1.5 && u_ring.w < 2.5){
    // пылевые кольца Урана: ν — красноватое, μ — голубое
    if (r > 2.5 && r < 2.8) col = vec3(0.75, 0.55, 0.45);
    if (r > 3.2) col = vec3(0.45, 0.65, 1.0);
  }
  col *= 0.85 + 0.3 * hash12(vec2(floor(r * 600.0), 3.0));
  if (u_ring.w < 1.5 && u_texQ.y > 0.0){
    float x = (r - u_texQ.z) / (u_texQ.w - u_texQ.z);
    float lod = log2(max(gRingW / ((u_texQ.w - u_texQ.z) / 4096.0), 1.0));
    vec3 tc = textureLod(u_ringTex, vec2(clamp(x, 0.0, 1.0), 0.5), lod).rgb * 2.2;
    col = mix(col, (x > 0.0 && x < 1.0) ? tc : vec3(0.7, 0.66, 0.6), u_texQ.y);
  }
  vec2 hs = raySphere(p, L, vec3(0.0), u_r);
  float sh = (hs.x < hs.y && hs.y > 0.0) ? 0.03 : 1.0;
  float sunSide = dot(L, u_pole), viewSide = dot(-rd, u_pole);
  float g = dot(rd, L);
  float I = (sunSide * viewSide > 0.0) ? (0.25 + 0.9 * pow(abs(sunSide), 0.5)) : (1.0 - d) * 2.0 * (0.3 + (u_ring.w > 2.5 ? 0.8 : 1.6) * pow(max(g, 0.0), 4.0));
  return vec4(col * I * sh * u_sunCol * d, d);
}
vec4 atmosphere(vec3 rd, float t0, float t1, vec3 L){
  float Hs = u_atmo.w * 0.28 * u_r;
  const int N = 10;
  float ds = (t1 - t0) / float(N);
  vec3 sum = vec3(0.0);
  float od = 0.0;
  for (int i = 0; i < N; i++){
    vec3 p = rd * (t0 + (float(i) + 0.5) * ds) - u_c;
    float r = length(p);
    float dens = exp(-max(r - u_r, 0.0) / Hs);
    float mu = dot(p / r, L);
    float sun = smoothstep(-0.1, 0.12, mu);
    vec3 sc = mix(vec3(1.0, 0.4, 0.16) * 0.7, u_atmo.rgb, smoothstep(-0.02, 0.22, mu));
    float dl = dens * ds / u_r;
    sum += sc * sun * dl * exp(-od * u_atmoDens);
    od += dl;
  }
  float g = dot(rd, L);
  float phase = 0.75 * (1.0 + g * g) + 0.5 * pow(max(g, 0.0), 8.0);
  return vec4(sum * u_atmoDens * phase * u_sunCol, exp(-od * u_atmoDens));
}
vec3 shadePlanet(vec3 nW, vec3 rd, vec3 L){
  vec3 n = u_bodyRot * nW;
  vec3 Ll = u_bodyRot * L;
  vec3 V = u_bodyRot * (-rd);
  gL = Ll;
  // мип-уровень карты: у лимба поверхность видна под углом — пиксель накрывает больше текселей
  gLod = u_texP.y + 0.6 * log2(1.0 / max(dot(n, V), 0.1));
  float h;
  vec3 N = heightAndBump(n, h);
#if FAM == 2
  // Земля: реальный рельеф горных хребтов из карты нормалей (усилен — исходная карта очень пологая)
  if (u_nrmK > 0.0){
    vec3 nm = textureLod(u_nrm, eqUV(n), gLod).xyz * 2.0 - 1.0;
    vec3 E = vec3(-n.y, n.x, 0.0);
    E = length(E) > 1e-5 ? normalize(E) : vec3(1.0, 0.0, 0.0);
    vec3 Nn = cross(n, E);
    N = normalize(N + (nm.x * E + nm.y * Nn) * 4.0 * u_nrmK);
  }
#endif
  // альбедо; у газовых экзо-гигантов ещё три пробы — рельеф облаков (яркие гряды выше тёмных поясов)
  // и микротени к звезде. albedo() в цикле — встраивается один раз.
  vec3 alb = vec3(0.0); float spec = 0.0; vec3 emis = vec3(0.0);
  // рельеф облаков: экзо-гиганты и газовые гиганты Солнечной системы с реальной картой
  bool cRel = (u_exo.x > 0.5 && u_exo.x < 2.5) || (u_texP.x > 0.5 && (u_type == 1 || u_type == 4 || u_type == 5 || u_type == 6 || u_type == 7));
  float cloudSh = 1.0;
  {
    vec3 t1 = normalize(cross(n, abs(n.z) < 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(n, t1);
    vec3 Lt = Ll - n * dot(Ll, n);
    Lt = length(Lt) > 1e-4 ? normalize(Lt) : t1;
    // пробы рельефа облаков — на масштабе нескольких пикселей: без мелкой ряби и мерцания при движении
    float e = max(u_bumpEps * 4.0, 1.5e-3);
    int cnt = cRel ? 4 : 1;
    float lum[4];
    for (int i = 0; i < cnt + u_zero; i++){
      vec3 q = i == 0 ? n : normalize(n + (i == 1 ? t1 : i == 2 ? t2 : Lt * 3.0) * e);
      float sp1; vec3 em1;
      vec3 a = albedo(q, h, sp1, em1);
      if (i == 0){ alb = a; spec = sp1; emis = em1; }
      lum[i] = dot(a, vec3(0.3, 0.59, 0.11));
    }
    if (cRel){
      vec3 gv = ((lum[1] - lum[0]) * t1 + (lum[2] - lum[0]) * t2) / e * 0.016;
      float gl = length(gv);
      if (gl > 0.5) gv *= 0.5 / gl;
      N = normalize(n - gv);
      float sinE = dot(n, Ll);
      cloudSh = 1.0 - 0.7 * smoothstep(0.012, 0.1, lum[3] - lum[0]) * (1.0 - smoothstep(0.05, 0.55, sinE));
    }
  }
  float ndl = dot(N, Ll), ndlS = dot(n, Ll);
  float ndv = max(dot(n, V), 0.0);
  float diff = max(ndl, 0.0);
  if (u_type == 0 || u_type == 8 || u_type == 9 || u_type == 10 || u_type == 3 || u_type == 13){
    float ls = diff / (diff + ndv + 1e-3);
    diff = mix(diff, ls * 1.6, 0.5);
  }
  diff *= smoothstep(-0.015, 0.035, ndlS);
  // у экзо-гигантов глубокое потемнение к терминатору; тени облачных гряд и рельефа
  if (cRel){
    // матовые облака: смесь Ламберта и Ломмеля–Зеелигера — освещённость ровнее по диску, без яркого «блика»
    // в центре; у терминатора — по-прежнему глубокое потемнение
    float ls = 2.0 * diff / (diff + ndv + 0.05);
    diff = mix(diff, ls * smoothstep(0.0, 0.25, diff), 0.5) * 0.78;
    diff = pow(max(diff, 0.0), 1.3);
  }
  diff *= cloudSh * gShadow;
  float rs = 1.0;
  if (u_ring.w > 0.5){
    vec3 Pw = nW * u_r;
    float dn = dot(L, u_pole);
    if (abs(dn) > 1e-5){
      float t = -dot(Pw, u_pole) / dn;
      if (t > 0.0){ float r = length(Pw + L * t) / u_r; if (r > u_ring.x && r < u_ring.y) rs = 1.0 - ringDensity(r) * u_ring.z * 0.9; }
    }
  }
  float cl = 0.0, clS = 0.0;
  if (u_par.z > 0.0){
    float cd[2];
    for (int i = 0; i < 2 + u_zero; i++) cd[i] = cloudDens(i == 0 ? n : normalize(n + Ll * 0.008));
    cl = cd[0]; clS = cd[1];
  }
  vec3 lit = alb * diff * (1.0 - 0.6 * clS);
  if (spec > 0.0){
    vec3 Hh = normalize(Ll + V);
    float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    float nh = max(dot(n, Hh), 0.0);
    // солнечный блик: резкое ядро + широкое сияние ряби волн (как на снимках Земли с орбиты)
    lit += spec * (pow(nh, 900.0) * 7.0 + pow(nh, 140.0) * 0.45 + pow(nh, 24.0) * 0.04) * (0.3 + fres) * smoothstep(0.0, 0.1, ndlS) * (1.0 - cl);
  }
  lit = mix(lit, vec3(0.95) * smoothstep(-0.05, 0.3, ndlS) * max(ndlS + 0.05, 0.0), cl);
  lit *= u_sunCol * rs;
  if (u_exo.x > 4.5 && u_exo.x < 5.5){ float tz = exp(-pow((ndlS - 0.05) / 0.22, 2.0)); lit += vec3(0.62, 0.5, 0.2) * tz * 0.1 * u_sunCol; }
  float night = smoothstep(0.08, -0.12, ndlS);
  lit += emis * (u_type == 2 ? night * (1.0 - cl * 0.85) : 1.0);
  if (u_type == 4 || u_type == 5 || u_type == 6 || u_type == 7 || u_type == 14 || u_type == 17 || u_type == 11) lit *= 0.5 + 0.5 * pow(ndv, 0.35);
  // полярное сияние на магнитных полюсах и молнии на ночной стороне газовых гигантов
  if (u_type == 4 || u_type == 5 || u_type == 14 || u_type == 17){
    float colat = acos(clamp(abs(n.z), 0.0, 1.0));
    float ring = exp(-pow((colat - 0.26) / 0.045, 2.0));
    float curtain = 0.55 + 0.45 * sin(atan(n.y, n.x) * 17.0 + u_time * 0.35 + 4.0 * fbm(n * 5.0 + SP + vec3(u_time * 0.03), 2));
    vec3 aurC = mix(vec3(0.25, 1.0, 0.55), vec3(0.85, 0.35, 1.0), smoothstep(0.2, 0.32, colat));
    lit += aurC * ring * curtain * (0.05 + 0.5 * night) * (0.6 + 0.4 * pow(1.0 - ndv, 1.5)) * 0.6;
    vec3 g = n * 18.0, cc = floor(g);
    // молнии — редкие и тусклые (в ~20 раз реже прежнего): ночная сторона спокойная и тёмная
    float ph = u_time * 0.6 + hash13(cc) * 7.0;
    float hz = hash13(cc + floor(ph) * 0.731);
    if (hz > 0.9993 && night > 0.0){
      // центр вспышки — в середине ячейки, ореол уже ячейки: без «квадратных» обрезанных пятен
      vec3 ctr = normalize((cc + 0.4 + 0.2 * hash33(cc + floor(ph))) / 18.0);
      float d = length(n - ctr), fl = 1.0 - fract(ph);
      lit += (vec3(0.75, 0.85, 1.0) * exp(-d * d * 30000.0) * 0.6 + vec3(0.5, 0.6, 1.0) * exp(-d * d * 7000.0) * 0.06) * night * fl * fl;
    }
  }
  // плотный ободок рассеяния на лимбе; у терминатора — закатный оттенок
  if (u_exo.w > 0.0){
    float fr = pow(1.0 - ndv, 2.5);
    vec3 rc = mix(vec3(1.0, 0.42, 0.16), u_rim, smoothstep(-0.05, 0.4, ndlS));
    lit += rc * fr * u_exo.w * smoothstep(-0.35, 0.25, ndlS) * mix(u_sunCol, vec3(length(u_sunCol) * 0.577), 0.5) * 1.9;
  }
  lit += alb * u_ambient;
  return lit;
}
void main(){
  // сдвиг в поле шума на десятки периодов: материки, кратеры и штормы у каждой планеты свои
  SP = vec3(u_seed * 13.1, u_seed * 7.7, u_seed * 3.3) + u_rnd.xyz * vec3(91.7, 57.3, 77.9);
  vec3 rd = rayDir();
  float tc = dot(u_c, rd);
  if (tc < 0.0 && u_full < 0.5) discard;
  vec3 cpv = rd * tc - u_c;
  float x = length(cpv) / u_r;
  vec3 L = u_sunDir;
  float cover = 0.0, tP = 1e20;
  vec3 pc = vec3(0.0);
  float limbF = 1.0;   // доля атмосферной дымки над диском (у экзопланет — только у лимба)
  float aa = max(fwidth(x), 1e-5);
  if (tc > 0.0) cover = 1.0 - smoothstep(1.0 - aa, 1.0, x);
  if (cover > 0.0){
    float xs = min(x, 0.99999);
    float zz = sqrt(1.0 - xs * xs);
    tP = tc - zz * u_r;
    vec3 nHit = normalize(cpv - rd * zz * u_r);
    pc = shadePlanet(nHit, rd, L);
    // Френель: в центре диска дымка почти не видна (облака не «выжигаются»), к краю — плотный ободок
    limbF = mix(u_hazeFloor, 1.0, pow(1.0 - max(dot(nHit, -rd), 0.0), 3.0));
  }
  float tR = 1e20;
  vec4 ringC = vec4(0.0);
  if (u_ring.w > 0.5){
    float dn0 = dot(rd, u_pole);
    float rr = length(rd * (dot(u_c, u_pole) / (abs(dn0) > 1e-7 ? dn0 : 1e-7)) - u_c) / u_r;
    gRingW = min(fwidth(rr), 0.5);
  }
  if (u_ring.w > 0.5){
    float dn = dot(rd, u_pole);
    if (abs(dn) > 1e-7){
      float t = dot(u_c, u_pole) / dn;
      if (t > 0.0){
        vec3 p = rd * t - u_c;
        float r = length(p) / u_r;
        if (r > u_ring.x && r < u_ring.y){ tR = t; ringC = shadeRing(r, p, rd, L); }
      }
    }
  }
  vec4 atm = vec4(0.0, 0.0, 0.0, 1.0);
  if (u_atmo.w > 0.0){
    vec2 ha = raySphere(vec3(0.0), rd, u_c, u_r * (1.0 + u_atmo.w));
    if (ha.x < ha.y && ha.y > 0.0){
      float t0 = max(ha.x, 0.0);
      float t1 = cover > 0.0 ? min(tP, ha.y) : ha.y;
      if (t1 > t0) atm = atmosphere(rd, t0, t1, L);
    }
  }
  vec3 body = mix(atm.rgb, pc * mix(1.0, atm.a, limbF) + atm.rgb * limbF, cover);
  float bodyA = mix(clamp(1.0 - atm.a, 0.0, 1.0), 1.0, cover);
  vec3 col = body; float a = bodyA;
  if (tR < tP){ col = ringC.rgb + (1.0 - ringC.a) * body; a = ringC.a + (1.0 - ringC.a) * bodyA; }
  // газовый шлейф горячего юпитера, сдуваемый звёздным ветром (ближайшая точка луча к оси «от звезды»)
  if (u_exo.z > 0.0){
    vec3 A = -L, w0 = -u_c;
    float bb = dot(rd, A), dd = dot(rd, w0), ee = dot(A, w0);
    float den = max(1.0 - bb * bb, 1e-4);
    float tq = (bb * ee - dd) / den, sq = (ee - bb * dd) / den;
    if (tq > 0.0 && sq > 0.0){
      float dist = length(w0 + rd * tq - A * sq) / u_r;
      float s = sq / u_r;
      float wdt = 0.9 + 0.28 * s;
      float nz = fbm(vec3(s * 0.6 - u_time * 0.15, dist * 1.5, 0.0) + SP, 4);
      float dens = exp(-pow(dist / wdt, 2.0)) * smoothstep(0.6, 2.2, s) * exp(-s / u_exo.z) * (0.55 + 0.6 * nz);
      float occl = (cover > 0.0 && tq > tP) ? 0.0 : 1.0;
      float k = dens * occl * 0.3 * min(inversesqrt(den), 4.0) / sqrt(wdt);
      vec3 tcol = mix(vec3(1.0, 0.55, 0.3), vec3(0.55, 0.7, 1.0), smoothstep(1.0, 7.0, s));
      col += tcol * k * length(u_sunCol) * 0.6;
    }
  }
  if (a <= 0.0 && dot(col, col) <= 0.0) discard;
  o = vec4(col, a);
}`;
})();
