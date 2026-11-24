'use strict';
/* =====================================================================
 *  Глубокий космос одним инстансным проходом: каждый объект каталога —
 *  квад, в котором фрагментный шейдер рисует модель своего класса.
 *  Издали объект — точка с блеском по видимой величине; вблизи —
 *  объёмная модель (галактика с наклоном диска, оболочка туманности,
 *  рой звёзд скопления, пульсар с вращающимися пучками…).
 *  Позиции — пары hi/lo float32 (точность double на GPU).
 *
 *  Классы: 0 спиральная, 1 эллиптическая/линзовидная, 2 неправильная галактика,
 *  3 планетарная туманность, 4 остаток сверхновой, 5 эмиссионная, 6 отражательная туманность,
 *  7 рассеянное, 8 шаровое скопление, 9 пульсар, 10 магнетар, 11 квазар/радиогалактика,
 *  12 скопление галактик, 13 рентгеновская двойная с чёрной дырой, 14 группа/пара галактик.
 * ===================================================================== */
(function () {
  const MW = window.MW;
  const G = MW.GLSL;

  G.dsoVS = G.header + `
layout(location=0) in vec2 a_corner;
layout(location=1) in vec3 a_hi;
layout(location=2) in vec3 a_lo;
layout(location=3) in vec3 a_nrm;
layout(location=4) in vec3 a_col;
layout(location=5) in vec4 a_par;      // x радиус (св. лет), y класс, z сид, w абсолютная величина
uniform mat4 u_view, u_proj;
uniform vec3 u_camHi, u_camLo;
uniform float u_pxPerRad, u_magLim, u_scale;
uniform float u_bgShrink;   // 0..1: при фокусе на близком теле протяжённые фоновые объекты уменьшаются
out vec3 v_rel;
out vec3 v_nrm;
out vec3 v_col;
out vec2 v_px;
flat out vec4 v_par;
flat out float v_I;
flat out float v_pr;
flat out float v_fade;
void main(){
  vec3 rel = (a_hi - u_camHi) + (a_lo - u_camLo);
  float D = max(length(rel), 1e-30);
  float R = a_par.x;
  // фон, занимающий больше ~2° неба, при фокусе на близкой планете рисуется меньше (не «нависает» над ней)
  R *= 1.0 - u_bgShrink * 0.6 * smoothstep(0.03, 0.15, R / D);
  float pr = atan(R / D) * u_pxPerRad;
  float m = a_par.w + 5.0 * log2(D / 32.6156) * 0.30103;
  float I = clamp(exp2(-1.3287712 * (m - u_magLim)), 0.0, 4.0);
  // объекты с оценочным расстоянием (+100 в сиде): их 3D-положение условно — из всех таких объектов на одном
  // «типовом» расстоянии (4 000 св. лет и т. п.) получалась бы сферическая оболочка — «мыльный пузырь» или кольцо
  // при взгляде на Галактику со стороны. Они видны, пока камера рядом с Солнцем, и гаснут при удалении.
  float est = step(99.5, a_par.z);
  float distS = length(a_hi + a_lo), camS = length(u_camHi + u_camLo);
  v_fade = est > 0.5 ? 1.0 - smoothstep(distS * 0.08, distS * 0.3, camS) : 1.0;
  if (v_fade < 0.003){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  v_rel = rel; v_nrm = a_nrm; v_col = a_col; v_par = vec4(R, a_par.y, a_par.z - est * 100.0, a_par.w); v_I = I; v_pr = pr;
  // далёкие тусклые точки не рисуем
  if (pr < 2.0 && I < 0.003){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec4 pv = u_view * vec4(rel, 1.0);
  // вблизи (или когда объект сбоку/позади) — весь экран: квад иначе пересёк бы плоскость камеры,
  // и объём (остаток сверхновой, туманность) обрезался бы прямой линией
  bool vol = a_par.y > 2.5 && a_par.y < 6.5;
  if (D < R * (vol ? 2.4 : 1.08) || (vol && pv.z > -R * 1.4 && pv.z < R && R > D * 0.05)){ gl_Position = vec4(a_corner, 0.0, 1.0); v_px = a_corner * 1e4; return; }
  if (pv.z > R){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // полуразмер квада в плоскости центра: конус касательных к сфере (а не угловой радиус × 1,08)
  float sinA = min(R / D, 0.999);
  float minPx = vol ? 1.6 : 2.6;   // туманности — строго в реальном угловом размере (точка ≤ 1,6 px — только блеск)
  float sizeW = max(R / sqrt(1.0 - sinA * sinA) * (D / max(-pv.z, 1e-30)) * 1.04, minPx * u_scale * D / u_pxPerRad);
  float sizePx = sizeW * u_pxPerRad / D;
  pv.xy += a_corner * sizeW;
  v_px = a_corner * sizePx;
  gl_Position = u_proj * pv;
}`;

  G.dsoFS = G.header + G.noise + G.ray + G.snr + `
in vec3 v_rel;
in vec3 v_nrm;
in vec3 v_col;
in vec2 v_px;
flat in vec4 v_par;
flat in float v_I;
flat in float v_pr;
flat in float v_fade;
uniform float u_time, u_bright, u_scale;
out vec4 o;
float h1(float x){ return fract(sin(x * 91.17 + v_par.z * 413.3) * 43758.5453); }
vec2 h2(vec2 p){ return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))) + v_par.z * 17.0) * 43758.5453); }
// звёздное поле в плоскости квада: одна звезда на ячейку с вероятностью dens(q)
vec3 starField(vec2 q, float cells, float densK, float core){
  vec2 g = q * cells;
  vec2 c = floor(g);
  vec2 hh = h2(c);
  vec2 sp = (c + 0.2 + 0.6 * hh) / cells;
  float rr = length(sp);
  float dens = densK / (1.0 + pow(rr / core, 2.0)) * smoothstep(1.0, 0.75, rr);
  if (hh.x * 0.7 + hh.y * 0.3 > dens) return vec3(0.0);
  float dpx = length(q - sp) * v_pr;
  float sz = 0.7 * u_scale + 1.1 * hh.y * u_scale;
  float a = exp(-dpx * dpx / (sz * sz));
  vec3 tint = mix(vec3(1.0, 0.82, 0.6), vec3(0.75, 0.85, 1.0), fract(hh.x * 7.3));
  return tint * a * (0.6 + 1.4 * hh.y);
}
// расстояние от луча (из камеры) до прямой «центр + m·s»; s — в единицах радиуса
vec2 lineDist(vec3 rd, vec3 C, vec3 m, float R){
  vec3 w0 = -C;
  float bb = dot(rd, m), dd = dot(rd, w0), ee = dot(m, w0);
  float den = max(1.0 - bb * bb, 1e-5);
  float tq = (bb * ee - dd) / den, s = (ee - bb * dd) / den;
  return vec2(length(w0 + rd * tq - m * s) / R, s / R);
}
void main(){
  int cls = int(v_par.y + 0.5);
  float R = v_par.x, seed = v_par.z;
  vec3 rd = rayDir();
  vec3 C = v_rel;
  vec3 N = normalize(v_nrm);
  vec3 T = normalize(cross(N, abs(N.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
  vec3 B = cross(N, T);
  // базис, перпендикулярный направлению на объект: для звёздных роёв (без растяжения под углом)
  vec3 vC = normalize(v_rel);
  vec3 Ts = normalize(cross(vC, abs(vC.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
  vec3 Bs = cross(vC, Ts);
  float tc = dot(C, rd);
  vec3 cp = rd * tc - C;
  float b = length(cp) / R;
  vec3 col = vec3(0.0);
  float detail = smoothstep(2.5, 9.0, v_pr);
  if (detail > 0.0 && (tc > 0.0 || length(C) < R)){
    if (cls <= 2 || cls == 14){
      // ---------- галактика: диск в своей плоскости + балдж/эллипсоид ----------
      float den = dot(rd, N);
      vec3 p = cp;
      if (abs(den) > 0.12){ float t = dot(C, N) / den; p = rd * t - C; }
      float hgt = abs(dot(cp, N)) / R;
      vec2 uv = vec2(dot(p, T), dot(p, B)) / R;
      float r = length(uv), th = atan(uv.y, uv.x);
      float edge = 1.0 - smoothstep(0.12, 0.35, abs(den));           // вид с ребра
      float thick = mix(1.0, exp(-pow(hgt / 0.035, 2.0)) * 2.2, edge);
      if (cls == 0){
        float phi = th - log(r + 0.03) * (2.2 + 1.5 * seed) + seed * 6.2831;
        float arm = pow(0.5 + 0.5 * cos(2.0 * phi), 2.5);
        float knots = smoothstep(0.35, 0.9, snoise(vec3(uv * 9.0, seed * 7.0))) * arm;
        float dust = smoothstep(0.55, 1.0, 0.5 + 0.5 * cos(2.0 * phi + 0.7)) * smoothstep(0.08, 0.3, r);
        float disk = exp(-r / 0.24) * smoothstep(1.0, 0.75, r);
        vec3 dc = mix(vec3(1.0, 0.86, 0.62), vec3(0.62, 0.76, 1.0), smoothstep(0.1, 0.45, r));
        col = dc * disk * (0.3 + 1.1 * arm) * (1.0 - 0.55 * dust) * thick + vec3(0.55, 0.7, 1.0) * knots * disk * 0.8;
        col *= mix(1.0, 1.0 - 0.6 * exp(-pow(hgt / 0.012, 2.0)), edge);    // пылевая полоса вдоль диска с ребра
        float bul = exp(-pow(b / 0.09, 1.2));
        col += vec3(1.0, 0.8, 0.55) * bul * 1.4;
      } else if (cls == 1){
        // эллиптическая: эллипсоид (сжат вдоль оси), закон де Вокулёра
        vec3 q = cp - N * dot(cp, N) * 0.6;
        float be = length(q) / R;
        col = vec3(1.0, 0.84, 0.64) * exp(-7.67 * (pow(max(be, 1e-4), 0.25) - 1.0)) * 0.0011 * smoothstep(1.0, 0.7, be);
      } else if (cls == 2){
        float f = snoise(vec3(uv * 3.0, seed * 5.0)) * 0.6 + snoise(vec3(uv * 7.0, seed * 3.0)) * 0.4;
        float disk = exp(-r / 0.35) * smoothstep(1.0, 0.6, r) * smoothstep(-0.4, 0.6, f);
        col = vec3(0.7, 0.8, 1.0) * disk * thick + vec3(0.6, 0.75, 1.0) * smoothstep(0.7, 0.95, f) * disk;
      } else {
        // пара/группа: несколько галактик в общем облаке
        vec2 qq = vec2(dot(cp, Ts), dot(cp, Bs)) / R;
        for (int i = 0; i < 4 + u_zero; i++){
          vec2 c = (vec2(h1(float(i)), h1(float(i) + 3.7)) - 0.5) * 1.1;
          float d = length(qq - c);
          col += mix(vec3(1.0, 0.85, 0.65), vec3(0.65, 0.78, 1.0), h1(float(i) + 9.0)) * exp(-d / (0.05 + 0.05 * h1(float(i) + 1.0)));
        }
        col *= 0.6;
      }
      col *= v_col * 1.2;
    } else if (cls == 3){
      // ---------- планетарная туманность: оболочка O III (бирюзовая) и N II/Hα (красная кромка) ----------
      float ch1 = sqrt(max(0.82 * 0.82 - b * b, 0.0)), ch2 = sqrt(max(0.6 * 0.6 - b * b, 0.0)), ch3 = sqrt(max(1.0 - b * b, 0.0));
      vec3 dl = normalize(cp + vec3(1e-9));
      float nz = 0.6 + 0.5 * snoise(dl * 4.0 + seed * 9.0);
      col = vec3(0.3, 0.95, 0.85) * (ch1 - ch2 + 0.25 * ch2) * nz * 1.5 + vec3(1.0, 0.28, 0.25) * (ch3 - ch1) * 2.0 * (0.7 + 0.5 * snoise(dl * 7.0 + seed));
      col += vec3(0.85, 0.9, 1.0) * exp(-pow(b * v_pr / 1.6, 2.0)) * 3.0;
    } else if (cls == 4){
      // ---------- остаток сверхновой: объёмная трассировка (snr.js); тип зашит в сид: тип·10 + сид ----------
      int typ = int(floor(seed / 10.0));
      float sd = seed - float(typ) * 10.0;
      float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      vec4 m = snrMarch(-C / R, rd, sd, typ, ign);
      col = m.rgb * 1.4;
    } else if (cls == 5 || cls == 6){
      // ---------- диффузная туманность: несколько слоёв шума вдоль луча ----------
      float acc = 0.0;
      for (int i = 0; i < 3 + u_zero; i++){
        float k = (float(i) - 1.0) * 0.45;
        vec3 q = (cp + rd * k * R) / R;
        float d = length(q);
        acc += max(snoise(q * 2.2 + seed * 7.0) * 0.6 + snoise(q * 5.0 + seed) * 0.4 + 0.25, 0.0) * exp(-d * d * 2.5);
      }
      col = (cls == 5 ? vec3(1.0, 0.32, 0.42) : vec3(0.42, 0.6, 1.0)) * acc * 0.5;
    } else if (cls == 7 || cls == 8){
      // ---------- скопление: рой звёзд (шаровое — плотное ядро и интегральное свечение) ----------
      vec2 q = vec2(dot(cp, Ts), dot(cp, Bs)) / R;
      if (cls == 7) col = starField(q, 9.0, 0.6, 0.6) + starField(q + 0.37, 17.0, 0.35, 0.5) * 0.6;
      else {
        col = starField(q, 26.0, 1.2, 0.12) + starField(q + 0.21, 48.0, 1.0, 0.1) * 0.7;
        col += vec3(1.0, 0.88, 0.7) * 0.25 / (1.0 + pow(b / 0.07, 2.0)) * smoothstep(1.0, 0.6, b);
      }
    } else if (cls == 9 || cls == 10){
      // ---------- пульсар / магнетар: нейтронная звезда, наклонная магнитная ось вращается с периодом ----------
      float rate = v_col.y;   // у пульсаров в v_col.y — видимая частота вращения, Гц
      float ph = u_time * rate * 6.2831853 + seed * 6.2831;
      float al = 0.55 + 0.3 * h1(2.0);
      vec3 m = normalize(N * cos(al) + (T * cos(ph) + B * sin(ph)) * sin(al));
      vec2 ld = lineDist(rd, C, m, R);
      float s = abs(ld.y);
      float w = 0.015 + 0.16 * s;
      float beam = exp(-pow(ld.x / w, 2.0)) * smoothstep(1.0, 0.25, s) * smoothstep(0.0, 0.04, s);
      vec3 vdir = normalize(-C);
      float flash = pow(abs(dot(m, vdir)), 80.0);
      float core = exp(-pow(b * v_pr / (1.4 + 4.0 * flash), 2.0)) * (2.0 + 30.0 * flash);
      vec3 bc = cls == 10 ? vec3(0.9, 0.45, 1.0) : vec3(0.5, 0.75, 1.0);
      // торoidальная туманность ветра в экваториальной плоскости
      float hz = abs(dot(cp, N)) / R;
      float torus = exp(-pow((b - 0.22) / 0.06, 2.0)) * exp(-pow(hz / 0.05, 2.0));
      col = bc * beam * 1.6 + vec3(0.9, 0.95, 1.0) * core + bc * torus * 0.25 + bc * exp(-b * 7.0) * 0.06;
      if (cls == 10) col += vec3(0.8, 0.4, 1.0) * exp(-b * 3.0) * 0.12 * (0.7 + 0.3 * sin(u_time * 3.0));
    } else if (cls == 11){
      // ---------- квазар: ослепительное ядро, релятивистские джеты, родительская галактика ----------
      vec2 ld = lineDist(rd, C, N, R);
      float s = abs(ld.y);
      float jet = exp(-pow(ld.x / (0.008 + 0.03 * s), 2.0)) * smoothstep(1.0, 0.1, s) * (0.6 + 0.4 * snoise(vec3(s * 20.0 - u_time * 0.5, seed, 0.0)));
      float lobe = exp(-pow(length(vec2(ld.x, s - 0.85)) / 0.12, 2.0));
      col = vec3(0.55, 0.7, 1.0) * (jet * 1.5 + lobe * 0.5) + vec3(1.0, 0.95, 0.9) * exp(-pow(b * v_pr / 2.0, 2.0)) * 6.0
          + vec3(1.0, 0.85, 0.65) * exp(-b / 0.08) * 0.35;
      // На средних дистанциях (0,01 … 10 000 св. лет от ядра) ядро и джеты не заливают экран белым: их яркость
      // плавно (по логарифму расстояния) уступает релятивистскому шейдеру чёрной дыры, пиковая яркость ограничена.
      // полностью — только с галактических дистанций (> ~10 000 св. лет); ближе — приглушено до нескольких процентов
      float nearK = smoothstep(0.0, 1.0, log(max(length(C), 1.0) / 1500.0) / log(20000.0 / 1500.0));
      col *= mix(0.025, 1.0, nearK);
      col = col / (1.0 + max(max(col.r, col.g), col.b) / 2.0);
    } else if (cls == 12){
      // ---------- скопление галактик: сотни эллиптических «пятнышек» и горячий газ (рентген) ----------
      vec2 q = vec2(dot(cp, Ts), dot(cp, Bs)) / R;
      vec2 g = q * 22.0, c = floor(g), hh = h2(c);
      vec2 sp = (c + 0.2 + 0.6 * hh) / 22.0;
      float dens = 1.3 / (1.0 + pow(length(sp) / 0.25, 2.0)) * smoothstep(1.0, 0.8, length(sp));
      float gal = hh.x < dens ? exp(-pow(length(q - sp) * 22.0 / (0.06 + 0.12 * hh.y), 2.0)) : 0.0;
      // поверхностная яркость скоплений галактик крайне мала — без длинной экспозиции они почти не видны
      col = (mix(vec3(1.0, 0.85, 0.65), vec3(0.7, 0.8, 1.0), step(0.75, hh.y)) * gal * 0.35 + vec3(0.6, 0.45, 1.0) * exp(-b * b * 5.0) * 0.025)
          * (0.25 + 0.75 * smoothstep(0.02, 0.006, atan(R, length(C))));
    } else if (cls == 13){
      // ---------- рентгеновская двойная: аккреционный диск и джеты ----------
      float den = dot(rd, N);
      float t = abs(den) > 1e-4 ? dot(C, N) / den : 0.0;
      vec3 p = rd * t - C;
      float r = length(p) / R;
      float disk = (r > 0.08 && r < 0.7) ? pow(0.08 / r, 1.3) * (0.7 + 0.3 * sin(atan(dot(p, B), dot(p, T)) * 3.0 - u_time * 2.0 / r)) : 0.0;
      vec2 ld = lineDist(rd, C, N, R);
      col = mix(vec3(1.0, 0.6, 0.3), vec3(0.7, 0.85, 1.0), smoothstep(0.4, 0.1, r)) * disk * 1.5 + vec3(0.5, 0.7, 1.0) * exp(-pow(ld.x / 0.01, 2.0)) * smoothstep(1.0, 0.1, abs(ld.y)) * 0.8;
      col += vec3(0.75, 0.82, 1.0) * exp(-pow(length(cp - (T * 0.85) * R) / R / 0.06, 2.0)) * 2.0;     // голубой сверхгигант-компаньон
    }
    // камера у самого ядра (активное ядро галактики/квазара): «точечное» ядро и центральный профиль родительской
    // галактики не растягиваются на весь экран — там работает шейдер чёрной дыры
    if (cls <= 2 || cls == 11 || cls == 14) col *= smoothstep(2e-5, 6e-4, length(C) / R);
    col *= u_bright * detail;
  }
  // издали — точка: блеск по видимой величине (сохраняет поток при переходе)
  float pt = (1.0 - detail) * v_I * exp(-dot(v_px, v_px) / (1.1 * u_scale * u_scale));
  vec3 ptc = cls == 9 ? vec3(0.6, 0.8, 1.0) : cls == 10 ? vec3(0.9, 0.55, 1.0) : v_col;
  col += ptc * pt;
  col *= v_fade;
  if (dot(col, col) < 1e-10) discard;
  o = vec4(max(col, vec3(0.0)), 0.0);
}`;

})();
