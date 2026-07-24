# Lagoon Resort — живой рекламный дашборд

Интерактивный отчёт по рекламе Meta (Facebook / Instagram) для проекта Lagoon Resort.
Данные тянутся напрямую из рекламного кабинета **Homex** (`act_1304695957188832`) через
Meta Marketing API, обновляются по расписанию и публикуются на GitHub Pages.

## Что внутри
- KPI-сводка (расход, лиды, CPL, CPM, CPC, CTR) + план/факт месяца.
- Динамика по дням (расход, лиды, CPL, CTR), воронка, разбивка потоков EN / RU.
- Кампании с дрилл-дауном: кампания → адсет → объявление.
- **Галерея креативов** — постеры 9:16, метрики по каждому, живое превью Meta в модалке.
- Слоты под **квал-лиды / CPQL** («ждёт CRM») — включаются, когда появится выгрузка CRM.

## Стек
Vite + React + TypeScript + Tailwind v4 + Recharts. Данные — статический `public/data/latest.json`,
собираемый скриптом `scripts/fetch-meta.mjs` (Node 18+, без внешних зависимостей).

## Локально
```bash
npm install
npm run fetch      # тянет данные из Meta (токен из ~/.config/claude-meta/token.env)
npm run dev        # http://localhost:5180/lagoon-dashboard/
```

## Обновление данных
`npm run fetch` перезаписывает `public/data/latest.json` и скачивает постеры в `public/creatives/`.
Настройки — через переменные окружения (см. шапку `scripts/fetch-meta.mjs`): `META_ACCOUNT_ID`,
`MIN_DATE`, `LEAD_TYPE`, `PLAN_BUDGET`, `PLAN_LEADS`, `PLAN_CPL`.

## Деплой (GitHub Pages + авто-крон)
1. Создать репозиторий **`lagoon-dashboard`** (имя важно — под него настроен `base` в `vite.config.ts`).
2. Settings → Pages → Source = **GitHub Actions**.
3. Settings → Secrets and variables → Actions:
   - Secret `META_ACCESS_TOKEN` = системный токен Meta.
   - (опц.) Variable `META_ACCOUNT_ID` = `act_1304695957188832`.
4. `git push` → workflow `.github/workflows/deploy.yml` соберёт и опубликует сайт.
   Дальше он сам пересобирается каждые 3 часа (cron) — данные всегда свежие.

Итоговая ссылка: `https://<user>.github.io/lagoon-dashboard/`

## CRM (фаза 2)
Когда появится выгрузка CRM (Google-таблица с колонками `UTM Campaign`, `UTM Content`,
`Квалификация`=`Qualified`), она джойнится к данным по UTM-меткам → цена квал-лида (CPQL)
на уровне периода, кампаний и **каждого креатива**.
