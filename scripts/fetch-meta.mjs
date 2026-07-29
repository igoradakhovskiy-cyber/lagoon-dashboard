#!/usr/bin/env node
/**
 * Lagoon dashboard — Meta Marketing API data pipeline.
 *
 * Pulls campaigns / ad sets / ads + daily ad-level insights + creative media
 * (poster, video_id, reel permalink, ad-preview iframe) straight from the ad
 * account, downloads posters locally (self-host so they never break), and
 * writes one clean public/data/latest.json that the static dashboard reads.
 *
 * No npm deps — Node 18+ global fetch only.
 *
 * Auth: reads META_ACCESS_TOKEN from the environment (CI secret) or, locally,
 * from ~/.config/claude-meta/token.env. The token is a non-expiring system-user
 * token, so the scheduled rebuild keeps working without manual renewal.
 */

import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { nameMapFor } from './countries.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CREATIVES_DIR = path.join(ROOT, 'public', 'creatives')
// plaintext lands OUTSIDE public/ so it never ships; encrypt-data.mjs turns it into public/data/latest.enc
const OUT_FILE = path.join(ROOT, '.data', 'latest.json')

// ---------------------------------------------------------------- config ----
const ACCOUNT_ID = process.env.META_ACCOUNT_ID || 'act_1304695957188832' // Homex 2024 (2.0)
const API_VERSION = process.env.META_API_VERSION || 'v21.0'
const PROJECT = process.env.PROJECT_NAME || 'Lagoon Resort'
const MIN_DATE = process.env.MIN_DATE || '2026-07-01' // ignore older, unrelated flights
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 120)
const PRIMARY_LEAD_TYPE = process.env.LEAD_TYPE || 'lead' // locked after cross-check
const PLAN = {
  budget: Number(process.env.PLAN_BUDGET || 6000),
  leads: Number(process.env.PLAN_LEADS || 300),
  cpl: Number(process.env.PLAN_CPL || 20),
  qual: Number(process.env.PLAN_QUAL || 30),
  cpql: Number(process.env.PLAN_CPQL || 200),
}
const PREVIEW_FORMAT = process.env.PREVIEW_FORMAT || 'INSTAGRAM_STORY'

// ------------------------------------------------------------- token load ---
async function loadToken() {
  if (process.env.META_ACCESS_TOKEN) return process.env.META_ACCESS_TOKEN
  const envPath = path.join(os.homedir(), '.config', 'claude-meta', 'token.env')
  if (existsSync(envPath)) {
    const txt = await fs.readFile(envPath, 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*META_ACCESS_TOKEN\s*=\s*(.+?)\s*$/)
      if (m) return m[1]
    }
  }
  throw new Error('META_ACCESS_TOKEN not found (env or ~/.config/claude-meta/token.env)')
}

// ------------------------------------------------------------- utilities ----
const BASE = `https://graph.facebook.com/${API_VERSION}`
let TOKEN = ''
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function ymd(d) {
  return d.toISOString().slice(0, 10)
}

async function graph(pathOrUrl, params = {}, attempt = 1) {
  let url
  if (pathOrUrl.startsWith('http')) {
    url = new URL(pathOrUrl)
  } else {
    url = new URL(`${BASE}/${pathOrUrl}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  }
  url.searchParams.set('access_token', TOKEN)
  try {
    const res = await fetch(url)
    const json = await res.json()
    if (json.error) {
      const e = json.error
      // transient: rate limit / temporary — back off and retry
      const transient = [1, 2, 4, 17, 341, 613].includes(e.code) || res.status >= 500
      if (transient && attempt <= 4) {
        await sleep(1500 * attempt)
        return graph(pathOrUrl, params, attempt + 1)
      }
      throw new Error(`Graph error ${e.code}/${e.error_subcode || ''}: ${e.message}`)
    }
    return json
  } catch (err) {
    if (attempt <= 4) {
      await sleep(1200 * attempt)
      return graph(pathOrUrl, params, attempt + 1)
    }
    throw err
  }
}

/** Follow paging.next until exhausted, collecting .data. */
async function graphAll(pathStr, params = {}) {
  const out = []
  let json = await graph(pathStr, { ...params, limit: params.limit || 200 })
  out.push(...(json.data || []))
  let guard = 0
  while (json.paging && json.paging.next && guard < 50) {
    json = await graph(json.paging.next)
    out.push(...(json.data || []))
    guard++
  }
  return out
}

/** Bounded-concurrency map. */
async function pMap(items, fn, concurrency = 5) {
  const ret = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      try {
        ret[idx] = await fn(items[idx], idx)
      } catch (err) {
        ret[idx] = null
        console.warn(`  ! item ${idx} failed: ${err.message}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return ret
}

/** Returns 'en' | 'ru' from a name token, or null when the name has no explicit token. */
function langToken(name = '') {
  const n = name.toUpperCase()
  if (n.includes('_EN_') || n.includes('_ENG_')) return 'en'
  if (n.includes('_RU_')) return 'ru'
  return null
}

function parseLeads(actions = []) {
  const b = { lead: 0, pixel: 0, onsite: 0 }
  for (const a of actions) {
    const v = Number(a.value) || 0
    if (a.action_type === 'lead') b.lead += v
    else if (a.action_type === 'offsite_conversion.fb_pixel_lead') b.pixel += v
    else if (a.action_type === 'onsite_web_lead') b.onsite += v
  }
  return b
}

// --------------------------------------------------------- creative media ---
const posterCache = new Map() // videoId/imageHash -> relative path

async function downloadPoster(url, fileBase) {
  const rel = `creatives/${fileBase}.jpg`
  const abs = path.join(CREATIVES_DIR, `${fileBase}.jpg`)
  if (existsSync(abs)) return rel
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    await fs.writeFile(abs, buf)
    return rel
  } catch (err) {
    console.warn(`  ! poster download failed (${fileBase}): ${err.message}`)
    return null
  }
}

async function resolveVideoPoster(videoId) {
  if (posterCache.has(`v${videoId}`)) return posterCache.get(`v${videoId}`)
  const v = await graph(videoId, {
    fields: 'permalink_url,picture,thumbnails{uri,is_preferred,height,width}',
  })
  const thumbs = (v.thumbnails && v.thumbnails.data) || []
  let best = thumbs.find((t) => t.is_preferred) || thumbs[0]
  // prefer the largest available thumbnail
  for (const t of thumbs) if ((t.height || 0) > (best?.height || 0)) best = t
  const posterUrl = best?.uri || v.picture || null
  const rel = posterUrl ? await downloadPoster(posterUrl, `vid_${videoId}`) : null
  const info = {
    poster: rel,
    poster_w: best?.width || null,
    poster_h: best?.height || null,
    permalink: v.permalink_url ? `https://www.facebook.com${v.permalink_url}` : null,
  }
  posterCache.set(`v${videoId}`, info)
  return info
}

async function resolvePreview(adId) {
  try {
    const json = await graph(`${adId}/previews`, { ad_format: PREVIEW_FORMAT })
    const body = json.data && json.data[0] && json.data[0].body
    if (!body) return null
    const m = body.match(/src="([^"]+)"/)
    return m ? m[1].replace(/&amp;/g, '&') : null
  } catch {
    return null
  }
}

async function resolveCreative(ad) {
  const cr = ad.creative || {}
  const media = {
    poster: null,
    poster_w: null,
    poster_h: null,
    video_id: cr.video_id || null,
    permalink: cr.instagram_permalink_url || null,
    preview_url: null,
  }
  if (cr.video_id) {
    const v = await resolveVideoPoster(cr.video_id)
    media.poster = v.poster
    media.poster_w = v.poster_w
    media.poster_h = v.poster_h
    if (!media.permalink) media.permalink = v.permalink
  } else if (cr.image_url || cr.thumbnail_url) {
    media.poster = await downloadPoster(cr.image_url || cr.thumbnail_url, `ad_${ad.id}`)
  }
  media.preview_url = await resolvePreview(ad.id)
  return media
}

// ------------------------------------------------------------------- main ---
async function main() {
  TOKEN = await loadToken()
  await fs.mkdir(CREATIVES_DIR, { recursive: true })
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true })

  const until = new Date()
  const sinceD = new Date(until.getTime() - LOOKBACK_DAYS * 86400000)
  const since = ymd(sinceD) < MIN_DATE ? MIN_DATE : ymd(sinceD)
  const timeRange = JSON.stringify({ since, until: ymd(until) })
  console.log(`▶ Account ${ACCOUNT_ID} · window ${since} → ${ymd(until)}`)

  // account meta
  const acct = await graph(ACCOUNT_ID, { fields: 'name,currency,timezone_name' })

  // daily ad-level insights first — tells us which ads were actually active
  console.log('▶ Fetching daily insights…')
  const insRows = await graphAll(`${ACCOUNT_ID}/insights`, {
    level: 'ad',
    fields: 'ad_id,adset_id,campaign_id,spend,impressions,inline_link_clicks,clicks,actions',
    time_range: timeRange,
    time_increment: '1',
    limit: 500,
  })
  const daily = insRows.map((r) => {
    const b = parseLeads(r.actions)
    const primary = b[PRIMARY_LEAD_TYPE === 'lead' ? 'lead' : PRIMARY_LEAD_TYPE === 'offsite_conversion.fb_pixel_lead' ? 'pixel' : 'onsite']
    return {
      ad_id: r.ad_id,
      date: r.date_start,
      spend: Number(r.spend) || 0,
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.inline_link_clicks) || 0,
      leads: primary || 0,
      leads_lead: b.lead,
      leads_pixel: b.pixel,
      leads_onsite: b.onsite,
    }
  })
  const activeAdIds = new Set(daily.map((r) => r.ad_id))
  console.log(`  ${daily.length} daily rows · ${activeAdIds.size} active ads`)

  // Country breakdown — a SEPARATE insights cut, because Meta refuses to combine
  // breakdowns=country with level=ad at this volume. Campaign level is enough:
  // the geo table only ever filters by date and language, and language is a
  // property of the campaign. Kept per-day so the date presets stay exact.
  console.log('▶ Fetching country breakdown…')
  const geoRaw = await graphAll(`${ACCOUNT_ID}/insights`, {
    level: 'campaign',
    fields: 'campaign_id,spend,impressions,inline_link_clicks,actions',
    breakdowns: 'country',
    time_range: timeRange,
    time_increment: '1',
    limit: 500,
  })
  const geoMeta = geoRaw
    .map((r) => {
      const b = parseLeads(r.actions)
      return {
        date: r.date_start,
        campaign_id: r.campaign_id,
        country: r.country,
        // rounded to cents: full float precision would bloat the payload for no gain
        spend: Math.round((Number(r.spend) || 0) * 100) / 100,
        impressions: Number(r.impressions) || 0,
        clicks: Number(r.inline_link_clicks) || 0,
        leads: b[PRIMARY_LEAD_TYPE === 'lead' ? 'lead' : PRIMARY_LEAD_TYPE === 'offsite_conversion.fb_pixel_lead' ? 'pixel' : 'onsite'] || 0,
      }
    })
    // days where a country saw impressions but cost nothing and produced nothing
    // add rows without adding information
    .filter((r) => r.spend > 0 || r.leads > 0)
  const geoCountries = new Set(geoMeta.map((r) => r.country))
  console.log(`  ${geoMeta.length} country-day rows · ${geoCountries.size} countries`)

  // structure
  console.log('▶ Fetching campaigns / ad sets / ads…')
  const [allCampaigns, allAdsets, allAds] = await Promise.all([
    graphAll(`${ACCOUNT_ID}/campaigns`, { fields: 'name,status,objective,daily_budget', limit: 500 }),
    graphAll(`${ACCOUNT_ID}/adsets`, { fields: 'name,status,campaign_id', limit: 500 }),
    graphAll(`${ACCOUNT_ID}/ads`, {
      fields:
        'name,status,adset_id,campaign_id,creative{id,object_type,image_url,thumbnail_url,video_id,instagram_permalink_url}',
      limit: 500,
    }),
  ])

  const ads0 = allAds.filter((a) => activeAdIds.has(a.id))
  const usedCampaignIds = new Set(ads0.map((a) => a.campaign_id))
  const usedAdsetIds = new Set(ads0.map((a) => a.adset_id))

  const campaigns = allCampaigns
    .filter((c) => usedCampaignIds.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      objective: c.objective,
      lang: langToken(c.name) || 'ru',
      daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
    }))
  const adsets = allAdsets
    .filter((s) => usedAdsetIds.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, campaign_id: s.campaign_id, status: s.status }))

  // creative media (only for active ads) — bounded concurrency
  console.log(`▶ Resolving creatives + posters for ${ads0.length} ads…`)
  const ads = []
  await pMap(
    ads0,
    async (a) => {
      const campaign = campaigns.find((c) => c.id === a.campaign_id)
      const media = await resolveCreative(a)
      ads.push({
        id: a.id,
        name: a.name,
        adset_id: a.adset_id,
        campaign_id: a.campaign_id,
        status: a.status,
        lang: langToken(a.name) || (campaign ? campaign.lang : 'ru'),
        creative: media,
      })
    },
    5,
  )

  // creative groups keyed by ad name (the creative concept)
  const groups = new Map()
  for (const a of ads) {
    let g = groups.get(a.name)
    if (!g) {
      g = {
        key: a.name,
        lang: a.lang,
        poster: a.creative.poster,
        poster_w: a.creative.poster_w,
        poster_h: a.creative.poster_h,
        video_id: a.creative.video_id,
        permalink: a.creative.permalink,
        preview_url: a.creative.preview_url,
        ad_ids: [],
        campaign_ids: [],
      }
      groups.set(a.name, g)
    }
    g.ad_ids.push(a.id)
    if (!g.campaign_ids.includes(a.campaign_id)) g.campaign_ids.push(a.campaign_id)
    if (!g.poster && a.creative.poster) {
      g.poster = a.creative.poster
      g.poster_w = a.creative.poster_w
      g.poster_h = a.creative.poster_h
    }
    if (!g.preview_url && a.creative.preview_url) g.preview_url = a.creative.preview_url
    if (!g.permalink && a.creative.permalink) g.permalink = a.creative.permalink
  }

  const dates = daily.map((r) => r.date).sort()
  const dataset = {
    generated_at: new Date().toISOString(),
    lead_type: PRIMARY_LEAD_TYPE,
    account: {
      id: ACCOUNT_ID,
      name: acct.name || '',
      currency: acct.currency || 'USD',
      timezone: acct.timezone_name || '',
    },
    project: PROJECT,
    plan: PLAN,
    date_min: dates[0] || since,
    date_max: dates[dates.length - 1] || ymd(until),
    campaigns,
    adsets,
    ads,
    creatives: [...groups.values()],
    daily,
    geo_meta: geoMeta,
    // fetch-crm.mjs adds any ISO code the CRM knows about but Meta never delivered to
    country_names: nameMapFor(geoCountries),
  }

  await fs.writeFile(OUT_FILE, JSON.stringify(dataset, null, 2))
  console.log(`✔ Wrote ${path.relative(ROOT, OUT_FILE)}`)

  // ---- cross-check summary (helps lock the lead action_type) ----
  const tot = daily.reduce(
    (o, r) => {
      o.spend += r.spend
      o.impr += r.impressions
      o.clicks += r.clicks
      o.lead += r.leads_lead
      o.pixel += r.leads_pixel
      o.onsite += r.leads_onsite
      return o
    },
    { spend: 0, impr: 0, clicks: 0, lead: 0, pixel: 0, onsite: 0 },
  )
  console.log('\n──── cross-check (whole window) ────')
  console.log(`  spend        $${tot.spend.toFixed(2)}`)
  console.log(`  impressions  ${tot.impr}`)
  console.log(`  link clicks  ${tot.clicks}`)
  console.log(`  leads[lead]         ${tot.lead}`)
  console.log(`  leads[fb_pixel_lead] ${tot.pixel}`)
  console.log(`  leads[onsite_web]    ${tot.onsite}`)
  console.log(`  campaigns ${campaigns.length} · adsets ${adsets.length} · ads ${ads.length} · creatives ${groups.size}`)
  const withPoster = ads.filter((a) => a.creative.poster).length
  const withPreview = ads.filter((a) => a.creative.preview_url).length
  console.log(`  posters ${withPoster}/${ads.length} · previews ${withPreview}/${ads.length}`)

  // The country cut is a second query against the same window, so its totals must
  // land on the ad-level ones. Cents of drift are Meta's own rounding; more than
  // that means the two cuts disagree and the geo table would quietly mislead.
  const geoSpend = geoMeta.reduce((s, r) => s + r.spend, 0)
  const geoLeads = geoMeta.reduce((s, r) => s + r.leads, 0)
  const spendDrift = Math.abs(geoSpend - tot.spend)
  const leadDrift = Math.abs(geoLeads - daily.reduce((s, r) => s + r.leads, 0))
  console.log(`  geo cut     $${geoSpend.toFixed(2)} · ${geoLeads} leads (drift $${spendDrift.toFixed(2)} / ${leadDrift} leads)`)
  if (spendDrift > Math.max(1, tot.spend * 0.01)) {
    throw new Error(`country breakdown spend differs from ad-level by $${spendDrift.toFixed(2)}`)
  }
  if (leadDrift > 2) {
    throw new Error(`country breakdown leads differ from ad-level by ${leadDrift}`)
  }
}

main().catch((e) => {
  console.error('✖ pipeline failed:', e)
  process.exit(1)
})
