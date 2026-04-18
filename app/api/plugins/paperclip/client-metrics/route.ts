/**
 * GET /api/plugins/paperclip/client-metrics
 *
 * Endpoint consumed by the Paperclip `yatsar.seo` plugin worker.
 * Returns a flat metrics payload for a single Yatsar client, keyed
 * by one of:
 *
 *   ?companyPrefix=TRU        Paperclip's human-readable URL slug
 *   ?clientId=<uuid>          Yatsar client UUID (direct lookup)
 *   ?companyId=<uuid>         Legacy alias — only works if Paperclip's
 *                             internal company UUID happens to equal
 *                             the Yatsar client UUID. Kept for the
 *                             worker's existing fallback path.
 *
 * Auth: shared bearer token in `PAPERCLIP_PLUGIN_TOKEN`. The plugin's
 * `yatsarApiToken` instance config must match.
 *
 * Shape returned (must match ClientMetricsResponse in the plugin
 * worker — minus the `source` field which the worker stamps itself):
 *
 *   {
 *     clientId, clientName, domain,
 *     domainRating, monthlyOrganic, trackedKeywords, avgPosition,
 *     backlinks, lastSyncedAt
 *   }
 *
 * On success always 200. On auth/lookup failures returns a small JSON
 * error shape the worker treats as "not OK" and falls back to mock.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import {
  fetchOverview,
  AhrefsApiError,
  AhrefsKeyMissingError,
} from '@/lib/ahrefs'

// Always dynamic — we read a per-request bearer header.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface ClientRow {
  id: string
  name: string
  domain: string | null
  paperclip_company_prefix: string | null
}

interface MetricsPayload {
  clientId: string
  clientName: string
  domain: string | null
  domainRating: number | null
  monthlyOrganic: number | null
  trackedKeywords: number
  avgPosition: number | null
  backlinks: number | null
  lastSyncedAt: string
}

// ── Auth ─────────────────────────────────────────────────────────────

function checkAuth(req: NextRequest): NextResponse | null {
  const expected = process.env.PAPERCLIP_PLUGIN_TOKEN
  if (!expected) {
    return NextResponse.json(
      { error: 'PAPERCLIP_PLUGIN_TOKEN not configured on the server' },
      { status: 503 },
    )
  }
  const header = req.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!match || match[1] !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return null
}

// ── Ahrefs response shape helpers ────────────────────────────────────
//
// fetchOverview() returns whatever Ahrefs handed back, so we defensively
// reach into the three sub-payloads. The Ahrefs v3 envelopes follow a
// consistent pattern:
//   domain-rating   -> { domain_rating: { domain_rating: <number>, ahrefs_rank: <number> } }
//   metrics         -> { metrics: { org_keywords, org_traffic, ... } }
//   backlinks-stats -> { metrics: { live: <number>, all_time: <number> } }
//                      or { backlinks: <number>, ... } in some envelopes
// We coerce into numbers and leave null when absent rather than zeroing
// out — null renders as "—" in the widget, which is honest about missing
// data vs. pretending a value is zero.

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function pick(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj
  for (const key of path) {
    if (cur && typeof cur === 'object' && key in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[key]
    } else {
      return undefined
    }
  }
  return cur
}

interface OverviewShape {
  domain_rating: unknown
  metrics: unknown
  backlinks_stats: unknown
}

function extractMetrics(overview: OverviewShape) {
  const dr = asNumber(pick(overview.domain_rating, ['domain_rating', 'domain_rating']))
    ?? asNumber(pick(overview.domain_rating, ['domain_rating']))
    ?? asNumber(pick(overview.domain_rating, ['metrics', 'domain_rating']))

  const orgTraffic =
    asNumber(pick(overview.metrics, ['metrics', 'org_traffic']))
    ?? asNumber(pick(overview.metrics, ['org_traffic']))

  const orgKeywords =
    asNumber(pick(overview.metrics, ['metrics', 'org_keywords']))
    ?? asNumber(pick(overview.metrics, ['org_keywords']))

  const backlinks =
    asNumber(pick(overview.backlinks_stats, ['metrics', 'live']))
    ?? asNumber(pick(overview.backlinks_stats, ['metrics', 'backlinks']))
    ?? asNumber(pick(overview.backlinks_stats, ['backlinks']))

  return {
    domainRating: dr,
    monthlyOrganic: orgTraffic,
    trackedKeywords: orgKeywords ?? 0,
    backlinks,
  }
}

// ── Handler ──────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authFail = checkAuth(req)
  if (authFail) return authFail

  const sp = req.nextUrl.searchParams
  const companyPrefix = sp.get('companyPrefix')?.trim() || null
  const clientId = sp.get('clientId')?.trim() || null
  // Legacy alias — older worker builds only knew about companyId.
  const companyId = sp.get('companyId')?.trim() || null
  const forceFresh = sp.get('fresh') === '1'

  if (!companyPrefix && !clientId && !companyId) {
    return NextResponse.json(
      { error: 'companyPrefix, clientId, or companyId is required' },
      { status: 400 },
    )
  }

  const supabase = createServiceClient()

  // Resolve the Yatsar client row.
  let client: ClientRow | null = null
  let lookupError: string | null = null

  if (companyPrefix) {
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, domain, paperclip_company_prefix')
      .eq('paperclip_company_prefix', companyPrefix)
      .maybeSingle()
    if (error) lookupError = error.message
    client = (data as ClientRow | null) ?? null
  }

  if (!client && clientId) {
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, domain, paperclip_company_prefix')
      .eq('id', clientId)
      .maybeSingle()
    if (error) lookupError = error.message
    client = (data as ClientRow | null) ?? null
  }

  if (!client && companyId) {
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, domain, paperclip_company_prefix')
      .eq('id', companyId)
      .maybeSingle()
    if (error) lookupError = error.message
    client = (data as ClientRow | null) ?? null
  }

  if (!client) {
    return NextResponse.json(
      {
        error: 'client_not_found',
        message: lookupError ?? 'No Yatsar client matches the provided key',
        lookup: { companyPrefix, clientId, companyId },
      },
      { status: 404 },
    )
  }

  if (!client.domain) {
    // Can still render name/label, just no Ahrefs data to pull.
    const payload: MetricsPayload = {
      clientId: client.id,
      clientName: client.name,
      domain: null,
      domainRating: null,
      monthlyOrganic: null,
      trackedKeywords: 0,
      avgPosition: null,
      backlinks: null,
      lastSyncedAt: new Date().toISOString(),
    }
    return NextResponse.json(payload)
  }

  // Pull Ahrefs overview (cached 7 days via the existing ahrefs.ts layer).
  try {
    const overview = (await fetchOverview({
      supabase,
      clientId: client.id,
      target: client.domain,
      forceFresh,
    })) as OverviewShape

    const m = extractMetrics(overview)

    const payload: MetricsPayload = {
      clientId: client.id,
      clientName: client.name,
      domain: client.domain,
      domainRating: m.domainRating,
      monthlyOrganic: m.monthlyOrganic,
      trackedKeywords: m.trackedKeywords,
      // v1: no GSC yet. The widget renders "—" when null, and still shows
      // `trackedKeywords` as the hint underneath.
      avgPosition: null,
      backlinks: m.backlinks,
      lastSyncedAt: new Date().toISOString(),
    }

    return NextResponse.json(payload)
  } catch (err) {
    if (err instanceof AhrefsKeyMissingError) {
      return NextResponse.json(
        { error: 'ahrefs_key_missing' },
        { status: 503 },
      )
    }
    if (err instanceof AhrefsApiError) {
      return NextResponse.json(
        { error: 'ahrefs_error', status: err.status, detail: err.message },
        { status: 502 },
      )
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown_error' },
      { status: 500 },
    )
  }
}
