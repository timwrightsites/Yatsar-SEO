/**
 * GET /api/plugins/paperclip/keywords
 *
 * Agent-callable tool endpoint. Consumed by the `yatsar.seo:getKeywords`
 * tool registered by the Paperclip `yatsar.seo` plugin.
 *
 * Accepts ONE of:
 *   ?domain=trustalrecruiting.com   (preferred — LLM-friendly)
 *   ?companyPrefix=TRU              (dashboard/widget path)
 *   ?clientId=<uuid>                (explicit Yatsar UUID)
 *
 * Optional:
 *   ?limit=20        1–25 (Ahrefs Standard-plan row cap)
 *   ?country=us      two-letter country code (default 'us')
 *   ?fresh=1         bypass the weekly Ahrefs cache
 *
 * Auth: shared bearer token in `PAPERCLIP_PLUGIN_TOKEN`.
 *
 * Shape returned on success:
 *   {
 *     client: { id, name, domain },
 *     keywords: [
 *       { keyword, volume, difficulty, traffic, position, url, ... }, ...
 *     ],
 *     fetched_at
 *   }
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { resolveClient } from '@/lib/client-lookup'
import {
  fetchOrganicKeywords,
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

// ── Shape normalization ──────────────────────────────────────────────

interface KeywordRow {
  keyword: string
  volume: number
  difficulty: number
  traffic: number
  position: number | null
  position_prev: number | null
  position_diff: number | null
  url: string | null
  cpc: number
  intent: {
    branded: boolean
    local: boolean
    navigational: boolean
    informational: boolean
    commercial: boolean
    transactional: boolean
  }
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

function asNumberOrNull(v: unknown): number | null {
  const n = asNumber(v)
  return Number.isFinite(n) && n !== 0 ? n : (n === 0 && v === 0 ? 0 : null)
}

function coerceRows(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== 'object') return []
  const env = payload as { keywords?: unknown; data?: unknown }
  if (Array.isArray(env.keywords)) return env.keywords as Array<Record<string, unknown>>
  if (Array.isArray(env.data))     return env.data as Array<Record<string, unknown>>
  return []
}

function normalizeKeyword(r: Record<string, unknown>): KeywordRow {
  return {
    keyword:       asString(r.keyword_merged ?? r.keyword),
    volume:        asNumber(r.volume_merged ?? r.volume),
    difficulty:    asNumber(r.keyword_difficulty_merged ?? r.keyword_difficulty),
    traffic:       asNumber(r.sum_traffic ?? r.sum_traffic_merged),
    position:      asNumberOrNull(r.best_position),
    position_prev: asNumberOrNull(r.best_position_prev),
    position_diff: asNumberOrNull(r.best_position_diff),
    url:           asString(r.best_position_url) || null,
    cpc:           asNumber(r.cpc_merged ?? r.cpc),
    intent: {
      branded:       Boolean(r.is_branded),
      local:         Boolean(r.is_local),
      navigational:  Boolean(r.is_navigational),
      informational: Boolean(r.is_informational),
      commercial:    Boolean(r.is_commercial),
      transactional: Boolean(r.is_transactional),
    },
  }
}

// ── Handler ──────────────────────────────────────────────────────────

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
  const country = sp.get('country')?.trim().toLowerCase() || 'us'
  const forceFresh = sp.get('fresh') === '1'

  if (!domain && !companyPrefix && !clientId && !companyId) {
    return NextResponse.json(
      { error: 'domain, companyPrefix, or clientId is required' },
      { status: 400 },
    )
  }

  const supabase = createServiceClient()

  const { client, lookupError } = await resolveClient(supabase, {
    domain,
    companyPrefix,
    clientId,
    companyId,
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
    const raw = (await fetchOrganicKeywords({
      supabase,
      clientId: client.id,
      target: client.domain,
      limit,
      country,
      forceFresh,
    })) as unknown

    const keywords = coerceRows(raw).map(normalizeKeyword)

    return NextResponse.json({
      client: { id: client.id, name: client.name, domain: client.domain },
      country,
      limit,
      keywords,
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
