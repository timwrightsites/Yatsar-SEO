import { createClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 30

interface Props { params: Promise<{ id: string }> }

// ── Data-driven summary (no LLM needed) ─────────────────────────────────────
// Reads recent bot runs + activity logs and produces a short status briefing.
// Content drafts / link prospects / strategy tasks have been removed — those
// artifacts now live in Google Docs Paperclip emails to Tim.

export async function GET(_req: Request, { params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const [{ data: client }, { data: botRuns }, { data: logs }] = await Promise.all([
    db.from('clients').select('name, domain, status, monthly_retainer, gsc_property').eq('id', id).single(),
    db.from('bot_runs')
      .select('bot_type, status, started_at, finished_at')
      .eq('client_id', id)
      .order('started_at', { ascending: false })
      .limit(20),
    db.from('activity_logs')
      .select('event_type, status, created_at, details')
      .eq('client_id', id)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const allBotRuns = (botRuns ?? []) as Array<{ bot_type: string; status: string; started_at: string; finished_at: string | null }>
  const runningNow = allBotRuns.filter(r => r.status === 'running')
  const failedRuns = allBotRuns.filter(r => r.status === 'failed' || r.status === 'escalated')
  const succeeded  = allBotRuns.filter(r => r.status === 'succeeded')

  const lines: string[] = []

  if (runningNow.length > 0) {
    lines.push(`${runningNow.length} bot${runningNow.length > 1 ? 's' : ''} currently running.`)
  }

  if (succeeded.length > 0) {
    const types = [...new Set(succeeded.map(r => r.bot_type).filter(Boolean))]
    const typeList = types.length > 0 ? ` (${types.join(', ')})` : ''
    lines.push(`${succeeded.length} successful run${succeeded.length > 1 ? 's' : ''} in recent history${typeList}.`)
  }

  if (failedRuns.length > 0) {
    const types = [...new Set(failedRuns.map(r => r.bot_type).filter(Boolean))]
    const typeList = types.length > 0 ? ` (${types.join(', ')})` : ''
    lines.push(`${failedRuns.length} run${failedRuns.length > 1 ? 's' : ''} need attention${typeList}.`)
  }

  if (lines.length === 0) {
    lines.push('No recent bot activity yet.')
  }

  let mood: 'good' | 'attention' | 'urgent' = 'good'
  if (failedRuns.length > 0) mood = 'attention'
  if (failedRuns.length > 2) mood = 'urgent'

  const headlines: Record<string, string> = {
    good:      'On track — things are moving smoothly.',
    attention: 'A few items need your attention.',
    urgent:    'Action needed — some runs are escalating.',
  }

  return NextResponse.json({
    headline: headlines[mood],
    mood,
    lines,
    stats: {
      totalTasks: 0,
      overdue: 0,
      inProgress: runningNow.length,
      pendingReview: 0,
      newProspects: 0,
      recentBotRuns: allBotRuns.length,
      failedRuns: failedRuns.length,
    },
    generatedAt: new Date().toISOString(),
  })
}
