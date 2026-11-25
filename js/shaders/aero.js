'use strict';
/* =====================================================================
 *  Режим «Погрузиться в атмосферу»: полёт внутри атмосферы планет без
 *  твёрдой поверхности (газовые и ледяные гиганты, мини-нептуны, горячие
 *  юпитеры) и над жидкой поверхностью (океан магмы, водный океан).
 *
 *  Один полноэкранный проход (пониженное разрешение для облаков) пишет две
 *  карты: свет атмосферы/облаков/поверхности (In) и пропускание к космосу (T);
 *  композит: сцена·T + In. Звезда, луны и звёзды неба рисуются обычным
 *  рендером и видны сквозь дымку; кольца — здесь (из-под облаков).
 *
 *  Система координат — локальная у камеры: x восток, y север, z вверх, км.
 *  Высота любой точки считается по сфере (u_R + u_alt под камерой), поэтому
 *  и у облачной палубы, и с высоты тысячи км горизонт и слои — правильные.
 *  Стили: 0 газовый гигант, 1 ледяной гигант, 2 горячий юпитер, 3 океан магмы,
 *  4 водный океан.
 * ===================================================================== */
(function () {
  const MW = window.MW;
  const G = MW.GLSL;

  G.aeroFS = G.header + G.noise + G.ray + `
uniform mat3 u_w2l;               // мир → локальная система (восток, север, вверх)
uniform int u_style;
uniform float u_R, u_alt, u_H;    // радиус уровня 1 бар / поверхности, высота камеры, шкала высот (км)
uniform vec3 u_sunL, u_sunE;       // направление на звезду (лок.) и освещённость
uniform vec3 u_c1, u_c2, u_c3;     // палитра облаков (линейная): светлые верхушки, средний ярус, глубина
uniform vec3 u_skyC, u_haze, u_ext;// рэлеевский цвет неба, цвет дымки, спектр поглощения (метан гасит красный)
uniform float u_hazeK, u_tau0;     // плотность дымки у уровня камеры (1/H), толща над палубой
uniform vec4 u_deck;               // верхний ярус: низ, верх (в H), покрытие, масштаб ячеек (в H)
uniform vec4 u_deck2;              // нижний ярус: низ, верх; сила башен; вытянутость по ветру
uniform vec2 u_wind;               // снос облаков ветром, км
uniform float u_t;
uniform vec4 u_ring;               // ri, ro (в R), непрозрачность, есть ли кольца
uniform vec3 u_ringN, u_ringC;
uniform vec4 u_fl[3];              // вспышки молний: положение (км), яркость
uniform float u_glow;              // тепловое свечение глубин (горячий юпитер) / магмы
uniform int u_steps, u_lightN;
uniform float u_pixAng;
uniform float u_wisp;              // потоки конденсата (пряди по ветру у высоты камеры): 0 — нет
uniform vec4 u_probe;              // w > 0.5: «проба» — один луч строго на звезду (видимость звезды для бликов объектива)
layout(location=0) out vec4 oIn;
layout(location=1) out vec4 oT;
vec3 PC;
float altOf(vec3 p){ return length(p - PC) - u_R; }
float hgP(float mu, float g){ float g2 = g * g; return 0.0795775 * (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5); }
// плотность облаков (0..1); hn — высота в шкалах H
float cloudD(vec3 p, bool fine, out float hn){
  hn = altOf(p) / u_H;
  if (u_deck.z < -0.5) return 0.0;
  vec2 q = (p.xy + u_wind) / (u_H * u_deck.w);
  q.x /= 1.0 + u_deck2.w;
  float big = snoise(vec3(q * 0.33, 3.7)) * 0.65 + snoise(vec3(q * 0.95, 8.1)) * 0.35;
  float d = 0.0;
  float uL = smoothstep(u_deck.x, u_deck.x + 0.15, hn) * smoothstep(u_deck.y + 0.1 * big, u_deck.y - 0.2, hn);
  d = uL * clamp(u_deck.z + 0.55 * big, 0.0, 1.0);
  if (u_deck2.y > u_deck2.x){
    // нижний ярус — сплошной облачный «океан» с волнистой поверхностью (крупные валы + мелкая зыбь по ветру)
    float wave = 0.3 * big + 0.08 * snoise(vec3(q * vec2(1.1, 1.6), 11.0));
    // кромка «океана» мягкая (0,4 H): тонкую кромку шаги трассировки резали на «годичные кольца»
    float lL = smoothstep(u_deck2.x, u_deck2.x + 0.15, hn) * smoothstep(u_deck2.y + wave + 0.1, u_deck2.y + wave - 0.3, hn);
    d = max(d, lL * clamp(0.8 + 0.4 * big, 0.0, 1.0));
  }
  // конвективные башни из глубины: стены «облачного каньона»
  if (u_deck2.z > 0.0){
    float tw = smoothstep(0.1, 0.55, big + 0.3 * snoise(vec3(q * 2.3, 5.0)));
    float top = mix(u_deck2.y, u_deck.y + 0.5, tw);
    float base = u_deck2.y > u_deck2.x ? u_deck2.x : u_deck.x;
    d = max(d, smoothstep(top, top - 0.3, hn) * smoothstep(base, base + 0.2, hn) * tw * u_deck2.z);
  }
  if (d < 0.03) return 0.0;
  // клубящиеся края (кучевые) / волокна (перистые, вытянутые ветром)
  // частота по высоте — та же, что по горизонтали (в км), иначе клубы вытягиваются в вертикальные «занавеси»
  vec3 r = vec3(q * vec2(5.0, 5.0 * (1.0 + u_deck2.w)), hn * 4.5 / u_deck.w * (1.0 + 0.5 * u_deck2.w) + u_t * 0.004);
  float e = fine ? fbm(r, 3) : snoise(r);
  return clamp((d - 0.35 - 0.45 * e) * 2.2, 0.0, 1.0);
}
// потоки конденсата: тонкие пряди, вытянутые и несущиеся по ветру втрое быстрее облаков, в слое у высоты камеры
float wispD(vec3 p, float hn){
  if (u_wisp <= 0.0) return 0.0;
  // слой тоньше 0,1 H под камерой, пряди — не ближе 0,3 H (вблизи их растянула бы перспектива в «лучи»)
  float dz = hn - u_alt / u_H + 0.15;
  float band = exp(-dz * dz * 300.0) * smoothstep(0.3 * u_H, 1.5 * u_H, length(p.xy));
  if (band < 0.05) return 0.0;
  vec2 q = (p.xy + u_wind * 3.0) / u_H;
  float s = snoise(vec3(q.x * 1.2, q.y * 12.0, hn * 6.0 + u_t * 0.02));
  return smoothstep(0.72, 0.95, s) * band * u_wisp;
}
// небо над облаками (и отражение в океане)
vec3 skyCol(vec3 rd, float h0, out vec3 Tsp){
  float mu = rd.z;
  float od = u_tau0 * exp(-max(h0, -3.0) * 0.9) / max(mu + 0.12, 0.08);
  Tsp = exp(-od * u_ext);
  float ms = dot(rd, u_sunL);
  float day = smoothstep(-0.2, 0.08, u_sunL.z);
  vec3 sc = (u_skyC * 0.0597 * (1.0 + ms * ms) * 3.0 + u_haze * min(hgP(ms, 0.65), 2.5) * 0.8) * (1.0 - Tsp);
  vec3 amb = (u_skyC * 0.6 + u_haze * 0.4) * 0.12 * (1.0 - Tsp);
  return (sc * day + amb * (0.15 + 0.85 * day)) * u_sunE;
}
float waveH(vec2 w, float foot, out vec2 grad){
  float h = 0.0; grad = vec2(0.0);
  float lam = 60.0, A = 1.1;
  for (int i = 0; i < 5 + u_zero; i++){
    float k = smoothstep(lam * 1.2, lam * 0.3, foot);
    if (k < 0.01) break;
    vec2 dir = vec2(cos(float(i) * 1.7), sin(float(i) * 1.7));
    vec3 s = vec3(w / lam + dir * u_t * 1.2 / sqrt(lam), float(i) * 3.1);
    float n0 = snoise(s), e = 0.05;
    float nx = snoise(s + vec3(e, 0.0, 0.0)), ny = snoise(s + vec3(0.0, e, 0.0));
    h += A * n0 * k;
    grad += A * k * vec2(nx - n0, ny - n0) / (e * lam);
    lam *= 0.38; A *= 0.42;
  }
  return h;
}
void main(){
  vec3 rd = u_probe.w > 0.5 ? u_probe.xyz : normalize(u_w2l * rayDir());
  PC = vec3(0.0, 0.0, -(u_R + u_alt));
  float H = u_H;
  // сдвиг начала шагов — Interleaved Gradient Noise (Хименес, 2014): равномерно распределённый по экрану шум без
  // «комков» белого шума; небольшая (30 %) случайная примесь ломает его регулярность — иначе на тонкой кромке
  // облачного «океана» оставался муар («вельвет»). После размытия 3×3 в композите — гладко, без зерна
  float ign = u_probe.w > 0.5 ? 0.5 : fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + 0.3 * hash12(gl_FragCoord.xy * 1.37 + 17.0));
  bool liquid = u_style >= 3;
  // ---- куда упирается луч: поверхность (жидкие миры) или «бездна» под облаками ----
  vec2 hs = raySphere(vec3(0.0), rd, PC, u_R);
  float floorH = liquid ? 0.0 : (min(u_deck2.y > u_deck2.x ? u_deck2.x : u_deck.x, u_deck.x) - 0.6) * H;
  vec2 hf = raySphere(vec3(0.0), rd, PC, u_R + floorH);
  float tFloor = hf.x > 0.0 && hf.x < hf.y ? hf.x : (u_alt < floorH ? 0.0 : 1e9);
  // слой облаков
  float lo = liquid ? max(u_deck.x * H, 0.0) : floorH, hi = (u_deck.y + 0.6) * H;
  vec2 ho = raySphere(vec3(0.0), rd, PC, u_R + hi);
  float t0 = u_alt > hi ? max(ho.x, 0.0) : 0.0;
  float t1 = min(u_alt > hi ? (ho.x > 0.0 ? ho.y : -1.0) : max(ho.y, 0.0), tFloor);
  t1 = min(t1, 90.0 * H);
  vec3 In = vec3(0.0), Tr = vec3(1.0);
  float day = smoothstep(-0.2, 0.08, u_sunL.z);
  vec3 skyAmb = (u_skyC * 0.55 + u_haze * 0.45) * u_sunE * (0.05 + 0.2 * day);
  float msun = dot(rd, u_sunL);
  float phC = mix(hgP(msun, 0.65), hgP(msun, -0.25), 0.35) + 0.04;
  float phH = mix(hgP(msun, 0.72), 0.0597 * (1.0 + msun * msun), 0.4);
  if (t1 > t0 && u_deck.z > -0.5){
    int N = u_steps;
    float L = t1 - t0;
    for (int i = 0; i < 96 + u_zero; i++){
      if (i >= N) break;
      float s0 = float(i) / float(N), s1 = (float(i) + 1.0) / float(N), sm = (float(i) + ign) / float(N);
      float tA = t0 + L * s0 * s0, tB = t0 + L * s1 * s1, t = t0 + L * sm * sm;
      float ds = tB - tA;
      vec3 p = rd * t;
      float hn;
      float d = cloudD(p, t < 25.0 * H, hn);
      d = max(d, wispD(p, hn));
      // дымка между облаками: экспоненциальная по высоте
      float hz = u_hazeK / H * exp(-hn * 0.9);
      if (d > 0.0 || hz * ds > 1e-4){
        // свет звезды в точке: тень облаков выше (1–2 пробы) и тень планеты
        vec3 up = normalize(p - PC);
        float sh = smoothstep(-0.12, 0.05, dot(up, u_sunL));
        float od = 0.0, hq;
        if (d > 0.0){
          od += cloudD(p + u_sunL * 0.3 * H, false, hq) * 0.3;
          if (u_lightN > 1) od += cloudD(p + u_sunL * 1.0 * H, false, hq) * 0.7;
        }
        float tauS = u_tau0 * exp(-hn * 0.9) / max(dot(up, u_sunL) + 0.12, 0.08);
        vec3 Ls = u_sunE * sh * exp(-od * 9.0 - tauS * u_ext);
        float hk = clamp((hn - (u_deck2.y > u_deck2.x ? u_deck2.x : u_deck.x)) / max(u_deck.y + 0.5 - u_deck2.x, 0.3), 0.0, 1.0);
        vec3 alb = mix(mix(u_c3, u_c1, smoothstep(0.0, 0.45, hk)), u_c2, smoothstep(0.45, 1.0, hk));
        vec3 em = vec3(0.0);
        // молнии в глубине облачных провалов
        for (int k = 0; k < 3 + u_zero; k++){
          if (u_fl[k].w <= 0.0) continue;
          vec3 dv = p - u_fl[k].xyz;
          em += vec3(0.75, 0.85, 1.0) * u_fl[k].w / (1.0 + dot(dv, dv) / (0.25 * H * H));
        }
        // тепловое свечение раскалённых глубин (горячий юпитер)
        if (u_glow > 0.0) em += vec3(1.0, 0.32, 0.08) * u_glow * smoothstep(0.3, -1.5, hn);
        float sc = d * 22.0 / H;                      // коэффициент рассеяния облака, 1/км
        // «серебряная кайма»: тонкие края облаков против звезды просвечивают золотом (рассеяние вперёд)
        vec3 silver = Ls * vec3(1.0, 0.8, 0.5) * pow(max(msun, 0.0), 6.0) * exp(-od * 1.5) * d * (1.0 - d) * 10.0;
        vec3 S = (Ls * phC * (1.0 + 2.0 * exp(-od * 3.0) * (1.0 - exp(-d * 4.0))) + silver + skyAmb * (0.25 + 0.75 * hk) + em) * alb * sc
               + (Ls * phH + skyAmb * 0.5 + em * 0.3) * u_haze * hz;
        vec3 ext = vec3(sc) + hz * u_ext;
        vec3 tr = exp(-ext * ds);
        In += Tr * S * (1.0 - tr) / max(ext, vec3(1e-6));
        Tr *= tr;
        if (max(Tr.r, max(Tr.g, Tr.b)) < 0.01) break;
      }
    }
  }
  bool hitFloor = tFloor < 1e8 && t1 >= tFloor - 1e-3;
  if (max(Tr.r, max(Tr.g, Tr.b)) >= 0.01){
    if (liquid && hs.x > 0.0 && hs.x < hs.y){
      // ---- жидкая поверхность ----
      float ts = hs.x;
      vec3 p = rd * ts;
      vec2 w = p.xy * 1000.0;
      float foot = ts * 1000.0 * u_pixAng / max(abs(rd.z), 0.03);
      vec3 up = normalize(p - PC);
      vec3 Ls = u_sunE * exp(-u_tau0 / max(u_sunL.z + 0.12, 0.08) * u_ext) * smoothstep(-0.05, 0.05, u_sunL.z);
      vec3 col;
      if (u_style == 4){
        vec2 g; float hW = waveH(w, foot, g);
        vec3 n = normalize(up + vec3(-g, 0.0) * 0.9);
        vec3 rr = reflect(rd, n);
        rr.z = abs(rr.z);
        float cosI = clamp(dot(-rd, n), 0.0, 1.0);
        float F = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);
        vec3 Ts; vec3 sk = skyCol(rr, u_alt / H, Ts);
        // шероховатость растёт с размером пикселя (неразрешённые мелкие волны): дорожка вытягивается к горизонту
        float rough = clamp(0.03 + foot * 0.0015, 0.03, 0.18);
        float sp = min(pow(max(dot(rr, u_sunL), 0.0), 2.0 / (rough * rough)) / (rough * rough) * 0.012, 40.0);
        vec3 body = vec3(0.004, 0.025, 0.035) * (skyAmb * 4.0 + Ls * max(u_sunL.z, 0.0) * 0.4);
        float foam = smoothstep(0.9, 1.4, hW) * 0.5;
        col = mix(body, sk, F) + Ls * sp * (0.3 + F) + foam * (Ls * max(u_sunL.z, 0.0) + skyAmb) * 0.6;
      } else {
        // океан магмы: дрейфующие плиты чёрного базальта, светящиеся трещины и открытые разводья
        vec3 wq = vec3((w + u_wind * 1000.0) / 45.0, u_t * 0.03);
        vec2 F = worley(wq);
        float edge = F.y - F.x;
        // ширина трещины не меньше пикселя (вдали — тонкая сетка без мерцания)
        float cw = max(0.035, foot / 45.0 * 1.2);
        float crack = (1.0 - smoothstep(0.0, cw, edge)) * min(1.0, 0.035 / cw * 1.6);
        float open = smoothstep(0.42, 0.62, fbm(vec3(w / 380.0, u_t * 0.01), 3));
        float molten = max(crack, open);
        float pulse = 0.75 + 0.25 * snoise(vec3(w / 30.0, u_t * 0.4));
        vec3 hot = mix(vec3(1.0, 0.22, 0.03), vec3(1.0, 0.72, 0.28), smoothstep(0.3, 1.0, pulse * molten));
        vec3 plate = vec3(0.018, 0.016, 0.015) * (0.7 + 0.3 * snoise(vec3(w / 6.0, 1.0)));
        float rim = smoothstep(0.12, 0.0, edge) * (1.0 - crack);
        col = plate * (Ls * max(u_sunL.z, 0.0) + skyAmb * 2.0) + vec3(0.6, 0.1, 0.02) * rim * u_glow * 0.5;
        col = mix(col, hot * u_glow * 2.5 * pulse, molten);
        // глянец расплава: отражение звезды
        float spm = pow(max(dot(reflect(rd, up), u_sunL), 0.0), 80.0) * 2.0;
        col += Ls * spm * molten * 0.3;
      }
      // воздушная перспектива до поверхности (за облаками) — уже учтена дымкой; добавляем «дымку дали»
      float fogD = 1.0 - exp(-ts / (u_style == 3 ? 25.0 : 70.0));
      vec3 Tf; vec3 skH = skyCol(normalize(vec3(rd.xy, 0.02)), u_alt / H, Tf);
      col = mix(col, skH + u_haze * u_glow * 0.25 * float(u_style == 3), fogD);
      In += Tr * col;
      Tr = vec3(0.0);
    } else if (hitFloor && !liquid){
      // ---- «бездна»: глубокие слои облаков, тусклые, подсвечены молниями и жаром недр ----
      vec3 p = rd * tFloor;
      vec3 em = vec3(0.0);
      for (int k = 0; k < 3 + u_zero; k++){ vec3 dv = p - u_fl[k].xyz; em += vec3(0.75, 0.85, 1.0) * max(u_fl[k].w, 0.0) / (1.0 + dot(dv, dv) / (0.6 * H * H)) * 0.5; }
      In += Tr * (u_c3 * (skyAmb * 0.35 + em) + vec3(1.0, 0.3, 0.07) * u_glow * 1.2);
      Tr = vec3(0.0);
    } else {
      // ---- небо: рассеяние над облаками и пропускание к космосу ----
      vec3 Tsp; vec3 sk = skyCol(rd, max(u_alt, (u_deck.y + 0.6) * H * float(u_alt < hi)) / H, Tsp);
      // ниже горизонта планеты (луч упёрся бы в неё): кольца и космос не видны
      float below = hs.x > 0.0 && hs.x < hs.y ? 1.0 : 0.0;
      In += Tr * sk;
      // кольца: гигантская дуга над дымкой (тень планеты на кольцах — по направлению на звезду)
      if (u_ring.w > 0.5 && below < 0.5){
        float den = dot(rd, u_ringN);
        if (abs(den) > 1e-5){
          float tr = dot(PC, u_ringN) / den;
          if (tr > 0.0){
            vec3 qp = rd * tr - PC;
            float rr = length(qp) / u_R;
            if (rr > u_ring.x && rr < u_ring.y){
              float x = (rr - u_ring.x) / (u_ring.y - u_ring.x);
              float a = u_ring.z * (0.45 + 0.4 * snoise(vec3(rr * 60.0, 1.0, 2.0)) * 0.5 + 0.3 * snoise(vec3(rr * 220.0, 4.0, 1.0)) * 0.5);
              a *= smoothstep(0.0, 0.04, x) * smoothstep(1.0, 0.93, x);
              a *= 1.0 - 0.85 * exp(-pow((x - 0.62) / 0.025, 2.0));        // щель (как деление Кассини)
              a = clamp(a, 0.0, 0.95);
              float ps = dot(qp, u_sunL);
              float shadow = ps < 0.0 && length(qp - u_sunL * ps) < u_R ? 0.04 : 1.0;
              vec3 rc = u_ringC * u_sunE * 1.1 * shadow * (0.35 + 0.65 * sqrt(abs(dot(u_sunL, u_ringN))));
              In += Tr * Tsp * rc * a;
              Tsp *= 1.0 - a;
            }
          }
        }
      }
      Tr *= Tsp * (1.0 - below);
    }
  }
  oIn = vec4(In, 1.0);
  oT = vec4(Tr, 1.0);
}`;

  // композит прохода атмосферы: плавное включение (на подлёте видна обычная планета)
  G.aeroCompFS = G.header + `
in vec2 v_uv;
uniform sampler2D u_src, u_skyIn, u_skyT;
uniform float u_veil, u_mixK, u_blur;
out vec4 o;
void main(){
  vec3 s = texture(u_src, v_uv).rgb;
  vec3 T = vec3(0.0), In = vec3(0.0);
  // Сдвиг шагов трассировки — Interleaved Gradient Noise: в любом окне 3×3 соседних текселей его значения
  // распределены почти равномерно, поэтому равномерное среднее 3×3 (шаг ровно 1 тексель) гасит и зерно, и муар
  vec2 px = u_blur / vec2(textureSize(u_skyIn, 0));
  float ws = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    float w = 1.0;
    vec2 uv = v_uv + vec2(float(x), float(y)) * px;
    In += texture(u_skyIn, uv).rgb * w; T += texture(u_skyT, uv).rgb * w; ws += w;
  }
  In /= ws; T /= ws;
  float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
  // дневная вуаль гасит тусклые звёзды, но не освещённые серпы соседних планет системы и яркие светила
  float veil = mix(u_veil, 1.0, smoothstep(0.3, 2.5, l));
  o = vec4(mix(s, s * T * veil + In, u_mixK), 1.0);
}`;
})();
