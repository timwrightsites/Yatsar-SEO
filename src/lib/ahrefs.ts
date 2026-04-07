/**
 * Ahrefs API v3 helper.
 *
 * Reads AHREFS_API_KEY from env. All requests authenticate via
 * `Authorization: Bearer <key>`. Responses are cached in the
 * `ahrefs_snapshots` Supabase table for 24 hours per (client_id, endpoint, params).
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
const CACHE_TTL_HOURS  = 24
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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
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
  const date = todayISO()

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
      date:          todayISO(),
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

// NOTE: The Ahrefs UI URL for this report wasn't captured. The endpoint
// path and select fields below are best-effort based on the convention
// observed in the other reports. If this 4xxs, grab the URL from the
// "Organic pages by traffic" report's API button and we'll patch.
const TOP_PAGES_SELECT = [
  'url',
  'sum_traffic_merged',
  'value_merged',
  'sum_keywords_merged',
  'top_keyword_merged',
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
      date:          todayISO(),
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
      date:          todayISO(),
      date_compared: lastMonthISO(),
      country:       'us',
      select:        COMPETITORS_SELECT,
      order_by:      'share:desc',
      limit:         Math.min(limit, STANDARD_ROW_CAP),
    },
  })
}
