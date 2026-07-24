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

export interface Dataset {
  generated_at: string
  lead_type: string // which action_type is used as the primary "leads"
  account: Account
  project: string
  plan: { budget: number; leads: number; cpl: number }
  date_min: string
  date_max: string
  campaigns: Campaign[]
  adsets: AdSet[]
  ads: Ad[]
  creatives: CreativeGroup[]
  daily: DailyRow[]
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
  // CRM phase (null until the CRM export is wired in)
  qual_leads: number | null
  cpql: number | null
  qual_rate: number | null
}
