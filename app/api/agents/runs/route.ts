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

    // Extract a conversational summary from output JSON
    const summary = buildConversationalSummary(run.output, run.bot_type, run.error_message)

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

// ── Conversational summary builder ──────────────────────────────────────────

function buildConversationalSummary(
  output: unknown,
  botType: string,
  errorMessage: string | null,
): string {
  if (errorMessage) return ''  // errors shown separately

  if (!output || typeof output !== 'object') return ''

  const o = output as Record<string, unknown>

  // First, check for an explicit string summary field
  for (const key of ['summary', 'report_summary', 'notes', 'message']) {
    if (typeof o[key] === 'string' && (o[key] as string).length > 0) {
      return (o[key] as string).slice(0, 200)
    }
  }

  // Build a natural-language summary based on bot type + output shape
  switch (botType) {
    case 'keyword': {
      const parts: string[] = []
      if (typeof o.gap_count === 'number') parts.push(`Found ${o.gap_count} keyword gap${o.gap_count === 1 ? '' : 's'}`)
      if (typeof o.quick_win_count === 'number') parts.push(`${o.quick_win_count} quick win${o.quick_win_count === 1 ? '' : 's'}`)
      if (typeof o.high_priority_count === 'number') parts.push(`${o.high_priority_count} high priority`)
      if (typeof o.total_opportunity_vol === 'number') parts.push(`~${o.total_opportunity_vol.toLocaleString()} vol opportunity`)
      if (typeof o.avg_difficulty === 'number') parts.push(`avg difficulty ${o.avg_difficulty}`)
      if (typeof o.recommendation === 'string') return o.recommendation.slice(0, 200)
      return parts.length > 0 ? parts.join(' · ') : 'Keyword analysis complete'
    }
    case 'content': {
      const parts: string[] = []
      if (typeof o.drafts_created === 'number') parts.push(`Created ${o.drafts_created} draft${o.drafts_created === 1 ? '' : 's'}`)
      if (typeof o.words_written === 'number') parts.push(`${o.words_written.toLocaleString()} words`)
      if (typeof o.topics_covered === 'number') parts.push(`${o.topics_covered} topics`)
      return parts.length > 0 ? parts.join(' · ') : 'Content generation complete'
    }
    case 'link': {
      const parts: string[] = []
      if (typeof o.prospects_found === 'number') parts.push(`Found ${o.prospects_found} prospect${o.prospects_found === 1 ? '' : 's'}`)
      if (typeof o.outreach_sent === 'number') parts.push(`${o.outreach_sent} outreach drafted`)
      if (typeof o.avg_domain_rating === 'number') parts.push(`avg DR ${o.avg_domain_rating}`)
      return parts.length > 0 ? parts.join(' · ') : 'Link prospecting complete'
    }
    case 'technical':
    case 'audit': {
      const parts: string[] = []
      if (typeof o.issues_found === 'number') parts.push(`Found ${o.issues_found} issue${o.issues_found === 1 ? '' : 's'}`)
      if (typeof o.critical_count === 'number') parts.push(`${o.critical_count} critical`)
      if (typeof o.pages_crawled === 'number') parts.push(`${o.pages_crawled} pages crawled`)
      return parts.length > 0 ? parts.join(' · ') : 'Technical audit complete'
    }
    case 'analytics': {
      const parts: string[] = []
      if (typeof o.insights_count === 'number') parts.push(`${o.insights_count} insight${o.insights_count === 1 ? '' : 's'}`)
      if (typeof o.traffic_change === 'string') parts.push(o.traffic_change)
      return parts.length > 0 ? parts.join(' · ') : 'Analytics review complete'
    }
    case 'geo': {
      const parts: string[] = []
      if (typeof o.locations_analyzed === 'number') parts.push(`${o.locations_analyzed} location${o.locations_analyzed === 1 ? '' : 's'} analyzed`)
      if (typeof o.citations_found === 'number') parts.push(`${o.citations_found} citations`)
      return parts.length > 0 ? parts.join(' · ') : 'GEO analysis complete'
    }
    default: {
      // Generic fallback — still conversational
      const keys = Object.keys(o)
      if (keys.length === 0) return ''
      // Try to pull any numeric highlights
      const highlights: string[] = []
      for (const k of keys.slice(0, 4)) {
        const v = o[k]
        if (typeof v === 'number') highlights.push(`${k.replace(/_/g, ' ')}: ${v}`)
        else if (typeof v === 'string' && v.length < 60) highlights.push(v)
      }
      return highlights.length > 0 ? highlights.join(' · ') : `${botType} agent finished`
    }
  }
}
