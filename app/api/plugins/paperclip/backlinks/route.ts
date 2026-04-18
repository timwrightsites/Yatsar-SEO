/**
 * GET /api/plugins/paperclip/backlinks
 *
 * Agent-callable tool endpoint. Consumed by the `yatsar.seo:getBacklinks`
 * tool registered by the Paperclip `yatsar.seo` plugin.
 *
 * Accepts ONE of: ?domain=, ?companyPrefix=, ?clientId=, ?companyId=
 * Optional: ?limit=20 (1–25), ?fresh=1
 *
 * Auth: shared bearer token in `PAPERCLIP_PLUGIN_TOKEN`.
 *
 * Returns the most recently-seen backlinks pointing at the client's
 * domain, sorted by first_seen descending.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { resolveClient } from '@/lib/client-lookup'
import {
  fetchAllBacklinks,
  AhrefsApiError,
  AhrefsKeyMissingError,
} from '@/lib/ahrefs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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

interface BacklinkRow {
  url_from: string
  url_to: string
  source_domain_rating: number
  source_traffic: number
  anchor: string
  dofollow: boolean
  link_type: string
  first_seen: string | null
  last_seen: string | null
}

function asString(v: unknown): string { return typeof v === 'string' ? v : '' }
function asNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function coerceRows(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== 'object') return []
  const env = payload as { backlinks?: unknown; data?: unknown }
  if (Array.isArray(env.backlinks)) return env.backlinks as Array<Record<string, unknown>>
  if (Array.isArray(env.data))      return env.data as Array<Record<string, unknown>>
  return []
}

function normalizeBacklink(r: Record<string, unknown>): BacklinkRow {
  return {
    url_from:             asString(r.url_from),
    url_to:               asString(r.url_to),
    source_domain_rating: asNumber(r.domain_rating_source ?? r.domain_rating),
    source_traffic:       asNumber(r.traffic_domain ?? r.traffic),
    anchor:               asString(r.anchor),
    dofollow:             Boolean(r.is_dofollow),
    link_type:            asString(r.link_type),
    first_seen:           asString(r.first_seen) || null,
    last_seen:            asString(r.last_seen) || null,
  }
}

export async function GET(req: NextRequest) {
  const authFail = checkAuth(req)
  if (authFail) return authFail

  const sp = req.nextUrl.searchParams
  const domain = sp.get('domain')?.trim() || null
  const companyPrefix = sp.get('companyPrefix')?.trim() || null
  const clientId = sp.get('clientId')?.trim() || null
  const companyId = sp.get('companyId')?.trim() || null

  const limitRaw = Number(sp.get('limit'))
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 25) : 20
  const forceFresh = sp.get('fresh') === '1'

  if (!domain && !companyPrefix && !clientId && !companyId) {
    return NextResponse.json(
      { error: 'domain, companyPrefix, or clientId is required' },
      { status: 400 },
    )
  }

  const supabase = createServiceClient()

  const { client, lookupError } = await resolveClient(supabase, {
    domain, companyPrefix, clientId, companyId,
  })

  if (!client) {
    return NextResponse.json(
      {
        error: 'client_not_found',
        message: lookupError ?? 'No Yatsar client matches the provided key',
        lookup: { domain, companyPrefix, clientId, companyId },
      },
      { status: 404 },
    )
  }

  if (!client.domain) {
    return NextResponse.json(
      { error: 'client_has_no_domain', clientId: client.id, clientName: client.name },
      { status: 422 },
    )
  }

  try {
    const raw = (await fetchAllBacklinks({
      supabase,
      clientId: client.id,
      target: client.domain,
      limit,
      forceFresh,
    })) as unknown

    const backlinks = coerceRows(raw).map(normalizeBacklink)

    return NextResponse.json({
      client: { id: client.id, name: client.name, domain: client.domain },
      limit,
      backlinks,
      fetched_at: new Date().toISOString(),
    })
  } catch (err) {
    if (err instanceof AhrefsKeyMissingError) {
      return NextResponse.json({ error: 'ahrefs_key_missing' }, { status: 503 })
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
