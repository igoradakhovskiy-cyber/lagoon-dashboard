#!/usr/bin/env node
/**
 * Lagoon dashboard — CRM layer from Google Sheets.
 *
 * Runs AFTER fetch-meta.mjs: reads .data/latest.json, pulls the CRM export from
 * the Google Sheet, joins it onto the Meta data, and writes the `crm` block back
 * into the same file.
 *
 * ── How the join works ───────────────────────────────────────────────────────
 * The landing page forwards Meta's URL macros to the CRM, so every row carries
 * IDs rather than names:
 *
 *   utm_id   = {{campaign.id}}   → column L
 *   utm_term = {{adset.id}}      → column M
 *   utm_content = the ad name    → inside the Referer URL (column H)
 *
 * Matching on IDs is why this join is exact and survives campaign renames —
 * unlike a name-based join, which breaks the moment someone edits a campaign.
 *
 * The dedicated "UTM Content" column (J) is NOT usable: it is empty for every RU
 * campaign, and Google types it as a number for the EN one, so the ad named "01"
 * arrives as `1`. The Referer keeps the raw query string, so utm_content is
 * parsed from there and column J is only a last-resort fallback.
 *
 * The sheet is readable by link, so this is a plain unauthenticated fetch of the
 * gviz CSV export — no OAuth, no service account, no API key. If the sheet is ever
 * made private this script fails loudly and the fallback is a service account +
 * Sheets API with the JSON key in a GitHub Secret.
 *
 * No npm deps — Node 18+ global fetch only.
 */

import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isoFromRu, ruFromIso } from './countries.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA_FILE = path.join(ROOT, '.data', 'latest.json')

// ---------------------------------------------------------------- config ----
const SHEET_ID = process.env.SHEET_ID || '1EjVwklOd6Tzf_o9Y34swuH_UZI4aqc_tCZhF7P9lPR0'
const SHEET_TAB = process.env.SHEET_TAB || '' // empty = first tab
const QUAL_VALUE = (process.env.QUAL_VALUE || 'квал').toLowerCase()
const VERIFY = process.argv.includes('--verify')

/**
 * Columns are addressed BY INDEX, not by header name — the export has several
 * near-identical UTM columns and a name lookup is one relabel away from silently
 * picking the wrong one.
 */
const COL = {
  date: 0, // A  Дата создания   DD.MM.YYYY HH:MM
  stage: 5, // F  Этап
  country: 6, // G  Страна          Russian name
  referer: 7, // H  Referer         full landing URL — the real utm_content lives here
  content: 9, // J  UTM Content     mangled by Sheets; fallback only
  campaign: 11, // L  UTM ID        = {{campaign.id}}
  adset: 12, // M  UTM Term         = {{adset.id}}
  campaign_name: 13, // N  utm_campaign = campaign name (fallback join key)
  qual: 14, // O  Квал             "" | "квал"   ← the qualification flag
}

/** Header cells that must match exactly, or the tab/layout changed under us. */
const EXPECTED_HEADER = {
  0: 'Дата создания',
  5: 'Этап',
  6: 'Страна',
  7: 'Referer',
  9: 'UTM Content',
  11: 'UTM ID',
  12: 'UTM Term',
  13: 'utm_campaign',
  14: 'Квал',
}

// ------------------------------------------------------------- utilities ----
/** RFC4180-ish CSV parser: handles quoted fields, escaped quotes and embedded newlines. */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const cell = (row, i) => (row[i] === undefined ? '' : String(row[i]).trim())
const norm = (s) => String(s || '').trim().toLowerCase()
/** Meta object ids are long digit strings; used to tell an id from a name. */
const looksLikeId = (s) => /^\d{10,}$/.test(String(s || '').trim())

/** "28.07.2026 00:10" -> "2026-07-28"; returns null on anything else. */
function toIso(ddmmyyyy) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(String(ddmmyyyy).trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/** Pull one query parameter out of a landing URL, tolerating malformed URLs. */
function queryParam(url, key) {
  const raw = String(url || '')
  if (!raw) return ''
  const m = new RegExp(`[?&#]${key}=([^&#]*)`, 'i').exec(raw)
  if (!m) return ''
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim()
  } catch {
    return m[1].trim()
  }
}

function bump(map, key, qual) {
  let v = map.get(key)
  if (!v) {
    v = { leads: 0, qual: 0 }
    map.set(key, v)
  }
  v.leads++
  if (qual) v.qual++
}

// ------------------------------------------------------------------- main ---
async function main() {
  if (!existsSync(DATA_FILE)) {
    throw new Error('.data/latest.json not found — run fetch-meta.mjs first')
  }
  const ds = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'))

  const url =
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv` +
    (SHEET_TAB ? `&sheet=${encodeURIComponent(SHEET_TAB)}` : '')
  console.log(`▶ CRM sheet ${SHEET_ID}${SHEET_TAB ? ` · tab "${SHEET_TAB}"` : ' · first tab'}`)

  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) {
    throw new Error(
      `sheet fetch failed: HTTP ${res.status}. ` +
        'If link sharing was turned off, switch to a service account + Sheets API.',
    )
  }
  const csv = await res.text()
  const rows = parseCsv(csv).filter((r) => r.some((c) => String(c).trim() !== ''))
  if (!rows.length) throw new Error('sheet returned no rows')

  // ---- header validation ----------------------------------------------------
  // Critical: gviz does NOT 404 on a wrong tab name — it silently serves the FIRST
  // tab instead. Without this check the pipeline would happily encrypt garbage.
  const hdr = rows[0]
  const bad = Object.entries(EXPECTED_HEADER).filter(([i, name]) => cell(hdr, Number(i)) !== name)
  if (bad.length) {
    console.error('✖ unexpected header — wrong tab, or the sheet layout changed.')
    console.error(`  got: ${hdr.map((h, i) => `${i}:${h}`).join(' | ')}`)
    for (const [i, name] of bad) {
      console.error(`  col ${i}: expected "${name}", got "${cell(hdr, Number(i))}"`)
    }
    throw new Error('CRM header validation failed')
  }
  const body = rows.slice(1)
  console.log(`  ${body.length} data rows`)

  // ---- lookups from the Meta side -------------------------------------------
  const campById = new Map(ds.campaigns.map((c) => [c.id, c]))
  const campByName = new Map(ds.campaigns.map((c) => [norm(c.name), c]))
  const adsetById = new Map(ds.adsets.map((s) => [s.id, s]))
  const adById = new Map(ds.ads.map((a) => [a.id, a]))
  /** campaign_id -> (normalised ad name -> canonical ad name). */
  const adsByCampaign = new Map()
  for (const a of ds.ads) {
    let m = adsByCampaign.get(a.campaign_id)
    if (!m) adsByCampaign.set(a.campaign_id, (m = new Map()))
    if (!m.has(norm(a.name))) m.set(norm(a.name), a.name)
  }

  /**
   * Resolve utm_content to an ad name inside a campaign. Three shapes show up:
   *   "002_in_batumi"  — the ad name verbatim (normal case)
   *   "120250002289650776" — an ad id (older URL-tag scheme on campaign 003)
   *   "1"              — Sheets stripped the leading zero off "01"
   */
  function resolveAd(rawContent, campaignId) {
    const raw = String(rawContent || '').trim()
    if (!raw) return null
    const byName = adsByCampaign.get(campaignId)
    if (!byName) return null
    const direct = byName.get(norm(raw))
    if (direct) return direct
    if (looksLikeId(raw)) {
      const ad = adById.get(raw)
      if (ad && ad.campaign_id === campaignId) return ad.name
      return null
    }
    // numeric shorthand: compare with leading zeros stripped on both sides
    if (/^\d+$/.test(raw)) {
      const want = String(Number(raw))
      for (const [n, canonical] of byName) {
        if (/^\d+$/.test(n) && String(Number(n)) === want) return canonical
      }
    }
    return null
  }

  const MIN = ds.date_min
  const MAX = ds.date_max

  // ---- aggregate -------------------------------------------------------------
  const daily = new Map() // `${date}|${campaign_id}|${adset_id}|${ad_key}` -> {leads,qual}
  const stages = new Map() // `${date}|${campaign_id}|${stage}` -> n
  const geo = new Map() // `${date}|${campaign_id}|${iso}` -> {leads,qual}
  const unmatched = {
    unknown_campaign: 0, // campaign not in the dashboard window (older flights)
    unknown_ad: 0, // campaign matched but the ad no longer exists in the account
    macro: 0, // Meta never substituted the {{...}} macro
    no_utm: 0,
    bad_date: 0,
    out_of_window: 0,
    unknown_country: 0, // country name the mapping does not recognise
    examples: {},
  }
  const noteExample = (bucket, value) => {
    const arr = (unmatched.examples[bucket] ||= [])
    if (value && arr.length < 5 && !arr.includes(value)) arr.push(value)
  }

  let inWindow = 0
  let matched = 0
  let qualTotal = 0
  let adResolved = 0
  let adsetResolved = 0
  const isoSeen = new Set()

  for (const r of body) {
    const iso = toIso(cell(r, COL.date))
    if (!iso) {
      unmatched.bad_date++
      continue
    }
    if (iso < MIN || iso > MAX) {
      unmatched.out_of_window++
      continue
    }
    inWindow++

    const referer = cell(r, COL.referer)
    const rawCampId = cell(r, COL.campaign) || queryParam(referer, 'utm_id')
    const rawCampName = cell(r, COL.campaign_name) || queryParam(referer, 'utm_campaign')
    const isQual = cell(r, COL.qual).toLowerCase() === QUAL_VALUE

    if (!rawCampId && !rawCampName) {
      unmatched.no_utm++
      continue
    }
    if (rawCampId.includes('{{') || rawCampName.includes('{{')) {
      unmatched.macro++
      noteExample('macro', rawCampId || rawCampName)
      continue
    }

    // id first — it survives campaign renames; the name is the fallback
    const camp = campById.get(rawCampId) || campByName.get(norm(rawCampName))
    if (!camp) {
      // Older flights still produce late leads. They are excluded on purpose:
      // their spend is outside the window, so counting their quals would make
      // CPQL wrong. They surface in the diagnostics chip instead.
      unmatched.unknown_campaign++
      noteExample('unknown_campaign', rawCampName || rawCampId)
      continue
    }

    const rawAdset = cell(r, COL.adset) || queryParam(referer, 'utm_term')
    const adset = adsetById.get(rawAdset)
    const adsetKey = adset && adset.campaign_id === camp.id ? adset.id : ''
    if (adsetKey) adsetResolved++

    // the Referer keeps the raw query string; column J is mangled, so it is second
    const rawAd = queryParam(referer, 'utm_content') || cell(r, COL.content)
    const adKey = resolveAd(rawAd, camp.id)
    if (adKey) adResolved++
    else {
      unmatched.unknown_ad++
      noteExample('unknown_ad', rawAd || '(пусто)')
      // still counted at campaign level — only the creative gallery misses it
    }

    matched++
    if (isQual) qualTotal++
    bump(daily, `${iso}|${camp.id}|${adsetKey}|${adKey || ''}`, isQual)

    // campaign_id rides along so the UI can filter these blocks by language too
    const stage = cell(r, COL.stage)
    if (stage) {
      const k = `${iso}|${camp.id}|${stage}`
      stages.set(k, (stages.get(k) || 0) + 1)
    }

    const country = cell(r, COL.country)
    const isoCountry = isoFromRu(country)
    if (isoCountry) {
      isoSeen.add(isoCountry)
      bump(geo, `${iso}|${camp.id}|${isoCountry}`, isQual)
    } else if (country && country !== '—') {
      unmatched.unknown_country++
      noteExample('unknown_country', country)
    }
  }

  const crm = {
    source: 'google_sheets',
    sheet_id: SHEET_ID,
    tab: SHEET_TAB || '(первая вкладка)',
    fetched_at: new Date().toISOString(),
    qual_value: QUAL_VALUE,
    rows_total: body.length,
    rows_in_window: inWindow,
    rows_matched: matched,
    qual_total: qualTotal,
    ads_resolved: adResolved,
    adsets_resolved: adsetResolved,
    daily: [...daily.entries()]
      .map(([k, v]) => {
        const [date, campaign_id, adset_id, ad_key] = k.split('|')
        return {
          date,
          campaign_id,
          adset_id: adset_id || null,
          ad_key: ad_key || null,
          leads: v.leads,
          qual: v.qual,
        }
      })
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
    stages: [...stages.entries()]
      .map(([k, n]) => {
        const [date, campaign_id, stage] = k.split('|')
        return { date, campaign_id, stage, n }
      })
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
    geo: [...geo.entries()]
      .map(([k, v]) => {
        const [date, campaign_id, country] = k.split('|')
        return { date, campaign_id, country, leads: v.leads, qual: v.qual }
      })
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
    unmatched,
  }

  ds.crm = crm
  // countries the CRM knows about but Meta never delivered to (e.g. a lead who
  // clicked while abroad) still need a display name
  ds.country_names = { ...(ds.country_names || {}) }
  for (const iso of isoSeen) if (!ds.country_names[iso]) ds.country_names[iso] = ruFromIso(iso)

  await fs.writeFile(DATA_FILE, JSON.stringify(ds, null, 2))
  console.log(`✔ Wrote crm block into ${path.relative(ROOT, DATA_FILE)}`)

  // ---- cross-check -----------------------------------------------------------
  const metaLeads = ds.daily.reduce((s, r) => s + r.leads, 0)
  const metaSpend = ds.daily.reduce((s, r) => s + r.spend, 0)
  const rate = metaLeads ? (matched / metaLeads) * 100 : 0
  console.log('\n──── CRM cross-check ────')
  console.log(`  window            ${MIN} → ${MAX}`)
  console.log(`  rows in window    ${inWindow}`)
  console.log(`  matched to Meta   ${matched}  (${rate.toFixed(1)}% of ${metaLeads} Meta leads)`)
  console.log(`  ad resolved       ${adResolved}/${matched} · adset resolved ${adsetResolved}/${matched}`)
  console.log(`  qualified         ${qualTotal}  (${matched ? ((qualTotal / matched) * 100).toFixed(1) : 0}% of matched)`)
  console.log(`  CPQL              $${qualTotal ? (metaSpend / qualTotal).toFixed(2) : '—'}`)
  console.log(`  countries         ${isoSeen.size} mapped · ${unmatched.unknown_country} unmapped rows`)
  console.log(
    `  unmatched         macro ${unmatched.macro} · unknown campaign ${unmatched.unknown_campaign} · ` +
      `unknown ad ${unmatched.unknown_ad} · no utm ${unmatched.no_utm} · out of window ${unmatched.out_of_window}`,
  )
  if (Object.keys(unmatched.examples).length) {
    for (const [k, v] of Object.entries(unmatched.examples)) console.log(`    ${k}: ${v.join(' , ')}`)
  }

  // Structural guards — these signal real breakage, not normal day-to-day drift.
  if (!inWindow) throw new Error('no CRM rows inside the dashboard window — check MIN_DATE / tab')
  if (rate < 50) {
    throw new Error(`CRM match rate ${rate.toFixed(1)}% is below the 50% floor — UTM join likely broken`)
  }
  // The country column drives a whole table; a burst of unrecognised spellings
  // must not quietly shrink it.
  if (unmatched.unknown_country > inWindow * 0.1) {
    throw new Error(
      `${unmatched.unknown_country} rows have an unrecognised country — add them to scripts/countries.mjs`,
    )
  }

  // ---- frozen expectations (opt-in, --verify) --------------------------------
  // Not run in CI: the sheet grows daily, so these numbers drift by design.
  // They exist to prove the join on the snapshot it was built against.
  if (VERIFY) {
    const byCamp = new Map()
    for (const r of crm.daily) {
      const v = byCamp.get(r.campaign_id) || { leads: 0, qual: 0 }
      v.leads += r.leads
      v.qual += r.qual
      byCamp.set(r.campaign_id, v)
    }
    const geoOf = (iso) =>
      crm.geo.filter((g) => g.country === iso).reduce((s, g) => s + g.qual, 0)
    const c006 = ds.campaigns.find((c) => c.name.startsWith('006_EN'))
    const expect = [
      ['rows in window', inWindow, 95],
      ['matched', matched, 95],
      ['qualified', qualTotal, 12],
      ['unmapped countries', unmatched.unknown_country, 0],
      ['006_EN leads', byCamp.get(c006?.id)?.leads, 53],
      ['006_EN qualified', byCamp.get(c006?.id)?.qual, 7],
      ['Israel qualified', geoOf('IL'), 2],
      ['Ukraine qualified', geoOf('UA'), 2],
    ]
    console.log('\n──── --verify against the 29.07.2026 snapshot ────')
    let failed = 0
    for (const [label, got, want] of expect) {
      const ok = got === want
      if (!ok) failed++
      console.log(`  ${ok ? '✔' : '✖'} ${label}: got ${got}, expected ${want}`)
    }
    if (failed) throw new Error(`${failed} frozen expectation(s) failed`)
    console.log('  all frozen expectations hold')
  }
}

main().catch((e) => {
  console.error('✖ CRM pipeline failed:', e.message)
  process.exit(1)
})
