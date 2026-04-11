/**
 * GET /api/agents/notifications
 *
 * Returns the 15 most recent bot_runs (any status) for the notification
 * bell dropdown. Includes running agents so the user can see what's active.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Get recent runs — running first, then by most recent
  const { data: runs, error } = await supabase
    .from('bot_runs')
    .select('id, bot_type, status, client_id, started_at, finished_at, error_message, duration_ms')
    .in('status', ['running', 'succeeded', 'failed', 'escalated'])
    .order('started_at', { ascending: false })
    .limit(15)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!runs || runs.length === 0) {
    return NextResponse.json([])
  }

  // Enrich with client names
  const clientIds = [...new Set(runs.map(r => r.client_id))]
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name')
    .in('id', clientIds)

  const nameMap = new Map((clients ?? []).map(c => [c.id, c.name]))

  // Sort: running first, then by finished_at/started_at descending
  const enriched = runs
    .map(run => ({
      ...run,
      client_name: nameMap.get(run.client_id) ?? null,
    }))
    .sort((a, b) => {
      if (a.status === 'running' && b.status !== 'running') return -1
      if (b.status === 'running' && a.status !== 'running') return 1
      const aTime = a.finished_at ?? a.started_at ?? ''
      const bTime = b.finished_at ?? b.started_at ?? ''
      return bTime.localeCompare(aTime)
    })

  return NextResponse.json(enriched)
}
