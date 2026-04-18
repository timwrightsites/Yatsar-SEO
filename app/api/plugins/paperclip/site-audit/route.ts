/**
 * GET /api/plugins/paperclip/site-audit
 *
 * Agent-callable tool endpoint. Consumed by the `yatsar.seo:getSiteAudit`
 * tool registered by the Paperclip `yatsar.seo` plugin.
 *
 * Accepts ONE of: ?domain=, ?companyPrefix=, ?clientId=, ?companyId=
 * Optional: ?fresh=1
 *
 * Auth: shared bearer token in `PAPERCLIP_PLUGIN_TOKEN`.
 *
 * Returns the audit issues for the Ahrefs Site Audit project whose URL
 * matches the client's domain. If no project is set up for the domain,
 * returns { project: null, issues: [] } with a friendly note so the
 * agent can surface "site audit isn't configured" instead of erroring.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { resolveClient } from '@/lib/client-lookup'
import {
  fetchSiteAuditIssues,
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

export async function GET(req: NextRequest) {
  const authFail = checkAuth(req)
  if (authFail) return authFail

  const sp = req.nextUrl.searchParams
  const domain = sp.get('domain')?.trim() || null
  const companyPrefix = sp.get('companyPrefix')?.trim() || null
  const clientId = sp.get('clientId')?.trim() || null
  const companyId = sp.get('companyId')?.trim() || null
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
    const report = await fetchSiteAuditIssues({
      supabase,
      clientId: client.id,
      target: client.domain,
      forceFresh,
    })

    if (!report.project) {
      return NextResponse.json({
        client: { id: client.id, name: client.name, domain: client.domain },
        project: null,
        issues: [],
        issues_total: 0,
        note: 'No Ahrefs Site Audit project matches this domain. Create one in Ahrefs to enable audit findings.',
        fetched_at: report.fetched_at,
      })
    }

    // Quick severity bucket counts so the agent has something to narrate
    // without scanning every issue row.
    const severityCounts: Record<string, number> = {}
    for (const row of report.issues) {
      const k = row.severity || 'unspecified'
      severityCounts[k] = (severityCounts[k] ?? 0) + 1
    }

    return NextResponse.json({
      client: { id: client.id, name: client.name, domain: client.domain },
      project: report.project,
      issues: report.issues,
      issues_total: report.issues.length,
      severity_counts: severityCounts,
      fetched_at: report.fetched_at,
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
