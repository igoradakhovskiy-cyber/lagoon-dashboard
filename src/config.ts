// Presentation-side constants (data-side config lives in scripts/fetch-meta.mjs).

// Colors mirror src/index.css @theme — Recharts needs literal strings.
export const COLORS = {
  en: '#4a92e0',
  ru: '#e2683c',
  gold: '#d8b878',
  qual: '#46c08a',
  pos: '#46c08a',
  neg: '#e2683c',
  warn: '#e6b450',
  ink: '#e8ebf2',
  mute: '#9aa3b7',
  dim: '#6b7488',
  grid: '#232c3d',
  // metric series
  spend: '#7c86ff',
  leads: '#46c08a',
  cpl: '#d8b878',
  ctr: '#4a92e0',
  impressions: '#5a6b8c',
}

export const langColor = (lang: string) => (lang === 'en' ? COLORS.en : COLORS.ru)

/** Resolve a pipeline asset path (e.g. "creatives/x.jpg") against the Pages base URL. */
export const assetUrl = (p?: string | null) => (p ? import.meta.env.BASE_URL + p : '')
export const LANG_LABEL: Record<string, string> = { ru: 'RU', en: 'EN', all: 'Все' }

// Meta lead action types are consistent for this account (lead == fb_pixel_lead == onsite_web_lead).
export const LEAD_HINT = 'Лид = событие «lead» из Meta (совпадает с pixel/onsite-лидом)'
export const QUAL_HINT =
  'Квал-лид = «квал» в колонке O выгрузки CRM. Привязан к дате создания лида, ' +
  'поэтому за последние дни цифра ещё дорастёт — свежий CPQL всегда выглядит хуже, чем окажется.'
export const GEO_HINT =
  'Расход и лиды — из Meta, по стране показа объявления. Квалы — из CRM, по стране в карточке сделки. ' +
  'Это две разные географии: обычно они сходятся, но лид мог кликнуть из поездки. ' +
  'Строки без расхода вынесены вниз отдельно.'

/** Sales-pipeline ladder, in the order the CRM stages actually progress. */
export const STAGE_ORDER = [
  'новый лид',
  'Первый контакт',
  'не отвечает',
  'Квалификация клиента',
  'Отправлено предложение',
  'Отложено',
  'Договор отправлен',
  'Закрыто и не реализовано/спам',
]
