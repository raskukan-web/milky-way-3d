# Публикация планетария в интернете

Проект — статический сайт: только HTML, CSS и JS, без сборки и без сервера. Все пути относительные (`js/...`,
`css/...`, `js/data/tex/...`), поэтому сайт работает с любого домена и из подпапки.

## Проверка лимитов

| | Проект | GitHub Pages | Cloudflare Pages |
|---|---|---|---|
| Общий объём | ~44 МБ, 65 файлов | до 1 ГБ на сайт | до 20 000 файлов |
| Самый большой файл | 10,4 МБ (`js/data/hyg_stars.js`) | до 100 МБ на файл | до 25 МБ на файл |

`assets/milkyway_panorama.jpg` (6,9 МБ) — исходник панорамы (кеш `tools/fetch_data.py`); в браузер он не
загружается (панорама встроена в `js/data/sky_panorama.js`), поэтому в репозиторий не входит (`.gitignore`). Карты планет (`js/data/tex/*.js`) грузятся только при
подлёте к телу.

## GitHub Pages

1. **Вырезать папку проекта в отдельную ветку** (Git-репозиторий находится уровнем выше — в `C:\Users\User\VS`):

   ```powershell
   cd C:\Users\User\VS
   ```

   ```powershell
   git subtree split --prefix milkyway_planetarium -b planetarium-site
   ```

2. **Создать пустой публичный репозиторий** на github.com (**New repository**, например `milkyway-planetarium`,
   без README / .gitignore / лицензии).
3. **Отправить ветку** (подставьте свой адрес):

   ```powershell
   git push https://github.com/<имя>/milkyway-planetarium.git planetarium-site:main
   ```

4. **Включить Pages:** Settings → Pages → Source «Deploy from a branch», Branch `main`, папка `/ (root)` → Save.
   Через 1–2 минуты сайт откроется по адресу `https://<имя>.github.io/milkyway-planetarium/`.
5. **Обновление:** `git branch -D planetarium-site`, снова шаг 1 и `git push` из шага 3.

Файл `.nojekyll` в корне уже есть — он отключает обработку Jekyll.

## Cloudflare Pages

1. dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git** → выберите репозиторий из шагов 2–3.
2. Framework preset: **None**, Build command: пусто, Build output directory: `/`.
3. **Save and Deploy** — адрес вида `https://milkyway-planetarium.pages.dev`; каждый `git push` публикуется сам.

## После публикации

- При первом входе планетарий сам выбирает пресет качества по устройству и видеокарте (см. README → «Качество»).
  Посетитель может сменить его в панели «Графика»; выбор сохраняется в браузере.
- Нужен браузер с WebGL2: Chrome, Edge, Firefox, Safari 15+.
