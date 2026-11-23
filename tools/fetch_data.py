# -*- coding: utf-8 -*-
"""
Загрузка реальных данных для планетария (запускается один раз; затем всё работает офлайн).

  1. Панорама Млечного Пути 360x180 в галактических координатах
     (ESO / Serge Brunier, eso0932a, CC BY 4.0; запасной вариант — NASA SVS Deep Star Maps 2020).
  2. Звёздный каталог HYG (Hipparcos + Yale BSC + Gliese) — звёзды ярче 7.5m.
  3. OpenNGC — все 110 объектов Мессье и крупнейшие объекты NGC/IC.
  4. Карты поверхностей планет и спутников (Solar System Scope CC BY 4.0, NASA/USGS, New Horizons):
     python tools/fetch_data.py tex            — все карты
     python tools/fetch_data.py tex mars pluto — только выбранные

Результат — JS-файлы в js/data/ (подключаются <script>, поэтому работают даже с file://)
и исходники в assets/.

Запуск:  python tools/fetch_data.py
"""
import base64, csv, gzip, io, json, math, os, re, sys, time
import requests
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'assets')
DATA = os.path.join(ROOT, 'js', 'data')
os.makedirs(ASSETS, exist_ok=True)
UA = {'User-Agent': 'milkyway-planetarium-data-fetcher/1.0'}


def get(url, binary=True, timeout=120):
    print('  GET', url, flush=True)
    r = requests.get(url, headers=UA, timeout=timeout)
    r.raise_for_status()
    return r.content if binary else r.text


def github_find(repo, branch, pattern):
    """Ищет файл в репозитории по регулярному выражению (на случай смены структуры папок)."""
    try:
        tree = requests.get(f'https://api.github.com/repos/{repo}/git/trees/{branch}?recursive=1', headers=UA, timeout=60).json()
        paths = [t['path'] for t in tree.get('tree', []) if re.search(pattern, t['path'])]
        return [f'https://raw.githubusercontent.com/{repo}/{branch}/{p}' for p in sorted(paths, reverse=True)]
    except Exception as e:  # noqa
        print('  github api:', e)
        return []


# ------------------------------------------------------------------ 1. панорама
def fetch_panorama():
    out_jpg = os.path.join(ASSETS, 'milkyway_panorama.jpg')
    sources = [
        ('https://cdn.eso.org/images/large/eso0932a.jpg', 'ESO/S. Brunier — The Milky Way panorama (eso0932a), CC BY 4.0', 'galactic'),
    ]
    img = None
    credit = None
    for url, cr, frame in sources:
        try:
            raw = get(url)
            img = Image.open(io.BytesIO(raw)).convert('RGB')
            credit = cr
            break
        except Exception as e:
            print('  не удалось:', e)
    if img is None:
        # запасной вариант: NASA SVS Deep Star Maps 2020 (галактическая версия)
        try:
            html = get('https://svs.gsfc.nasa.gov/4851', binary=False)
            links = re.findall(r'href="([^"]*starmap_2020_(?:8k|4k)_gal[^"]*\.(?:jpg|png|tif))"', html)
            for l in links:
                url = l if l.startswith('http') else 'https://svs.gsfc.nasa.gov' + l
                try:
                    img = Image.open(io.BytesIO(get(url))).convert('RGB')
                    credit = 'NASA/Goddard Space Flight Center Scientific Visualization Studio — Deep Star Maps 2020'
                    break
                except Exception as e:
                    print('  не удалось:', e)
        except Exception as e:
            print('  NASA SVS:', e)
    if img is None:
        print('!! Панорама не загружена — останется процедурное небо.')
        return None
    w, h = img.size
    print(f'  панорама {w}x{h}')
    if w != 2 * h:  # приводим к строгому 2:1 (360x180)
        img = img.resize((w, w // 2), Image.LANCZOS)
    if img.size[0] > 8192:
        img = img.resize((8192, 4096), Image.LANCZOS)
    img.save(out_jpg, quality=92)
    b64 = base64.b64encode(open(out_jpg, 'rb').read()).decode('ascii')
    with open(os.path.join(DATA, 'sky_panorama.js'), 'w', encoding='utf-8') as f:
        f.write("'use strict';\n/* Панорама неба в галактических координатах (центр кадра = центр Галактики, l растёт влево).\n"
                f"   Источник: {credit}. Сгенерировано tools/fetch_data.py */\n")
        f.write('window.MW = window.MW || {};\nMW.skyPanorama = { credit: ' + json.dumps(credit, ensure_ascii=False) +
                ', width: %d, height: %d, url: "data:image/jpeg;base64,' % img.size + b64 + '" };\n')
    print(f'  -> js/data/sky_panorama.js ({len(b64) / 1e6:.1f} МБ base64)')
    return credit


# ------------------------------------------------------------------ 2. HYG
def fetch_hyg(maglim=None):
    """maglim=None — полный каталог (~119 000 звёзд с известным расстоянием)."""
    cands = github_find('astronexus/HYG-Database', 'main', r'hyg(data)?_v\d+\.csv(\.gz)?$')
    cands += ['https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv',
              'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/v3/hyg_v38.csv.gz',
              'https://raw.githubusercontent.com/astronexus/HYG-Database/master/hygdata_v3.csv']
    text = None
    for url in cands:
        try:
            raw = get(url)
            text = gzip.decompress(raw).decode('utf-8') if url.endswith('.gz') else raw.decode('utf-8')
            src = url
            break
        except Exception as e:
            print('  не удалось:', e)
    if text is None:
        print('!! HYG не загружен')
        return 0
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        try:
            mag = float(r['mag'])
            dist_pc = float(r['dist'])
        except (ValueError, KeyError):
            continue
        if (maglim is not None and mag > maglim) or dist_pc <= 0 or r.get('proper') == 'Sol':
            continue
        if dist_pc >= 99999:  # неизвестное расстояние
            continue
        ci = r.get('ci') or ''
        rows.append([
            round(float(r['ra']), 5), round(float(r['dec']), 4), round(dist_pc * 3.26156, 2), round(mag, 2),
            round(float(r['absmag']), 2), float(ci) if ci not in ('', None) else None, r.get('spect') or '',
            r.get('proper') or '', (r.get('bf') or '').strip(), r.get('hd') or '', r.get('hip') or '', r.get('hr') or '',
            r.get('con') or '', round(float(r.get('lum') or 0), 3), (r.get('var') or '').strip(),
            (r.get('base') or '').strip(), (r.get('gl') or '').strip(),
        ])
    rows.sort(key=lambda x: x[3])
    with open(os.path.join(DATA, 'hyg_stars.js'), 'w', encoding='utf-8') as f:
        f.write("'use strict';\n/* Каталог HYG (CC BY-SA 4.0, astronexus/HYG-Database): %s. Источник: %s */\n" % ('все звёзды с известным расстоянием' if maglim is None else 'звёзды ярче %.1fm' % maglim, src))
        f.write('window.MW = window.MW || {};\nMW.hyg = { fields: ["ra","dec","distLy","mag","absMag","ci","spect","proper","bf","hd","hip","hr","con","lum","var","base","gl"], rows: ')
        json.dump(rows, f, ensure_ascii=False, separators=(',', ':'))
        f.write(' };\n')
    print(f'  -> js/data/hyg_stars.js: {len(rows)} звёзд')
    return len(rows)


# ------------------------------------------------------------------ 3. OpenNGC: Мессье + NGC/IC
# расстояния объектов Мессье (тыс. св. лет) — справочные значения
M_DIST = {1: 6.5, 2: 37.5, 3: 33.9, 4: 7.2, 5: 24.5, 6: 1.6, 7: 0.98, 8: 4.1, 9: 25.8, 10: 14.3, 11: 6.2, 12: 15.7, 13: 22.2,
          14: 30.3, 15: 33.6, 16: 7.0, 17: 5.5, 18: 4.9, 19: 28.7, 20: 4.1, 21: 4.25, 22: 10.6, 23: 2.15, 24: 10.0, 25: 2.0,
          26: 5.0, 27: 1.36, 28: 17.9, 29: 4.0, 30: 26.1, 31: 2537, 32: 2490, 33: 2730, 34: 1.5, 35: 2.8, 36: 4.1, 37: 4.5,
          38: 4.2, 39: 1.0, 40: 0.51, 41: 2.3, 42: 1.344, 43: 1.6, 44: 0.577, 45: 0.444, 46: 5.4, 47: 1.6, 48: 1.5,
          49: 56000, 50: 3.2, 51: 23000, 52: 5.0, 53: 58.0, 54: 87.4, 55: 17.6, 56: 32.9, 57: 2.3, 58: 62000, 59: 60000,
          60: 57000, 61: 52500, 62: 22.5, 63: 29300, 64: 17300, 65: 35000, 66: 36000, 67: 2.7, 68: 33.3, 69: 29.7, 70: 29.3,
          71: 13.0, 72: 55.4, 73: 2.5, 74: 32000, 75: 67.5, 76: 2.5, 77: 47000, 78: 1.35, 79: 41.0, 80: 32.6, 81: 11800,
          82: 11500, 83: 15000, 84: 60000, 85: 60000, 86: 52000, 87: 53500, 88: 47000, 89: 50000, 90: 58700, 91: 63000,
          92: 26.7, 93: 3.6, 94: 16000, 95: 32600, 96: 31000, 97: 2.03, 98: 44400, 99: 50200, 100: 55000, 101: 20900,
          102: 50000, 103: 8.5, 104: 29300, 105: 32000, 106: 23700, 107: 20.9, 108: 45000, 109: 83500, 110: 2690}
VIS = {'OCl': 'cluster', '*Ass': 'cluster', 'Cl+N': 'cluster', 'GCl': 'globular', 'PN': 'planetary', 'SNR': 'snr',
       'HII': 'nebula', 'EmN': 'nebula', 'Neb': 'nebula', 'RfN': 'nebula', 'G': 'galaxy', 'GPair': 'galaxy', 'GTrpl': 'galaxy', 'GGroup': 'galaxy'}
EST = {'cluster': 4000, 'globular': 35000, 'planetary': 3000, 'snr': 6000, 'nebula': 4000}


def hms(s, deg=False):
    s = s.strip()
    if not s:
        return None
    sg = -1 if s[0] == '-' else 1
    p = [float(x) for x in s.lstrip('+-').split(':')]
    v = p[0] + (p[1] if len(p) > 1 else 0) / 60 + (p[2] if len(p) > 2 else 0) / 3600
    return sg * v



def fnum(v):
    try:
        return float(v) if v not in (None, '') else None
    except ValueError:
        return None


def comoving_ly(z, H0=67.7, Om=0.31):
    """Сопутствующее расстояние (плоская ΛCDM) в световых годах — численный интеграл."""
    n = 2000
    s = 0.0
    for i in range(n):
        zi = (i + 0.5) * z / n
        s += 1.0 / math.sqrt(Om * (1 + zi) ** 3 + (1 - Om))
    dc_mpc = 299792.458 / H0 * s * z / n
    return dc_mpc * 3.26156e6


def fetch_pulsars():
    """ATNF Pulsar Catalogue (Manchester et al. 2005): координаты, периоды, расстояния, типы."""
    import tarfile
    url = 'https://www.atnf.csiro.au/research/pulsar/psrcat/downloads/psrcat_pkg.tar.gz'
    raw = get(url)
    tf = tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz')
    m = [x for x in tf.getmembers() if x.name.endswith('psrcat.db')][0]
    text = tf.extractfile(m).read().decode('latin-1')
    out = []
    for rec in re.split(r'^@.*$', text, flags=re.M):
        f = {}
        for ln in rec.splitlines():
            if not ln or ln[0] == '#':
                continue
            parts = ln.split()
            if len(parts) >= 2 and parts[0] not in f:
                f[parts[0]] = parts[1]
        if 'PSRJ' not in f or 'RAJ' not in f or 'DECJ' not in f:
            continue
        try:
            ra = hms(f['RAJ'])
            dec = hms(f['DECJ'])
        except ValueError:
            continue
        P = fnum(f.get('P0'))
        if P is None and fnum(f.get('F0')):
            P = 1.0 / fnum(f.get('F0'))
        if P is None:
            continue
        est = 0
        d = fnum(f.get('DIST_A'))
        px = fnum(f.get('PX'))
        if d is None and px and px > 0.05:
            d = 1.0 / px
        if d is None:
            dm = fnum(f.get('DM'))
            d = min(dm / 30.0, 25.0) if dm else 3.0       # грубая оценка: средняя nₑ ≈ 0,03 см⁻³
            est = 1
        typ = f.get('TYPE', '')
        assoc = f.get('ASSOC', '')
        snr = re.search(r'SNR:([^,\[]+)', assoc)
        gc = re.search(r'GC:([^,\[]+)', assoc)
        o = {'j': f['PSRJ'], 'ra': round(ra, 6), 'dec': round(dec, 5), 'p': P, 'd': round(d * 3261.56, 1)}
        if f.get('PSRB'):
            o['b'] = f['PSRB']
        if 'AXP' in typ:
            o['t'] = 'magnetar'
        elif P < 0.03:
            o['t'] = 'msp'
        if f.get('BINARY'):
            o['bin'] = 1
        if snr:
            o['snr'] = snr.group(1)
        if gc:
            o['gc'] = gc.group(1)
        if est:
            o['est'] = 1
        out.append(o)
    with open(os.path.join(DATA, 'pulsars.js'), 'w', encoding='utf-8') as fh:
        fh.write("'use strict';\n/* ATNF Pulsar Catalogue (Manchester et al. 2005, AJ 129, 1993). p — период, с; d — расстояние, св. лет\n"
                 "   (DIST_A или параллакс; est=1 — грубая оценка по мере дисперсии). t: msp — миллисекундный, magnetar — AXP. */\n")
        fh.write('window.MW = window.MW || {};\nMW.pulsarsATNF = ')
        json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
        fh.write(';\n')
    print('  пульсаров:', len(out))
    return len(out)

def fetch_ngc():
    files = {}
    for name in ('NGC.csv', 'addendum.csv'):
        cands = [f'https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/{name}',
                 f'https://raw.githubusercontent.com/mattiaverga/OpenNGC/main/database_files/{name}']
        cands += github_find('mattiaverga/OpenNGC', 'master', re.escape(name) + '$')
        for url in cands:
            try:
                files[name] = get(url, binary=False)
                break
            except Exception as e:
                print('  не удалось:', e)
    if 'NGC.csv' not in files:
        print('!! OpenNGC не загружен')
        return 0
    objs, seenM = [], {}
    for name, text in files.items():
        for r in csv.DictReader(io.StringIO(text), delimiter=';'):
            t = r.get('Type', '')
            m = (r.get('M') or '').strip()
            mnum = int(m) if m.isdigit() else None
            if t in ('Dup', 'NonEx') and not mnum:
                continue
            ra, dec = hms(r.get('RA', '')), hms(r.get('Dec', ''))
            if ra is None or dec is None:
                continue
            vis = VIS.get(t)
            if mnum is None and vis is None:
                continue
            # в OpenNGC V-величина иногда занижена (напр. NGC 253) — берём более яркую из V и B
            mags = []
            for k in ('V-Mag', 'B-Mag'):
                try:
                    mags.append(float(r.get(k) or ''))
                except ValueError:
                    pass
            vmag = min(mags) if mags else None
            try:
                maj = float(r.get('MajAx') or 0)
            except ValueError:
                maj = 0
            sel = True
            if mnum is None:  # крупнейшие/ярчайшие NGC/IC получают детальные 3D-модели, остальные — лёгкий рендер
                lim = 10.5 if vis == 'galaxy' else 9.0
                sel = bool((vmag is not None and vmag <= lim) or (vis in ('nebula', 'snr') and maj >= 30))
            if mnum and mnum in seenM and t == 'Dup':
                continue
            common = (r.get('Common names') or '').split(',')[0].strip()
            hubble = (r.get('Hubble') or '').strip()
            if mnum:
                dist = M_DIST.get(mnum, 5.0) * 1000
                est = False
                if vis is None:
                    vis = 'cluster' if mnum in (24, 40, 73) else 'nebula'
            elif vis == 'galaxy':
                # по красному смещению (сопутствующее расстояние, ΛCDM); у близких — пекулярные скорости, берём оценку по блеску
                zz = fnum(r.get('Redshift'))
                dmag = 3.26156 * 10 ** (((vmag if vmag is not None else 13) + 20.5 + 5) / 5)
                if zz is not None and zz > 0.004:
                    dist = comoving_ly(zz)
                    est = False
                else:
                    dist = dmag
                    est = True
            else:
                dist = EST[vis]
                est = True
            radius = max(dist * math.tan(math.radians(max(maj, 1.0) / 60 / 2)), 0.3)
            o = {'n': r['Name'], 'm': mnum, 'type': t, 'vis': vis, 'ra': round(ra, 5), 'dec': round(dec, 4), 'dist': round(dist, 1),
                 'r': round(radius, 2), 'mag': vmag, 'maj': maj, 'con': r.get('Const', ''), 'common': common, 'hubble': hubble,
                 'est': est, 'ids': (r.get('Identifiers') or '')[:80]}
            mi = fnum(r.get('MinAx'))
            if maj and mi:
                o['ba'] = round(min(mi / maj, 1.0), 3)
            pa = fnum(r.get('PosAng'))
            if pa is not None:
                o['pa'] = pa
            zz = fnum(r.get('Redshift'))
            if zz is not None:
                o['z'] = zz
            if not sel:
                o['lite'] = 1
                del o['ids']
            if mnum:
                prev = seenM.get(mnum)
                if prev is not None:
                    continue
                seenM[mnum] = o
            objs.append(o)
    objs.sort(key=lambda o: (o['m'] is None, o['m'] or 0, o['mag'] if o['mag'] is not None else 99))
    with open(os.path.join(DATA, 'dso_ext.js'), 'w', encoding='utf-8') as f:
        f.write("'use strict';\n/* OpenNGC (CC BY-SA 4.0, mattiaverga/OpenNGC): полный каталог NGC/IC + Мессье (без звёзд и дубликатов).\n"
                "   Расстояния Мессье — справочные; галактик — по красному смещению (сопутствующее расстояние,\n"
                "   ΛCDM H0=67.7, Ωm=0.31); для прочих (est=true) — оценка по типу/блеску.\n"
                "   lite=1 — объект без детальной 3D-модели (рисуется инстансным рендером своего класса). */\n")
        f.write('window.MW = window.MW || {};\nMW.dsoExt = ')
        json.dump(objs, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    nm = len([o for o in objs if o['m']])
    print(f'  -> js/data/dso_ext.js: {len(objs)} объектов (Мессье: {nm})')
    return len(objs)


# ------------------------------------------------------------------ 4. NASA Exoplanet Archive
def fetch_exoplanets():
    """Все подтверждённые экзопланеты: таблица Planetary Systems Composite Parameters (pscomppars) через TAP."""
    cols = ('pl_name,hostname,hd_name,hip_name,ra,dec,sy_dist,sy_vmag,sy_snum,sy_pnum,pl_orbsmax,pl_orbper,pl_orbeccen,'
            'pl_bmasse,pl_rade,pl_eqt,pl_insol,st_spectype,st_teff,st_rad,st_mass,st_lum,disc_year,discoverymethod')
    try:
        print('  GET NASA Exoplanet Archive TAP (pscomppars)')
        r = requests.get('https://exoplanetarchive.ipac.caltech.edu/TAP/sync', headers=UA, timeout=300,
                         params={'query': f'select {cols} from pscomppars', 'format': 'csv'})
        r.raise_for_status()
        text = r.text
    except Exception as e:
        print('!! NASA Exoplanet Archive недоступен:', e)
        return 0

    def num(v, nd=4):
        try:
            x = float(v)
            return round(x, nd) if math.isfinite(x) else None
        except (TypeError, ValueError):
            return None
    hosts = {}
    for r in csv.DictReader(io.StringIO(text)):
        h = r['hostname']
        H = hosts.setdefault(h, {
            'host': h, 'hd': (r.get('hd_name') or '').replace('HD ', '').strip(), 'hip': (r.get('hip_name') or '').replace('HIP ', '').strip(),
            'ra': num(r.get('ra'), 5), 'dec': num(r.get('dec'), 5), 'distPc': num(r.get('sy_dist'), 3), 'vmag': num(r.get('sy_vmag'), 2),
            'snum': num(r.get('sy_snum'), 0), 'spec': (r.get('st_spectype') or '').strip(), 'teff': num(r.get('st_teff'), 0),
            'rad': num(r.get('st_rad'), 3), 'mass': num(r.get('st_mass'), 3), 'loglum': num(r.get('st_lum'), 3), 'pl': []})
        H['pl'].append([r['pl_name'], num(r.get('pl_orbsmax'), 5), num(r.get('pl_orbper'), 4), num(r.get('pl_orbeccen'), 3),
                        num(r.get('pl_bmasse'), 3), num(r.get('pl_rade'), 3), num(r.get('pl_eqt'), 0), num(r.get('pl_insol'), 3),
                        num(r.get('disc_year'), 0), r.get('discoverymethod') or ''])
    for H in hosts.values():
        H['pl'].sort(key=lambda p: (p[1] if p[1] is not None else 1e9))
    arr = sorted(hosts.values(), key=lambda h: (h['distPc'] if h['distPc'] is not None else 1e9))
    npl = sum(len(h['pl']) for h in arr)
    with open(os.path.join(DATA, 'exoplanets_nasa.js'), 'w', encoding='utf-8') as f:
        f.write("'use strict';\n/* NASA Exoplanet Archive, таблица pscomppars (подтверждённые экзопланеты). Загружено %s.\n"
                "   pl: [имя, a (а.е.), P (сут), e, M (M⊕), R (R⊕), Teq (K), инсоляция (S⊕), год открытия, метод] */\n" % time.strftime('%Y-%m-%d'))
        f.write('window.MW = window.MW || {};\nMW.nasaExo = ')
        json.dump(arr, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    print(f'  -> js/data/exoplanets_nasa.js: {npl} планет у {len(arr)} звёзд')
    return npl


# ---------------------------------------------------------------------------------------------
#  Реальные карты поверхностей планет и спутников (равнопромежуточная проекция, долгота −180…180,
#  север сверху). Каждая карта упаковывается в js/data/tex/<id>.js как data:-URL — грузится по
#  требованию при подлёте к телу и работает даже с file://.
# ---------------------------------------------------------------------------------------------
SSS = 'https://www.solarsystemscope.com/textures/download/'
ALB = 'https://stevealbers.net/albers/sos/'
WMC = 'https://upload.wikimedia.org/wikipedia/commons/'
CR_SSS = 'Solar System Scope / INOVE (CC BY 4.0), по данным NASA'
TEXCACHE = os.path.join(ROOT, 'tools', '.texcache')
# Wikimedia требует описательный User-Agent (иначе запросы режутся ограничением частоты)
TEX_UA = {'User-Agent': 'MilkyWayPlanetarium/1.0 (offline planetarium texture script) python-requests/' + requests.__version__}
# id, ширина результата, источники (первый доступный), подпись, обработка
TEXTURES = [
    ('mercury', 4096, [SSS + '8k_mercury.jpg', SSS + '2k_mercury.jpg'], CR_SSS + ' — MESSENGER', None),
    ('venus', 2048, [SSS + '4k_venus_atmosphere.jpg', SSS + '2k_venus_atmosphere.jpg'], CR_SSS + ' — облачный покров', None),
    ('venus_surface', 2048, [SSS + '8k_venus_surface.jpg', SSS + '2k_venus_surface.jpg'], CR_SSS + ' — радарная карта Magellan', None),
    ('earth', 4096, [SSS + '8k_earth_daymap.jpg', SSS + '2k_earth_daymap.jpg'], CR_SSS + ' — NASA Blue Marble', None),
    ('earth_aux', 4096, None, CR_SSS + ' — облака, маска океанов, ночные огни (NASA Black Marble)', 'earth_aux'),
    ('earth_nrm', 2048, [SSS + '2k_earth_normal_map.tif'], CR_SSS + ' — рельеф (карта нормалей)', 'linear'),
    ('moon', 4096, [SSS + '8k_moon.jpg', SSS + '2k_moon.jpg'], CR_SSS + ' — LRO', None),
    ('mars', 4096, [SSS + '8k_mars.jpg', SSS + '2k_mars.jpg'], CR_SSS + ' — Viking/MGS', None),
    ('jupiter', 4096, [SSS + '8k_jupiter.jpg', SSS + '2k_jupiter.jpg'], CR_SSS + ' — Cassini/Juno', None),
    ('saturn', 4096, [SSS + '8k_saturn.jpg', SSS + '2k_saturn.jpg'], CR_SSS + ' — Cassini', None),
    ('saturn_ring', 4096, [SSS + '8k_saturn_ring_alpha.png', SSS + '2k_saturn_ring_alpha.png'], CR_SSS + ' — радиальный профиль колец', 'ring'),
    ('uranus', 1024, [SSS + '2k_uranus.jpg'], CR_SSS + ' — Voyager 2', None),
    ('neptune', 2048, [SSS + '2k_neptune.jpg'], CR_SSS + ' — Voyager 2', None),
    ('io', 2048, [ALB + 'jupiter/io/io_rgb_cyl.jpg'], 'NASA/JPL Galileo, Voyager; мозаика S. Albers (NOAA)', None),
    ('europa', 1024, [WMC + '2/26/Europa_Voyager_GalileoSSI_global_mosaic.jpg'], 'NASA/JPL/USGS — Voyager & Galileo SSI (общественное достояние)', None),
    ('ganymede', 1440, [WMC + 'b/b3/Ganymede_map_NASA_JPL_Voyager.jpg'], 'NASA/JPL/USGS — Voyager & Galileo (общественное достояние)', None),
    ('callisto', 1440, [WMC + 'b/b2/Callisto_map_NASA_JPL_Voyager.jpg'], 'NASA/JPL/USGS — Voyager & Galileo (общественное достояние)', None),
    ('titan', 2048, [ALB + 'saturn/titan/titan_rgb_cyl_www.jpg'], 'NASA/JPL/Space Science Institute — Cassini; мозаика S. Albers (NOAA)', None),
    ('enceladus', 2048, [ALB + 'saturn/enceladus/enceladus_rgb_cyl_www.jpg'], 'NASA/JPL/Space Science Institute — Cassini; мозаика S. Albers (NOAA)', None),
    ('triton', 2048, [ALB + 'neptune/triton/triton_rgb_cyl_www.jpg'], 'NASA/JPL — Voyager 2; мозаика S. Albers (NOAA)', None),
    ('pluto', 2048, [WMC + 'thumb/a/ad/Pluto_color_mapmosaic.jpg/3840px-Pluto_color_mapmosaic.jpg',
                     WMC + 'a/ad/Pluto_color_mapmosaic.jpg'], 'NASA/JHUAPL/SwRI — New Horizons (общественное достояние)', 'pluto'),
]


def get_cached(url):
    """Скачивает файл в tools/.texcache (повторный запуск не качает заново); при 429 ждёт и повторяет."""
    os.makedirs(TEXCACHE, exist_ok=True)
    fn = os.path.join(TEXCACHE, re.sub(r'[^A-Za-z0-9._-]', '_', url.split('/')[-1]))
    if os.path.exists(fn) and os.path.getsize(fn) > 1000:
        data = open(fn, 'rb').read()
        try:
            Image.open(io.BytesIO(data)).verify()
            return data
        except Exception:  # noqa — в кеше оказалась не картинка (например, страница ошибки) — качаем заново
            os.remove(fn)
    for attempt in range(5):
        print('  GET', url, flush=True)
        r = requests.get(url, headers=TEX_UA, timeout=300)
        if r.status_code == 429:
            time.sleep(10 * (attempt + 1)); continue
        r.raise_for_status()
        if 'image' not in r.headers.get('Content-Type', ''):
            raise RuntimeError('не изображение: ' + r.headers.get('Content-Type', ''))
        open(fn, 'wb').write(r.content)
        time.sleep(1.5)  # вежливая пауза между запросами
        return r.content
    raise RuntimeError('сервер ограничил частоту запросов')


def open_first(urls):
    err = None
    for u in urls:
        try:
            return Image.open(io.BytesIO(get_cached(u))), u
        except Exception as e:  # noqa
            err = e
            print('    ! ', e)
    raise RuntimeError(f'ни один источник не доступен: {err}')


def fill_unmapped(im):
    """Неотснятые районы (чёрные) — заполняем размытым продолжением соседних цветов, чтобы не было «дыр»."""
    import numpy as np
    a = np.asarray(im.convert('RGB')).astype(np.float32)
    mask = a.max(axis=2) < 10
    if not mask.any():
        return im
    h, w, _ = a.shape
    out = a.copy()
    for x in range(w):
        col = mask[:, x]
        if not col.any():
            continue
        valid = np.where(~col)[0]
        if len(valid) == 0:
            continue
        last = valid[-1]
        ref = a[max(0, last - 40):last + 1, x].mean(axis=0)
        for y in np.where(col)[0]:
            k = min(1.0, (y - last) / (0.25 * h)) if y > last else 0.5
            out[y, x] = ref * (1 - 0.35 * k) + np.array([150, 140, 130], np.float32) * 0.35 * k
    res = Image.fromarray(out.clip(0, 255).astype(np.uint8))
    # мягкое размытие только заполненной области
    from PIL import ImageFilter
    blur = res.filter(ImageFilter.GaussianBlur(6))
    m = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4))
    return Image.composite(blur, res, m)


# тела, у которых мозаики снимков неполные (Voyager/Galileo/New Horizons): для них строится маска неотснятых
# районов, где шейдер достраивает поверхность процедурно в палитре снятой стороны. Способ поиска — свой для карты:
#   число  — «гладкость»: нет деталей средних масштабов (порог — доля 75-го перцентиля энергии деталей);
#   bright — гладкая и светлая заливка (карты JPL Каллисто: неотснятое закрашено светло-серым);
#   black  — неотснятое было чёрным в исходнике (Плутон, New Horizons) — маска точная.
MOSAICS = {'europa': 0.5, 'ganymede': 0.6, 'callisto': 'bright', 'triton': 0.35, 'pluto': 'black'}


def mosaic_mask(im, mode, black=None):
    """Маска неотснятых районов (1 — нет данных) и палитра снятой стороны: тёмные и светлые тона (sRGB 0…1)."""
    import numpy as np
    from PIL import ImageFilter
    W, H = 1024, 512
    small = im.convert('RGB').resize((W, H), Image.LANCZOS)
    g = small.convert('L')
    lat = (0.5 - (np.arange(H) + 0.5) / H) * np.pi
    coslat = np.maximum(np.cos(lat), 0.3)[:, None]   # у полюсов карта растянута — деталей меньше естественно
    if mode == 'black':
        m = np.asarray(black.convert('L').resize((W, H), Image.BILINEAR)).astype(np.float32) / 255
    else:
        b1 = np.asarray(g.filter(ImageFilter.GaussianBlur(1.5))).astype(np.float32)
        b2 = np.asarray(g.filter(ImageFilter.GaussianBlur(5))).astype(np.float32)
        en = np.asarray(Image.fromarray(np.clip(np.abs(b1 - b2) * 6, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10))).astype(np.float32) / 6
        k = 1.2 if mode == 'bright' else float(mode)
        thr = np.percentile(en, 75) * k * coslat
        m = np.clip((thr - en) / np.maximum(thr * 0.6, 1e-3), 0, 1)
        if mode == 'bright':
            big = np.asarray(g.filter(ImageFilter.GaussianBlur(14))).astype(np.float32)
            p50, p85 = np.percentile(big, [50, 85])
            bright = np.clip((big - p50) / max(p85 - p50, 1e-3), 0, 1)
            sm = m
            m = np.clip((np.clip(0.55 * sm + 0.75 * bright - 0.25, 0, 1) - 0.15) / 0.5, 0, 1)
            # крупные гладкие области (размытые полосы между снимками) — даже если они не светлые
            smb = np.asarray(Image.fromarray((sm * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(18))).astype(np.float32) / 255
            m = np.maximum(m, np.clip((smb - 0.42) / 0.25, 0, 1))
    mi = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(5))
    mm = np.asarray(mi).astype(np.float32) / 255
    rgb = np.asarray(small).astype(np.float32)
    lum = np.asarray(g).astype(np.float32)
    good = mm < 0.15
    pal = None
    if good.sum() > 1000:
        L = lum[good]; sel = rgb[good]
        q = np.percentile(L, [8, 28, 72, 92])
        dark = sel[(L >= q[0]) & (L <= q[1])].mean(axis=0) / 255
        bright = sel[(L >= q[2]) & (L <= q[3])].mean(axis=0) / 255
        pal = [[round(float(x), 3) for x in dark], [round(float(x), 3) for x in bright]]
    return mi, float(mm.mean()), pal


def write_tex_js(tid, data, mime, w, h, credit, extra=None):
    out_dir = os.path.join(DATA, 'tex')
    os.makedirs(out_dir, exist_ok=True)
    b64 = base64.b64encode(data).decode('ascii')
    meta = {'id': tid, 'credit': credit, 'width': w, 'height': h}
    if extra:
        meta.update(extra)
    js = ("'use strict';\n/* Карта поверхности: " + credit + ". Сгенерировано tools/fetch_data.py */\n"
          "window.MW = window.MW || {};\nMW.texData = MW.texData || {};\n"
          "MW.texData[" + json.dumps(tid) + "] = Object.assign(" + json.dumps(meta, ensure_ascii=False) +
          ", { url: \"data:" + mime + ";base64," + b64 + "\" });\n"
          "if (MW.onTexData) MW.onTexData(" + json.dumps(tid) + ");\n")
    with open(os.path.join(out_dir, tid + '.js'), 'w', encoding='utf-8') as f:
        f.write(js)
    return len(b64)


def fetch_textures(only_ids=None):
    import numpy as np
    total = 0
    index = {}
    for tid, W, urls, credit, proc in TEXTURES:
        if only_ids and tid not in only_ids:
            continue
        print(f' * {tid}')
        try:
            extra = None
            if proc == 'earth_aux':
                # R — облака, G — маска океанов (из карты отражения), B — яркость ночных огней
                clouds, _ = open_first([SSS + '8k_earth_clouds.jpg', SSS + '2k_earth_clouds.jpg'])
                spec, _ = open_first([SSS + '2k_earth_specular_map.tif'])
                night, _ = open_first([SSS + '8k_earth_nightmap.jpg', SSS + '2k_earth_nightmap.jpg'])
                H = W // 2
                r = clouds.convert('L').resize((W, H), Image.LANCZOS)
                g = spec.convert('L').resize((W, H), Image.LANCZOS)
                b = night.convert('L').resize((W, H), Image.LANCZOS)
                im = Image.merge('RGB', (r, g, b))
            elif proc == 'ring':
                src, _ = open_first(urls)
                a = np.asarray(src.convert('RGBA')).astype(np.float32)
                prof = a.mean(axis=0)  # усреднение поперёк полосы → радиальный профиль
                alpha = prof[:, 3]
                # внутренний край кольца C — первый заметный подъём плотности; внешний край кольца A —
                # последний плотный участок (дальше только слабое кольцо F на ~2.33 R)
                x0 = np.where(alpha > 20)[0][0] / len(alpha)
                x1 = (np.where(alpha > 100)[0][-1] + 1) / len(alpha)
                # края текстуры: внутренний край кольца C (74 658 км) и внешний край кольца A (136 775 км), R = 60 268 км
                rC, rA = 74658 / 60268, 136775 / 60268
                k = (rA - rC) / (x1 - x0)
                extra = {'r0': round(rC - x0 * k, 5), 'r1': round(rC + (1 - x0) * k, 5)}
                prof = prof.reshape(1, -1, 4)
                im = Image.fromarray(prof.clip(0, 255).astype(np.uint8), 'RGBA').resize((W, 1), Image.LANCZOS)
                buf = io.BytesIO(); im.save(buf, 'PNG', optimize=True)
                n = write_tex_js(tid, buf.getvalue(), 'image/png', W, 1, credit, extra)
                total += n; index[tid] = n
                print(f'    -> js/data/tex/{tid}.js ({n / 1e6:.2f} МБ) кольцо r = {extra["r0"]}…{extra["r1"]} R')
                continue
            else:
                im, _ = open_first(urls)
                black = None
                if proc == 'pluto':
                    import numpy as np
                    black = Image.fromarray(((np.asarray(im.convert('RGB')).max(axis=2) < 10) * 255).astype(np.uint8))
                    black = Image.fromarray(np.roll(np.asarray(black), black.width // 2, axis=1))
                    im = fill_unmapped(im)
                    # карта New Horizons — в долготах 0…360° (центр 180°, «сердце» Томбо в середине);
                    # у нас долгота 0° в центре карты → сдвиг на половину ширины
                    import numpy as np
                    im = Image.fromarray(np.roll(np.asarray(im.convert('RGB')), im.width // 2, axis=1))
                im = im.convert('RGB')
            if im.width > W:
                im = im.resize((W, W // 2), Image.LANCZOS)
            elif im.height * 2 != im.width:
                im = im.resize((im.width, im.width // 2), Image.LANCZOS)
            if tid in MOSAICS:
                mi, cover, pal = mosaic_mask(im, MOSAICS[tid], black if proc == 'pluto' else None)
                extra = dict(extra or {}, fill=pal, unmapped=round(cover, 3))
                if cover > 0.01:
                    mi = mi.resize((max(256, im.width // 4), max(128, im.width // 8)), Image.LANCZOS)
                    mb = io.BytesIO(); mi.convert('RGB').save(mb, 'JPEG', quality=85)
                    nm = write_tex_js(tid + '_mask', mb.getvalue(), 'image/jpeg', mi.width, mi.height, credit + ' — маска неотснятых районов')
                    print(f'    -> js/data/tex/{tid}_mask.js (неотснято {cover * 100:.0f} %, {nm / 1e3:.0f} КБ)')
            buf = io.BytesIO()
            im.save(buf, 'JPEG', quality=92 if proc in ('linear', 'earth_aux') else 88, optimize=True, progressive=True)
            n = write_tex_js(tid, buf.getvalue(), 'image/jpeg', im.width, im.height, credit, extra)
            total += n; index[tid] = n
            print(f'    -> js/data/tex/{tid}.js ({im.width}x{im.height}, {n / 1e6:.2f} МБ)')
        except Exception as e:  # noqa
            print(f'    ! {tid}: пропущено ({e}) — тело останется процедурным')
    print(f'  Итого текстур: {len(index)}, {total / 1e6:.1f} МБ base64')
    return index


if __name__ == '__main__':
    t0 = time.time()
    only = sys.argv[1:]  # например: python tools/fetch_data.py ngc
    if not only or 'pano' in only:
        print('[1/3] Панорама Млечного Пути')
        fetch_panorama()
    if not only or 'hyg' in only:
        print('[2/3] Каталог звёзд HYG')
        fetch_hyg()
    if not only or 'ngc' in only:
        print('[3/4] Каталог Мессье / NGC / IC')
        fetch_ngc()
    if not only or 'psr' in only:
        print('[+] ATNF Pulsar Catalogue')
        fetch_pulsars()
    if not only or 'exo' in only:
        print('[4/4] NASA Exoplanet Archive')
        fetch_exoplanets()
    if not only or 'tex' in only:
        print('[+] Карты поверхностей планет и спутников')
        fetch_textures([a for a in only if a != 'tex'] or None)
    print('Готово за %.1f с' % (time.time() - t0))
