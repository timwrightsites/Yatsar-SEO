/**
 * GET /api/agents/runs?clientId=xxx
 *
 * Returns bot_runs for a specific client (or all clients if no clientId).
 * Used by the Bot Runs panel to show a Monday-style task table.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url      = new URL(req.url)
  const clientId = url.searchParams.get('clientId')
  const limit    = Math.min(Number(url.searchParams.get('limit') || '50'), 100)

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  let query = supabase
    .from('bot_runs')
    .select('id, bot_type, status, client_id, task_id, started_at, finished_at, duration_ms, error_message, output, trigger_source, input')
    .order('started_at', { ascending: false })
    .limit(limit)

  if (clientId) {
    query = query.eq('client_id', clientId)
  }

  const { data: runs, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!runs || runs.length === 0) {
    return NextResponse.json([])
  }

  // Enrich with client names and task titles
  const clientIds = [...new Set(runs.map(r => r.client_id))]
  const taskIds = [...new Set(runs.filter(r => r.task_id).map(r => r.task_id!))]

  const [clientsRes, tasksRes] = await Promise.all([
    supabase.from('clients').select('id, name, domain').in('id', clientIds),
    taskIds.length > 0
      ? supabase.from('strategy_tasks').select('id, title, type').in('id', taskIds)
      : Promise.resolve({ data: [] }),
  ])

  const clientMap = new Map((clientsRes.data ?? []).map(c => [c.id, c]))
  const taskMap = new Map(((tasksRes as any).data ?? []).map((t: { id: string; title: string; type: string }) => [t.id, t]))

  const enriched = runs.map(run => {
    const client = clientMap.get(run.client_id)
    const task = run.task_id ? taskMap.get(run.task_id) : null

    // Extract summary from output JSON if available
    let summary = ''
    if (run.output && typeof run.output === 'object') {
      const o = run.output as Record<string, unknown>
      // Only use values that are actually strings (the `as string` cast doesn't convert at runtime)
      const candidates = [o.summary, o.report_summary, o.notes, o.message]
      summary = (candidates.find(v => typeof v === 'string' && v.length > 0) as string) ?? ''
      // If no direct summary field, try to build one from the output keys
      if (!summary && Object.keys(o).length > 0) {
        const keys = Object.keys(o).slice(0, 3).join(', ')
        summary = `Output: ${keys}…`
      }
    }

    return {
      id: run.id,
      bot_type: run.bot_type,
      status: run.status,
      client_id: run.client_id,
      client_name: client?.name ?? null,
      client_domain: client?.domain ?? null,
      task_id: run.task_id,
      task_title: (task as any)?.title ?? (run.input as any)?.task_title ?? null,
      task_type: (task as any)?.type ?? null,
      started_at: run.started_at,
      finished_at: run.finished_at,
      duration_ms: run.duration_ms,
      error_message: run.error_message,
      summary,
      trigger_source: run.trigger_source,
      has_output: run.output !== null,
    }
  })

  return NextResponse.json(enriched)
}
