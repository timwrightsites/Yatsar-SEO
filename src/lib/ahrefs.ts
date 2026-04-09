/**
 * Ahrefs API v3 helper.
 *
 * Reads AHREFS_API_KEY from env. All requests authenticate via
 * `Authorization: Bearer <key>`. Responses are cached in the
 * `ahrefs_snapshots` Supabase table for 7 days per (client_id, endpoint, params).
 * The `date` param is bucketed to the most recent Monday so the cache key
 * stays stable for an entire week — instead of rotating at midnight UTC.
 *
 * Endpoint references (Ahrefs API v3, docs.ahrefs.com):
 *   GET /v3/site-explorer/domain-rating
 *   GET /v3/site-explorer/metrics
 *   GET /v3/site-explorer/organic-keywords
 *   GET /v3/site-explorer/top-pages
 *   GET /v3/site-explorer/organic-competitors
 *
 * Standard plan caps responses at 25 rows per request, so anywhere we accept
 * a `limit` we also clamp to 25 to keep the contract honest.
 */

import { createHash } from 'crypto'
// Use a loose type for the supabase client so we don't have to import the
// project-specific Database type into this helper.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any

const AHREFS_BASE_URL  = 'https://api.ahrefs.com/v3'
// 7-day cache. Combined with the weekly date bucket below this means each
// (client, endpoint, params) combination costs at most ~1 Ahrefs request
// per week. The refresh button on the panel sends `?fresh=1` to force-bypass.
const CACHE_TTL_HOURS  = 24 * 7
const STANDARD_ROW_CAP = 25

export class AhrefsKeyMissingError extends Error {
  constructor() { super('AHREFS_API_KEY is not set') }
}

export class AhrefsApiError extends Error {
  status: number
  body:   string
  constructor(status: number, body: string) {
    super(`Ahrefs API error ${status}: ${body.slice(0, 300)}`)
    this.status = status
    this.body   = body
  }
}

function getKey(): string {
  const key = process.env.AHREFS_API_KEY
  if (!key) throw new AhrefsKeyMissingError()
  return key
}

// Returns the ISO date of the most recent Monday (UTC). We use this as the
// `date` param for Ahrefs requests so the cache key stays stable for an
// entire week — instead of rotating at midnight UTC every day. Ahrefs only
// updates these metrics every few days anyway, so daily re-fetches were
// just burning credits.
function weekBucketISO(): string {
  const d   = new Date()
  const day = d.getUTCDay()                  // 0 (Sun) – 6 (Sat)
  const diff = day === 0 ? 6 : day - 1       // days since Monday
  d.setUTCDate(d.getUTCDate() - diff)
  return d.toISOString().slice(0, 10)
}

function hashParams(params: Record<string, string | number | undefined>): string {
  const sorted = Object.keys(params)
    .filter(k => params[k] !== undefined)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&')
  return createHash('sha1').update(sorted).digest('hex').slice(0, 16)
}

// ── Cache layer ──────────────────────────────────────────────────────────────

interface CacheRow {
  payload:    unknown
  fetched_at: string
}

async function readCache(
  supabase:    SupabaseClient,
  clientId:    string,
  endpoint:    string,
  paramsHash:  string,
): Promise<unknown | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('ahrefs_snapshots')
    .select('payload, fetched_at')
    .eq('client_id', clientId)
    .eq('endpoint', endpoint)
    .eq('params_hash', paramsHash)
    .maybeSingle() as { data: CacheRow | null }

  if (!data) return null
  const ageMs = Date.now() - new Date(data.fetched_at).getTime()
  if (ageMs > CACHE_TTL_HOURS * 60 * 60 * 1000) return null
  return data.payload
}

async function writeCache(
  supabase:   SupabaseClient,
  clientId:   string,
  endpoint:   string,
  paramsHash: string,
  payload:    unknown,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('ahrefs_snapshots')
    .upsert({
      client_id:   clientId,
      endpoint,
      params_hash: paramsHash,
      payload,
      fetched_at:  new Date().toISOString(),
    }, { onConflict: 'client_id,endpoint,params_hash' })
}

// ── Core fetch with cache ────────────────────────────────────────────────────

interface FetchOpts {
  supabase:   SupabaseClient
  clientId:   string
  endpoint:   string                                       // e.g. 'site-explorer/metrics'
  params:     Record<string, string | number | undefined>
  forceFresh?: boolean
}

export async function ahrefsGet({ supabase, clientId, endpoint, params, forceFresh }: FetchOpts): Promise<unknown> {
  const key  = getKey()
  const hash = hashParams(params)

  if (!forceFresh) {
    const cached = await readCache(supabase, clientId, endpoint, hash)
    if (cached) return cached
  }

  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.append(k, String(v))
  }

  const url = `${AHREFS_BASE_URL}/${endpoint}?${qs.toString()}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept:        'application/json',
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new AhrefsApiError(res.status, body)
  }

  const json = await res.json()
  await writeCache(supabase, clientId, endpoint, hash, json)
  return json
}

// ── Endpoint wrappers ────────────────────────────────────────────────────────
//
// Endpoint signatures captured directly from the Ahrefs UI's "Pull this report
// with API v3" feature for trustalrecruiting.com on 2026-04-07. These match
// Ahrefs' own canonical request shape — no mode/protocol/volume_mode needed.
//
// Convention: `target` is normalized to end with `/` (Ahrefs' canonical URL form).

function normalizeTarget(target: string): string {
  // Strip protocol if present, then ensure trailing slash.
  const stripped = target.replace(/^https?:\/\//, '')
  return stripped.endsWith('/') ? stripped : `${stripped}/`
}

function lastMonthISO(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  return d.toISOString().slice(0, 10)
}

export interface OverviewParams {
  supabase:   SupabaseClient
  clientId:   string
  target:     string
  forceFresh?: boolean
}

/**
 * Calls three endpoints in parallel and merges them into a single overview
 * payload — matching what the Ahrefs UI shows in the "Site Explorer Overview"
 * top KPI strip:
 *
 *   GET /v3/site-explorer/domain-rating   → DR + Ahrefs Rank
 *   GET /v3/site-explorer/metrics         → org/paid traffic, keywords, value
 *   GET /v3/site-explorer/backlinks-stats → backlinks, refdomains
 *
 * Cost: 3 × 50 = ~150 units per refresh per client.
 */
export async function fetchOverview({ supabase, clientId, target, forceFresh }: OverviewParams) {
  const t    = normalizeTarget(target)
  const date = weekBucketISO()

  const [dr, metrics, backlinks] = await Promise.all([
    ahrefsGet({
      supabase, clientId, forceFresh,
      endpoint: 'site-explorer/domain-rating',
      params:   { target: t, date },
    }),
    ahrefsGet({
      supabase, clientId, forceFresh,
      endpoint: 'site-explorer/metrics',
      params:   { target: t, date },
    }),
    ahrefsGet({
      supabase, clientId, forceFresh,
      endpoint: 'site-explorer/backlinks-stats',
      params:   { target: t, date },
    }),
  ])

  return { domain_rating: dr, metrics, backlinks_stats: backlinks }
}

export interface OrganicKeywordsParams {
  supabase:   SupabaseClient
  clientId:   string
  target:     string
  limit?:     number
  offset?:    number
  country?:   string
  forceFresh?: boolean
}

// The exact select set the Ahrefs UI sends for the Organic Keywords report.
// We trim a few fields we don't render to keep the row cost down (every
// field you select adds to the row cost on a per-call basis).
const ORGANIC_KEYWORDS_SELECT = [
  'keyword_merged',
  'volume_merged',
  'keyword_difficulty_merged',
  'cpc_merged',
  'sum_traffic',
  'sum_traffic_prev',
  'best_position',
  'best_position_prev',
  'best_position_diff',
  'best_position_url',
  'is_branded',
  'is_local',
  'is_navigational',
  'is_informational',
  'is_commercial',
  'is_transactional',
].join(',')

export async function fetchOrganicKeywords({
  supabase, clientId, target, limit = STANDARD_ROW_CAP, offset = 0, country, forceFresh,
}: OrganicKeywordsParams) {
  return ahrefsGet({
    supabase, clientId, forceFresh,
    endpoint: 'site-explorer/organic-keywords',
    params: {
      target:        normalizeTarget(target),
      date:          weekBucketISO(),
      date_compared: lastMonthISO(),
      country:       country ?? 'us',
      select:        ORGANIC_KEYWORDS_SELECT,
      order_by:      'sum_traffic_merged:desc',
      limit:         Math.min(limit, STANDARD_ROW_CAP),
      offset,
    },
  })
}

export interface TopPagesParams {
  supabase:   SupabaseClient
  clientId:   string
  target:     string
  limit?:     number
  offset?:    number
  country?:   string
  forceFresh?: boolean
}

// Real column names confirmed via 400-error response from Ahrefs:
// available columns include url, sum_traffic_merged, value, keywords,
// top_keyword_best_position_prev, top_keyword_prev, traffic_diff, etc.
// (NB: top-pages does NOT use the `_merged` suffix on value/keywords —
// only `sum_traffic_merged`. Different convention from organic-keywords.)
const TOP_PAGES_SELECT = [
  'url',
  'sum_traffic_merged',
  'value',
  'keywords',
  'top_keyword',
  'top_keyword_best_position',
].join(',')

export async function fetchTopPages({
  supabase, clientId, target, limit = STANDARD_ROW_CAP, offset = 0, country, forceFresh,
}: TopPagesParams) {
  return ahrefsGet({
    supabase, clientId, forceFresh,
    endpoint: 'site-explorer/top-pages',
    params: {
      target:        normalizeTarget(target),
      date:          weekBucketISO(),
      date_compared: lastMonthISO(),
      country:       country ?? 'us',
      select:        TOP_PAGES_SELECT,
      order_by:      'sum_traffic_merged:desc',
      limit:         Math.min(limit, STANDARD_ROW_CAP),
      offset,
    },
  })
}

export interface CompetitorsParams {
  supabase:   SupabaseClient
  clientId:   string
  target:     string
  limit?:     number
  forceFresh?: boolean
}

// Exact select set captured from the Ahrefs UI's "Organic Competitors" report.
const COMPETITORS_SELECT = [
  'competitor_domain',
  'domain_rating',
  'keywords_common',
  'keywords_competitor',
  'keywords_target',
  'share',
  'traffic_merged',
  'value_merged',
].join(',')

export async function fetchCompetitors({
  supabase, clientId, target, limit = STANDARD_ROW_CAP, forceFresh,
}: CompetitorsParams) {
  return ahrefsGet({
    supabase, clientId, forceFresh,
    endpoint: 'site-explorer/organic-competitors',
    params: {
      target:        normalizeTarget(target),
      date:          weekBucketISO(),
      date_compared: lastMonthISO(),
      country:       'us',
      select:        COMPETITORS_SELECT,
      order_by:      'share:desc',
      limit:         Math.min(limit, STANDARD_ROW_CAP),
    },
  })
}

// ── Referring domains (used by Link Bot for link-gap analysis) ──────────────
//
// Pulls the unique referring domains pointing at a given target. The Link
// Bot calls this for both the client and each competitor, then computes the
// gap (domains linking to N competitors but not to the client).
//
// Cost: ~50 units per call. With 1 client + 5 competitors = 6 calls per
// link task on a cold cache, then 0 for the rest of the week thanks to the
// existing weekly cache bucket.

export interface ReferringDomainsParams {
  supabase:    SupabaseClient
  clientId:    string
  target:      string
  limit?:      number
  forceFresh?: boolean
}

const REFDOMAINS_SELECT = [
  'domain',
  'domain_rating',
  'traffic_domain',
  'dofollow_links_to_target',
  'links_to_target',
  'first_seen',
  'last_seen',
].join(',')

export async function fetchReferringDomains({
  supabase, clientId, target, limit = STANDARD_ROW_CAP, forceFresh,
}: ReferringDomainsParams) {
  return ahrefsGet({
    supabase, clientId, forceFresh,
    endpoint: 'site-explorer/refdomains',
    params: {
      target:    normalizeTarget(target),
      date:      weekBucketISO(),
      select:    REFDOMAINS_SELECT,
      order_by:  'domain_rating:desc',
      limit:     Math.min(limit, STANDARD_ROW_CAP),
    },
  })
}

// ── GEO (Generative Engine Optimization) visibility ─────────────────────────
//
// Pulls the client's organic-keywords slice with `serp_features` so we can
// identify which ranking keywords surface an AI Overview (Google SGE/AI Mode)
// or other generative SERP features. The Ahrefs `serp_features` column is an
// array of feature codes per keyword — `ai_overview` is the one we care about
// for GEO scoring. Other generative-relevant codes we surface:
//   - ai_overview      (Google AI Overview / SGE / AI Mode block)
//   - knowledge_panel  (entity card — adjacent signal, not strict GEO)
//   - featured_snippet (the pre-AI ancestor of an AI Overview answer)
//   - discussions_and_forums (Reddit/Quora pulls — proxy for AI source set)
//
// We pull two pages (top 50 by traffic) so the GEO panel can compute a
// meaningful "AI Overview presence rate" rather than judging off 25 rows.

export interface GeoVisibilityParams {
  supabase:   SupabaseClient
  clientId:   string
  target:     string
  country?:   string
  limit?:     number
  forceFresh?: boolean
}

const GEO_SELECT = [
  'keyword_merged',
  'volume_merged',
  'keyword_difficulty_merged',
  'sum_traffic',
  'best_position',
  'best_position_url',
  'serp_features',
  'is_branded',
  'is_informational',
  'is_commercial',
].join(',')

export interface GeoKeywordRow {
  keyword:        string
  volume:         number
  difficulty:     number
  traffic:        number
  position:       number
  url:            string | null
  serp_features:  string[]
  has_ai_overview:    boolean
  has_featured_snippet: boolean
  has_knowledge_panel:  boolean
  is_branded:     boolean
}

export interface GeoVisibilityReport {
  target:                string
  country:               string
  fetched_at:            string
  total_keywords_sampled: number
  ai_overview_count:     number
  ai_overview_rate:      number   // 0..1
  ai_overview_traffic:   number   // sum of `sum_traffic` for AI-Overview rows
  featured_snippet_count: number
  knowledge_panel_count:  number
  branded_ai_count:      number   // how many AI-Overview keywords are branded
  keywords:              GeoKeywordRow[]
}

// Internal Ahrefs response shape — we keep it loose because the API returns
// `keywords` or sometimes a paginated envelope depending on endpoint version.
interface AhrefsKeywordsEnvelope {
  keywords?: Array<Record<string, unknown>>
  // some Ahrefs envelopes also use `data`
  data?: Array<Record<string, unknown>>
}

function coerceArray(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== 'object') return []
  const env = payload as AhrefsKeywordsEnvelope
  if (Array.isArray(env.keywords)) return env.keywords
  if (Array.isArray(env.data))     return env.data
  return []
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function asNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

// `serp_features` may come back as an array of strings, an array of objects,
// or a comma-joined string depending on Ahrefs' response shape for the
// endpoint version. We normalize to lowercase string codes.
function normalizeSerpFeatures(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .map((item) => {
        if (typeof item === 'string') return item.toLowerCase()
        if (item && typeof item === 'object' && 'name' in item) {
          return String((item as { name: unknown }).name ?? '').toLowerCase()
        }
        if (item && typeof item === 'object' && 'feature' in item) {
          return String((item as { feature: unknown }).feature ?? '').toLowerCase()
        }
        return ''
      })
      .filter(Boolean)
  }
  if (typeof v === 'string') {
    return v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  }
  return []
}

export async function fetchGeoVisibility({
  supabase, clientId, target, country, limit = 50, forceFresh,
}: GeoVisibilityParams): Promise<GeoVisibilityReport> {
  const t        = normalizeTarget(target)
  const cap      = Math.min(limit, 100)
  const country_ = country ?? 'us'

  // Two-page pull so we can sample 50 rows on a Standard plan (25/page).
  const pages    = Math.ceil(cap / STANDARD_ROW_CAP)
  const pulls    = await Promise.all(
    Array.from({ length: pages }).map((_, i) =>
      ahrefsGet({
        supabase, clientId, forceFresh,
        endpoint: 'site-explorer/organic-keywords',
        params: {
          target:        t,
          date:          weekBucketISO(),
          date_compared: lastMonthISO(),
          country:       country_,
          select:        GEO_SELECT,
          order_by:      'sum_traffic_merged:desc',
          limit:         STANDARD_ROW_CAP,
          offset:        i * STANDARD_ROW_CAP,
        },
      }),
    ),
  )

  const rawRows = pulls.flatMap(coerceArray).slice(0, cap)

  const rows: GeoKeywordRow[] = rawRows.map((r) => {
    const features = normalizeSerpFeatures(r.serp_features)
    return {
      keyword:        asString(r.keyword_merged ?? r.keyword),
      volume:         asNumber(r.volume_merged ?? r.volume),
      difficulty:     asNumber(r.keyword_difficulty_merged ?? r.keyword_difficulty),
      traffic:        asNumber(r.sum_traffic ?? r.sum_traffic_merged),
      position:       asNumber(r.best_position),
      url:            asString(r.best_position_url) || null,
      serp_features:  features,
      has_ai_overview:      features.includes('ai_overview') || features.includes('ai_overviews'),
      has_featured_snippet: features.includes('featured_snippet'),
      has_knowledge_panel:  features.includes('knowledge_panel'),
      is_branded:     Boolean(r.is_branded),
    }
  })

  const aiRows           = rows.filter(r => r.has_ai_overview)
  const featuredSnippets = rows.filter(r => r.has_featured_snippet).length
  const knowledgePanels  = rows.filter(r => r.has_knowledge_panel).length

  return {
    target:                 t,
    country:                country_,
    fetched_at:             new Date().toISOString(),
    total_keywords_sampled: rows.length,
    ai_overview_count:      aiRows.length,
    ai_overview_rate:       rows.length > 0 ? aiRows.length / rows.length : 0,
    ai_overview_traffic:    aiRows.reduce((sum, r) => sum + r.traffic, 0),
    featured_snippet_count: featuredSnippets,
    knowledge_panel_count:  knowledgePanels,
    branded_ai_count:       aiRows.filter(r => r.is_branded).length,
    keywords:               rows,
  }
}
