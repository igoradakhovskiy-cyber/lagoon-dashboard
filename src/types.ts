export type Lang = 'ru' | 'en'

export interface Account {
  id: string
  name: string
  currency: string
  timezone?: string
}

export interface Campaign {
  id: string
  name: string
  status: string
  objective: string
  lang: Lang
  daily_budget: number | null
}

export interface AdSet {
  id: string
  name: string
  campaign_id: string
  status: string
}

export interface CreativeMedia {
  poster: string | null // relative path under public/, e.g. "creatives/vid_123.jpg"
  poster_w: number | null
  poster_h: number | null
  video_id: string | null
  permalink: string | null // reel / post permalink (fallback for playback)
  preview_url: string | null // Meta ad-preview iframe src (may expire between refreshes)
}

export interface Ad {
  id: string
  name: string
  adset_id: string
  campaign_id: string
  status: string
  lang: Lang
  creative: CreativeMedia
}

export interface DailyRow {
  ad_id: string
  date: string // YYYY-MM-DD
  spend: number
  impressions: number
  clicks: number // link clicks (matches "Link Clicks")
  leads: number // primary lead metric (locked action_type)
  leads_lead: number // breakdown for cross-check / switching definition
  leads_pixel: number
  leads_onsite: number
}

export interface CreativeGroup {
  key: string // ad name = creative concept, e.g. "003_closed_resort"
  lang: Lang
  poster: string | null
  poster_w: number | null
  poster_h: number | null
  video_id: string | null
  permalink: string | null
  preview_url: string | null
  ad_ids: string[]
  campaign_ids: string[]
}

/** Meta spend/leads for one day × campaign × delivery country (ISO-3166 alpha-2). */
export interface GeoMetaRow {
  date: string
  campaign_id: string
  country: string
  spend: number
  impressions: number
  clicks: number
  leads: number
}

/** One CRM day × campaign × adset × creative bucket. `ad_key` is the ad name. */
export interface CrmDaily {
  date: string
  campaign_id: string
  adset_id: string | null
  ad_key: string | null // null when utm_content was missing or the ad is gone
  leads: number
  qual: number
}

export interface CrmStageRow {
  date: string
  campaign_id: string
  stage: string // e.g. "Первый контакт"
  n: number
}

/** CRM leads/quals for one day × campaign × country, country already ISO-coded. */
export interface CrmGeoRow {
  date: string
  campaign_id: string
  country: string
  leads: number
  qual: number
}

/** Rows the join could not attribute — surfaced, never silently dropped. */
export interface CrmUnmatched {
  unknown_campaign: number // older flight, outside the dashboard window
  unknown_ad: number // campaign matched, utm_content missing or ad deleted
  macro: number // Meta never substituted the {{...}} macro
  no_utm: number
  bad_date: number
  out_of_window: number
  unknown_country: number
  examples: Record<string, string[]>
}

export interface Crm {
  source: string
  sheet_id: string
  tab: string
  fetched_at: string
  qual_value: string
  rows_total: number
  rows_in_window: number
  rows_matched: number
  qual_total: number
  ads_resolved: number
  adsets_resolved: number
  daily: CrmDaily[]
  stages: CrmStageRow[]
  geo: CrmGeoRow[]
  unmatched: CrmUnmatched
}

export interface Dataset {
  generated_at: string
  lead_type: string // which action_type is used as the primary "leads"
  account: Account
  project: string
  plan: { budget: number; leads: number; cpl: number; qual: number; cpql: number }
  date_min: string
  date_max: string
  campaigns: Campaign[]
  adsets: AdSet[]
  ads: Ad[]
  creatives: CreativeGroup[]
  daily: DailyRow[]
  geo_meta: GeoMetaRow[]
  country_names: Record<string, string> // ISO code -> Russian name
  crm?: Crm // absent if the CRM step was skipped
}

/** Aggregated metric bucket used throughout the UI. */
export interface Metrics {
  spend: number
  impressions: number
  clicks: number
  leads: number
  cpl: number
  cpm: number
  cpc: number
  ctr: number
  // CRM layer — null only when the dataset has no crm block at all
  crm_leads: number | null // leads the CRM actually recorded (≠ Meta leads)
  qual_leads: number | null
  cpql: number | null // spend / qualified leads
  qual_rate: number | null // qualified / crm_leads, %
}
