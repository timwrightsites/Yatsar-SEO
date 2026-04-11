/**
 * GET /api/agents/status?since=ISO8601
 *
 * Returns bot_runs that finished after the given timestamp.
 * Used by the AgentStatusPoller to fire toast notifications.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url   = new URL(req.url)
  const since = url.searchParams.get('since')

  if (!since) {
    return NextResponse.json({ error: 'since parameter required' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Fetch recently finished runs (succeeded, failed, escalated)
  const { data, error } = await supabase
    .from('bot_runs')
    .select('id, bot_type, status, client_id, finished_at, error_message')
    .in('status', ['succeeded', 'failed', 'escalated'])
    .gte('finished_at', since)
    .order('finished_at', { ascending: false })
    .limit(20)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Enrich with client names
  if (data && data.length > 0) {
    const clientIds = [...new Set(data.map(r => r.client_id))]
    const { data: clients } = await supabase
      .from('clients')
      .select('id, name')
      .in('id', clientIds)

    const nameMap = new Map((clients ?? []).map(c => [c.id, c.name]))

    const enriched = data.map(run => ({
      ...run,
      client_name: nameMap.get(run.client_id) ?? null,
    }))

    return NextResponse.json(enriched)
  }

  return NextResponse.json(data ?? [])
}
