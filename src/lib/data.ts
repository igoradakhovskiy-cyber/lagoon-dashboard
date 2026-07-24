import type {
  Ad,
  AdSet,
  Campaign,
  CreativeGroup,
  DailyRow,
  Dataset,
  Lang,
  Metrics,
} from '../types'

export interface Index {
  adById: Map<string, Ad>
  campById: Map<string, Campaign>
  adsetById: Map<string, AdSet>
  creativeByKey: Map<string, CreativeGroup>
}

export function buildIndex(ds: Dataset): Index {
  return {
    adById: new Map(ds.ads.map((a) => [a.id, a])),
    campById: new Map(ds.campaigns.map((c) => [c.id, c])),
    adsetById: new Map(ds.adsets.map((s) => [s.id, s])),
    creativeByKey: new Map(ds.creatives.map((g) => [g.key, g])),
  }
}

export const EMPTY_METRICS: Metrics = {
  spend: 0,
  impressions: 0,
  clicks: 0,
  leads: 0,
  cpl: 0,
  cpm: 0,
  cpc: 0,
  ctr: 0,
  qual_leads: null,
  cpql: null,
  qual_rate: null,
}

export function aggregate(rows: DailyRow[]): Metrics {
  let spend = 0,
    impressions = 0,
    clicks = 0,
    leads = 0
  for (const r of rows) {
    spend += r.spend
    impressions += r.impressions
    clicks += r.clicks
    leads += r.leads
  }
  return {
    spend,
    impressions,
    clicks,
    leads,
    cpl: leads ? spend / leads : 0,
    cpm: impressions ? (spend / impressions) * 1000 : 0,
    cpc: clicks ? spend / clicks : 0,
    ctr: impressions ? (clicks / impressions) * 100 : 0,
    qual_leads: null,
    cpql: null,
    qual_rate: null,
  }
}

export interface Filters {
  from: string
  to: string
  lang: 'all' | Lang
}

export function filterRows(ds: Dataset, idx: Index, f: Filters): DailyRow[] {
  return ds.daily.filter((r) => {
    if (r.date < f.from || r.date > f.to) return false
    if (f.lang !== 'all') {
      const ad = idx.adById.get(r.ad_id)
      if (!ad || ad.lang !== f.lang) return false
    }
    return true
  })
}

export function groupBy(rows: DailyRow[], keyFn: (r: DailyRow) => string | undefined) {
  const m = new Map<string, DailyRow[]>()
  for (const r of rows) {
    const k = keyFn(r)
    if (k === undefined) continue
    const arr = m.get(k)
    if (arr) arr.push(r)
    else m.set(k, [r])
  }
  return m
}

export interface DaySeriesPoint extends Metrics {
  date: string
}

export function dailySeries(rows: DailyRow[]): DaySeriesPoint[] {
  const byDate = groupBy(rows, (r) => r.date)
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, rs]) => ({ date, ...aggregate(rs) }))
}

// ---- date helpers on YYYY-MM-DD strings (UTC-safe) ----
export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
export function maxDate(a: string, b: string) {
  return a > b ? a : b
}
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1
}

export interface Preset {
  key: string
  label: string
  from: string
  to: string
}

/** Presets are relative to the latest data date, not wall-clock today. */
export function buildPresets(dateMin: string, dateMax: string): Preset[] {
  const to = dateMax
  const clamp = (from: string) => maxDate(from, dateMin)
  const monthStart = to.slice(0, 8) + '01'
  return [
    { key: '7', label: '7 дней', from: clamp(addDays(to, -6)), to },
    { key: '14', label: '14 дней', from: clamp(addDays(to, -13)), to },
    { key: '30', label: '30 дней', from: clamp(addDays(to, -29)), to },
    { key: 'month', label: 'Этот месяц', from: clamp(monthStart), to },
    { key: 'all', label: 'Всё время', from: dateMin, to },
  ]
}

/** Language breakdown (EN / RU) for the current filtered rows. */
export function splitByLang(rows: DailyRow[], idx: Index) {
  const byLang = groupBy(rows, (r) => idx.adById.get(r.ad_id)?.lang)
  const out: { lang: Lang; metrics: Metrics }[] = []
  for (const lang of ['en', 'ru'] as Lang[]) {
    const rs = byLang.get(lang)
    if (rs && rs.length) out.push({ lang, metrics: aggregate(rs) })
  }
  return out
}
