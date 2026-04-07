/**
 * Ahrefs context builder for the SEO Co Strategist agent.
 *
 * Fetches a client's headline Ahrefs data (DR, top keywords, top pages,
 * competitors) using the existing cached helpers in `lib/ahrefs.ts` and
 * formats it as a single Markdown block that gets injected into the agent's
 * system prompt. This gives the strategist real visibility into the client's
 * SEO state instead of guessing from training data.
 *
 * Cost: ~5 Ahrefs requests on a cold cache (overview is 3 in parallel,
 * plus keywords + top pages + competitors). Subsequent calls in the same
 * weekly cache bucket cost zero — see `weekBucketISO()` in lib/ahrefs.ts.
 *
 * Failure mode: if AHREFS_API_KEY is missing or any fetch errors, the
 * builder swallows the error, logs a warning, and returns an empty string.
 * The agent route will simply not inject any Ahrefs context that turn —
 * the chat still works.
 */

import {
  fetchOverview,
  fetchOrganicKeywords,
  fetchTopPages,
  fetchCompetitors,
  AhrefsKeyMissingError,
} from './ahrefs'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any

export interface BuildContextParams {
  supabase: SupabaseClient
  clientId: string
  domain:   string
}

// ── Field pickers (lenient — match the same shapes the panel normalizers use)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pick(obj: any, ...keys: string[]): any {
  if (!obj || typeof obj !== 'object') return undefined
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k]
  return undefined
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowsOf(obj: any, ...keys: string[]): any[] {
  for (const k of keys) {
    const v = obj?.[k]
    if (Array.isArray(v)) return v
  }
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) if (Array.isArray(obj[k])) return obj[k]
  }
  return []
}

function fmtNum(n: unknown, digits = 0): string {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return '0'
  return v.toLocaleString('en-US', { maximumFractionDigits: digits })
}

// ── Section formatters ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatOverview(raw: any): string {
  if (!raw) return ''
  const drInner = raw.domain_rating?.domain_rating ?? raw.domain_rating ?? {}
  const mInner  = raw.metrics?.metrics             ?? raw.metrics       ?? {}
  const bInner  = raw.backlinks_stats?.metrics     ?? raw.backlinks_stats ?? {}

  const dr        = pick(drInner, 'domain_rating')
  const traffic   = pick(mInner,  'org_traffic', 'organic_traffic')
  const keywords  = pick(mInner,  'org_keywords', 'organic_keywords')
  const value     = pick(mInner,  'org_cost', 'traffic_value')
  const refDom    = pick(bInner,  'refdomains', 'ref_domains', 'referring_domains')
  const backlinks = pick(bInner,  'live', 'backlinks')

  const lines = [
    '### Site overview',
    `- Domain Rating: **${fmtNum(dr)}**`,
    `- Organic monthly traffic: **${fmtNum(traffic)}** visits`,
    `- Organic keywords ranking: **${fmtNum(keywords)}**`,
    `- Estimated traffic value: **$${fmtNum(value)}**/mo`,
    `- Referring domains: **${fmtNum(refDom)}**`,
    `- Backlinks (live): **${fmtNum(backlinks)}**`,
  ]
  return lines.join('\n')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatKeywords(raw: any): string {
  const rows = rowsOf(raw, 'keywords', 'organic_keywords')
  if (!rows.length) return ''
  const lines = ['### Top 25 organic keywords (by traffic)']
  lines.push('| # | Keyword | Pos | Vol | KD | Traffic | URL |')
  lines.push('|---|---------|-----|-----|----|---------|-----|')
  rows.slice(0, 25).forEach((r, i) => {
    const kw   = String(pick(r, 'keyword_merged', 'keyword') ?? '').replace(/\|/g, '\\|')
    const pos  = pick(r, 'best_position', 'position')
    const vol  = pick(r, 'volume_merged', 'volume', 'search_volume')
    const kd   = pick(r, 'keyword_difficulty_merged', 'keyword_difficulty', 'difficulty')
    const traf = pick(r, 'sum_traffic', 'traffic')
    const url  = String(pick(r, 'best_position_url', 'url') ?? '/').replace(/\|/g, '\\|')
    lines.push(`| ${i + 1} | ${kw} | ${fmtNum(pos)} | ${fmtNum(vol)} | ${fmtNum(kd)} | ${fmtNum(traf)} | ${url} |`)
  })
  return lines.join('\n')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatTopPages(raw: any): string {
  const rows = rowsOf(raw, 'pages', 'top_pages')
  if (!rows.length) return ''
  const lines = ['### Top 25 pages (by traffic)']
  lines.push('| # | URL | Traffic | Value | Keywords | Top keyword |')
  lines.push('|---|-----|---------|-------|----------|-------------|')
  rows.slice(0, 25).forEach((r, i) => {
    const url   = String(pick(r, 'url', 'raw_url') ?? '/').replace(/\|/g, '\\|')
    const traf  = pick(r, 'sum_traffic_merged', 'sum_traffic', 'traffic')
    const val   = pick(r, 'value', 'value_merged', 'traffic_value')
    const kws   = pick(r, 'keywords', 'sum_keywords_merged', 'sum_keywords')
    const topKw = String(pick(r, 'top_keyword', 'top_keyword_merged') ?? '').replace(/\|/g, '\\|')
    lines.push(`| ${i + 1} | ${url} | ${fmtNum(traf)} | $${fmtNum(val)} | ${fmtNum(kws)} | ${topKw} |`)
  })
  return lines.join('\n')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatCompetitors(raw: any): string {
  const rows = rowsOf(raw, 'competitors', 'organic_competitors', 'domains')
  if (!rows.length) return ''
  const lines = ['### Top organic competitors']
  lines.push('| # | Competitor | DR | Common kw | Their unique kw | Traffic share |')
  lines.push('|---|------------|----|-----------|-----------------|---------------|')
  rows.slice(0, 10).forEach((r, i) => {
    const dom    = String(pick(r, 'competitor_domain', 'domain') ?? '').replace(/\|/g, '\\|')
    const dr     = pick(r, 'domain_rating', 'dr')
    const common = pick(r, 'keywords_common', 'common_keywords')
    const unique = pick(r, 'keywords_competitor', 'competitor_keywords')
    const share  = Number(pick(r, 'share', 'traffic_overlap') ?? 0) * 100
    lines.push(`| ${i + 1} | ${dom} | ${fmtNum(dr)} | ${fmtNum(common)} | ${fmtNum(unique)} | ${share.toFixed(1)}% |`)
  })
  return lines.join('\n')
}

// ── Public entry point ───────────────────────────────────────────────────

/**
 * Builds a Markdown block summarizing the client's Ahrefs data.
 * Returns an empty string if Ahrefs is unavailable for any reason —
 * callers should treat that as "no extra context this turn".
 */
export async function buildAhrefsContext({
  supabase, clientId, domain,
}: BuildContextParams): Promise<string> {
  if (!domain) return ''

  try {
    // All four calls hit the 7-day Supabase cache, so on a warm cache this
    // costs zero Ahrefs units and resolves in milliseconds.
    const [overview, keywords, topPages, competitors] = await Promise.all([
      fetchOverview({       supabase, clientId, target: domain }).catch(silent('overview')),
      fetchOrganicKeywords({ supabase, clientId, target: domain, limit: 25 }).catch(silent('keywords')),
      fetchTopPages({       supabase, clientId, target: domain, limit: 25 }).catch(silent('top-pages')),
      fetchCompetitors({    supabase, clientId, target: domain, limit: 10 }).catch(silent('competitors')),
    ])

    const sections = [
      formatOverview(overview),
      formatKeywords(keywords),
      formatTopPages(topPages),
      formatCompetitors(competitors),
    ].filter(Boolean)

    if (!sections.length) return ''

    return [
      `# Ahrefs context for ${domain}`,
      '',
      'You are looking at the client\'s real, current Ahrefs data below. Use it to ground every recommendation, gap analysis, and proposed task in concrete numbers and URLs from this client — not generic SEO advice.',
      '',
      ...sections,
    ].join('\n\n')
  } catch (err) {
    if (err instanceof AhrefsKeyMissingError) {
      console.warn('[ahrefs-context] AHREFS_API_KEY not set — skipping context injection')
    } else {
      console.warn('[ahrefs-context] Failed to build context:', err)
    }
    return ''
  }
}

function silent(label: string) {
  return (err: unknown) => {
    console.warn(`[ahrefs-context] ${label} fetch failed:`, err)
    return null
  }
}
