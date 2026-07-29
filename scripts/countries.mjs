/**
 * Country naming bridge between the two data sources.
 *
 * Meta's `breakdowns=country` returns ISO-3166-1 alpha-2 codes ("DE"), the CRM
 * export carries Russian names ("Германия"). The dashboard keys everything by
 * ISO code and renders the Russian name, so both directions live here.
 *
 * `US_CA` is a deliberate pseudo-code: the CRM has a single combined bucket
 * "США / Канада" and there is no way to split it after the fact. It gets its own
 * row rather than being silently folded into US.
 */

/** ISO-3166-1 alpha-2 → Russian display name. */
export const ISO_TO_RU = {
  AE: 'ОАЭ', AL: 'Албания', AM: 'Армения', AR: 'Аргентина', AT: 'Австрия',
  AU: 'Австралия', AZ: 'Азербайджан', BA: 'Босния и Герцеговина', BE: 'Бельгия',
  BG: 'Болгария', BR: 'Бразилия', BY: 'Беларусь', CA: 'Канада', CH: 'Швейцария',
  CL: 'Чили', CN: 'Китай', CO: 'Колумбия', CY: 'Кипр', CZ: 'Чехия',
  DE: 'Германия', DK: 'Дания', EE: 'Эстония', EG: 'Египет', ES: 'Испания',
  FI: 'Финляндия', FR: 'Франция', GB: 'Великобритания', GE: 'Грузия',
  GR: 'Греция', HR: 'Хорватия', HU: 'Венгрия', ID: 'Индонезия', IE: 'Ирландия',
  IL: 'Израиль', IN: 'Индия', IS: 'Исландия', IT: 'Италия', JP: 'Япония',
  KG: 'Киргизия', KZ: 'Казахстан', LI: 'Лихтенштейн', LT: 'Литва',
  LU: 'Люксембург', LV: 'Латвия', MD: 'Молдова', ME: 'Черногория',
  MK: 'Северная Македония', MT: 'Мальта', MX: 'Мексика', MY: 'Малайзия',
  NL: 'Нидерланды', NO: 'Норвегия', NZ: 'Новая Зеландия', PL: 'Польша',
  PT: 'Португалия', QA: 'Катар', RO: 'Румыния', RS: 'Сербия', RU: 'Россия',
  SA: 'Саудовская Аравия', SE: 'Швеция', SG: 'Сингапур', SI: 'Словения',
  SK: 'Словакия', TH: 'Таиланд', TR: 'Турция', UA: 'Украина', US: 'США',
  UY: 'Уругвай', UZ: 'Узбекистан', VN: 'Вьетнам', ZA: 'ЮАР',
  US_CA: 'США / Канада',
}

/**
 * Extra spellings seen in the CRM on top of the plain inversion of ISO_TO_RU.
 * Managers type these by hand, so the sheet is not a controlled vocabulary.
 */
const CRM_ALIASES = {
  'сша / канада': 'US_CA',
  'сша/канада': 'US_CA',
  'сша': 'US',
  'канада': 'CA',
  'англия': 'GB',
  'великобритания (uk)': 'GB',
  'uk': 'GB',
  'белоруссия': 'BY',
  'республика беларусь': 'BY',
  'чехия (чешская республика)': 'CZ',
  'молдавия': 'MD',
  'македония': 'MK',
  'эмираты': 'AE',
  'оаэ': 'AE',
  'нидерланды (голландия)': 'NL',
  'голландия': 'NL',
  'киргизстан': 'KG',
  'кыргызстан': 'KG',
}

const normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

/** Russian name (as typed in the CRM) → ISO code, or null when unrecognised. */
const RU_TO_ISO = new Map(Object.entries(CRM_ALIASES))
for (const [iso, ru] of Object.entries(ISO_TO_RU)) {
  const k = normName(ru)
  if (!RU_TO_ISO.has(k)) RU_TO_ISO.set(k, iso)
}

export function isoFromRu(name) {
  const k = normName(name)
  if (!k || k === '—' || k === '-') return null
  return RU_TO_ISO.get(k) || null
}

/** Display name for an ISO code; falls back to the raw code so nothing vanishes. */
export const ruFromIso = (iso) => ISO_TO_RU[iso] || iso

/** Only the names actually needed by a dataset — keeps the payload small. */
export function nameMapFor(isoCodes) {
  const out = {}
  for (const iso of isoCodes) out[iso] = ruFromIso(iso)
  return out
}
