import type {
  Ad,
  AdSet,
  Campaign,
  CreativeGroup,
  CrmDaily,
  CrmGeoRow,
  CrmStageRow,
  DailyRow,
  Dataset,
  GeoMetaRow,
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
  crm_leads: null,
  qual_leads: null,
  cpql: null,
  qual_rate: null,
}

/**
 * Meta metrics for `rows`, plus the CRM layer when `crmRows` is supplied.
 * Pass the CRM slice matching the SAME filter, otherwise CPQL is meaningless.
 */
export function aggregate(rows: DailyRow[], crmRows?: CrmDaily[] | null): Metrics {
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
  let crm_leads: number | null = null
  let qual_leads: number | null = null
  if (crmRows) {
    crm_leads = 0
    qual_leads = 0
    for (const c of crmRows) {
      crm_leads += c.leads
      qual_leads += c.qual
    }
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
    crm_leads,
    qual_leads,
    cpql: qual_leads ? spend / qual_leads : qual_leads === 0 ? 0 : null,
    qual_rate: crm_leads ? ((qual_leads || 0) / crm_leads) * 100 : crm_leads === 0 ? 0 : null,
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

export function dailySeries(rows: DailyRow[], crmRows?: CrmDaily[] | null): DaySeriesPoint[] {
  const byDate = groupBy(rows, (r) => r.date)
  const crmByDate = new Map<string, CrmDaily[]>()
  for (const c of crmRows || []) {
    const arr = crmByDate.get(c.date)
    if (arr) arr.push(c)
    else crmByDate.set(c.date, [c])
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, rs]) => ({
      date,
      ...aggregate(rs, crmRows ? crmByDate.get(date) || [] : null),
    }))
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
export function splitByLang(rows: DailyRow[], idx: Index, crmRows?: CrmDaily[] | null) {
  const byLang = groupBy(rows, (r) => idx.adById.get(r.ad_id)?.lang)
  const crmByLang = new Map<string, CrmDaily[]>()
  for (const c of crmRows || []) {
    const lang = idx.campById.get(c.campaign_id)?.lang
    if (!lang) continue
    const arr = crmByLang.get(lang)
    if (arr) arr.push(c)
    else crmByLang.set(lang, [c])
  }
  const out: { lang: Lang; metrics: Metrics }[] = []
  for (const lang of ['en', 'ru'] as Lang[]) {
    const rs = byLang.get(lang)
    if (rs && rs.length) {
      out.push({ lang, metrics: aggregate(rs, crmRows ? crmByLang.get(lang) || [] : null) })
    }
  }
  return out
}

// ------------------------------------------------------------- CRM layer ----

/** True when a row belongs to the current date range and language filter. */
function inScope(r: { date: string; campaign_id: string }, idx: Index, f: Filters) {
  if (r.date < f.from || r.date > f.to) return false
  if (f.lang !== 'all' && idx.campById.get(r.campaign_id)?.lang !== f.lang) return false
  return true
}

/** CRM rows for the current filter. Language comes from the row's campaign. */
export function filterCrm(ds: Dataset, idx: Index, f: Filters): CrmDaily[] | null {
  if (!ds.crm) return null
  return ds.crm.daily.filter((r) => inScope(r, idx, f))
}

export interface CrmBucket {
  leads: number
  qual: number
}

function bucketBy(rows: CrmDaily[] | null, keyFn: (r: CrmDaily) => string | null) {
  const m = new Map<string, CrmBucket>()
  for (const r of rows || []) {
    const k = keyFn(r)
    if (!k) continue
    const b = m.get(k) || { leads: 0, qual: 0 }
    b.leads += r.leads
    b.qual += r.qual
    m.set(k, b)
  }
  return m
}

/** campaign_id -> {leads, qual} */
export const crmByCampaign = (rows: CrmDaily[] | null) => bucketBy(rows, (r) => r.campaign_id)
/** adset_id -> {leads, qual} — Lagoon's UTMs carry utm_term, so this one resolves */
export const crmByAdset = (rows: CrmDaily[] | null) => bucketBy(rows, (r) => r.adset_id)
/** ad name (creative key) -> {leads, qual} */
export const crmByAd = (rows: CrmDaily[] | null) => bucketBy(rows, (r) => r.ad_key)

/** Sales-pipeline ladder for the current filter, ordered by `order` then by size. */
export function stageLadder(
  ds: Dataset,
  idx: Index,
  f: Filters,
  order: string[],
): { stage: string; n: number }[] {
  if (!ds.crm) return []
  const totals = new Map<string, number>()
  for (const r of ds.crm.stages as CrmStageRow[]) {
    if (!inScope(r, idx, f)) continue
    totals.set(r.stage, (totals.get(r.stage) || 0) + r.n)
  }
  const known = order.filter((s) => totals.has(s)).map((s) => ({ stage: s, n: totals.get(s)! }))
  const rest = [...totals.entries()]
    .filter(([s]) => !order.includes(s))
    .map(([stage, n]) => ({ stage, n }))
    .sort((a, b) => b.n - a.n)
  return [...known, ...rest]
}

export interface GeoRow {
  country: string // ISO code
  name: string // Russian display name
  spend: number
  leads: number // Meta leads, i.e. attributed to the delivery country
  cpl: number | null
  crm_leads: number // rows the CRM recorded against this country
  qual: number
  cpql: number | null // null when nothing was spent in that country
  qual_rate: number | null
  impressions: number
  clicks: number
  /** CRM has leads here but Meta never delivered — a different geography, not a gap. */
  no_delivery: boolean
}

/**
 * Country table joining the two sources on the ISO code.
 *
 * The two geographies are NOT the same thing and the join is honest about it:
 * Meta reports the country the ad was *delivered* in, the CRM reports whatever the
 * manager wrote on the card. They agree within a lead or three per country here,
 * but a handful of CRM countries were never targeted at all (someone clicking
 * while abroad) — those get `no_delivery` so the UI can keep them out of the
 * money columns instead of printing a $0 CPQL.
 */
export function geoTable(ds: Dataset, idx: Index, f: Filters): GeoRow[] {
  const rows = new Map<
    string,
    { spend: number; leads: number; impressions: number; clicks: number; crm_leads: number; qual: number }
  >()
  const get = (c: string) => {
    let v = rows.get(c)
    if (!v) rows.set(c, (v = { spend: 0, leads: 0, impressions: 0, clicks: 0, crm_leads: 0, qual: 0 }))
    return v
  }

  for (const r of ds.geo_meta as GeoMetaRow[]) {
    if (!inScope(r, idx, f)) continue
    const v = get(r.country)
    v.spend += r.spend
    v.leads += r.leads
    v.impressions += r.impressions
    v.clicks += r.clicks
  }
  for (const r of (ds.crm?.geo || []) as CrmGeoRow[]) {
    if (!inScope(r, idx, f)) continue
    const v = get(r.country)
    v.crm_leads += r.leads
    v.qual += r.qual
  }

  return [...rows.entries()]
    .map(([country, v]) => ({
      country,
      name: ds.country_names?.[country] || country,
      spend: v.spend,
      leads: v.leads,
      cpl: v.leads ? v.spend / v.leads : null,
      crm_leads: v.crm_leads,
      qual: v.qual,
      cpql: v.spend > 0 && v.qual ? v.spend / v.qual : null,
      qual_rate: v.crm_leads ? (v.qual / v.crm_leads) * 100 : null,
      impressions: v.impressions,
      clicks: v.clicks,
      no_delivery: v.spend <= 0,
    }))
    .filter((r) => r.spend > 0 || r.crm_leads > 0)
    .sort((a, b) => b.spend - a.spend || b.qual - a.qual)
}
