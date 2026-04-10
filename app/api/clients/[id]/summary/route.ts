import { createClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 30

interface Props { params: Promise<{ id: string }> }

// ── Data-driven summary (no LLM needed) ─────────────────────────────────────
// Pulls live client data and generates a concise status briefing.
// When the OpenClaw gateway becomes reachable from Vercel, this can be upgraded
// to an LLM call that produces richer prose — the data-fetch layer stays the same.

export async function GET(_req: Request, { params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  // ── 1. Pull everything in parallel ─────────────────────────────
  const [
    { data: client },
    { data: tasks },
    { data: botRuns },
    { data: drafts },
    { data: prospects },
    { data: logs },
  ] = await Promise.all([
    db.from('clients').select('name, domain, status, monthly_retainer, gsc_property').eq('id', id).single(),
    db.from('strategy_tasks')
      .select('id, title, status, type, priority, due_date')
      .eq('client_id', id)
      .not('status', 'eq', 'live')
      .order('due_date', { ascending: true }),
    db.from('bot_runs')
      .select('bot_type, status, started_at, finished_at')
      .eq('client_id', id)
      .order('started_at', { ascending: false })
      .limit(20),
    db.from('content_drafts')
      .select('id, title, status')
      .eq('client_id', id)
      .order('created_at', { ascending: false })
      .limit(10),
    db.from('link_prospects')
      .select('id, domain, status')
      .eq('client_id', id)
      .limit(50),
    db.from('activity_logs')
      .select('event_type, status, created_at, details')
      .eq('client_id', id)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  // ── 2. Compute stats ──────────────────────────────────────────
  const allTasks   = (tasks ?? []) as Array<{ id: string; title: string; status: string; type: string; priority: string; due_date: string | null }>
  const allBotRuns = (botRuns ?? []) as Array<{ bot_type: string; status: string; started_at: string; finished_at: string | null }>
  const allDrafts  = (drafts ?? []) as Array<{ id: string; title: string; status: string }>
  const allLinks   = (prospects ?? []) as Array<{ id: string; domain: string; status: string }>
  const allLogs    = (logs ?? []) as Array<{ event_type: string; status: string; created_at: string; details: string | null }>

  const now = new Date()

  // Tasks
  const tasksByStatus: Record<string, number> = {}
  let overdueCount = 0
  const highPriorityTodo: string[] = []

  for (const t of allTasks) {
    tasksByStatus[t.status] = (tasksByStatus[t.status] ?? 0) + 1
    if (t.due_date && new Date(t.due_date) < now && t.status !== 'live' && t.status !== 'approved') {
      overdueCount++
    }
    if (t.priority === 'high' && t.status === 'todo') {
      highPriorityTodo.push(t.title)
    }
  }

  // Drafts
  const pendingReview = allDrafts.filter(d => d.status === 'pending_review')
  const publishedDrafts = allDrafts.filter(d => d.status === 'published')

  // Links
  const newProspects = allLinks.filter(l => l.status === 'new')
  const outreached   = allLinks.filter(l => l.status === 'outreached' || l.status === 'replied')

  // Bot activity
  const recentBotRuns = allBotRuns.slice(0, 5)
  const failedRuns    = allBotRuns.filter(r => r.status === 'failed')
  const runningNow    = allBotRuns.filter(r => r.status === 'running')

  // ── 3. Build summary lines ────────────────────────────────────
  const lines: string[] = []

  // Lead with the most important thing
  if (pendingReview.length > 0) {
    lines.push(`${pendingReview.length} content draft${pendingReview.length > 1 ? 's' : ''} waiting for your review.`)
  }

  if (overdueCount > 0) {
    lines.push(`${overdueCount} task${overdueCount > 1 ? 's are' : ' is'} overdue and need${overdueCount === 1 ? 's' : ''} attention.`)
  }

  if (highPriorityTodo.length > 0) {
    const show = highPriorityTodo.slice(0, 3)
    lines.push(`${highPriorityTodo.length} high-priority task${highPriorityTodo.length > 1 ? 's' : ''} in the queue${show.length > 0 ? ': ' + show.join(', ') : ''}.`)
  }

  // Task breakdown
  const inProgress    = tasksByStatus['in_progress'] ?? 0
  const needsApproval = tasksByStatus['needs_approval'] ?? 0
  const todoCount     = tasksByStatus['todo'] ?? 0

  if (inProgress > 0 || needsApproval > 0 || todoCount > 0) {
    const parts: string[] = []
    if (inProgress > 0)    parts.push(`${inProgress} in progress`)
    if (needsApproval > 0) parts.push(`${needsApproval} needing approval`)
    if (todoCount > 0)     parts.push(`${todoCount} to do`)
    lines.push(`Tasks: ${parts.join(', ')} (${allTasks.length} total active).`)
  }

  // Content
  if (publishedDrafts.length > 0) {
    lines.push(`${publishedDrafts.length} article${publishedDrafts.length > 1 ? 's' : ''} published recently.`)
  }

  // Links
  if (newProspects.length > 0) {
    lines.push(`${newProspects.length} new link prospect${newProspects.length > 1 ? 's' : ''} ready for outreach.`)
  }
  if (outreached.length > 0) {
    lines.push(`${outreached.length} outreach campaign${outreached.length > 1 ? 's' : ''} active.`)
  }

  // Bot health
  if (runningNow.length > 0) {
    lines.push(`${runningNow.length} bot${runningNow.length > 1 ? 's' : ''} currently running.`)
  }
  if (failedRuns.length > 0) {
    const types = [...new Set(failedRuns.map(r => r.bot_type))]
    lines.push(`${failedRuns.length} recent bot failure${failedRuns.length > 1 ? 's' : ''} (${types.join(', ')}) \u2014 may need investigation.`)
  }

  // If nothing notable, say so
  if (lines.length === 0) {
    lines.push('Everything looks good. No urgent items or pending approvals right now.')
  }

  // ── 4. Build headline ─────────────────────────────────────────
  let mood: 'good' | 'attention' | 'urgent' = 'good'
  if (overdueCount > 0 || failedRuns.length > 0) mood = 'attention'
  if (overdueCount > 3 || failedRuns.length > 2) mood = 'urgent'
  if (pendingReview.length > 0) mood = mood === 'good' ? 'attention' : mood

  const headlines: Record<string, string> = {
    good:      'On track \u2014 things are moving smoothly.',
    attention: 'A few items need your attention.',
    urgent:    'Action needed \u2014 some things are falling behind.',
  }

  return NextResponse.json({
    headline: headlines[mood],
    mood,
    lines,
    stats: {
      totalTasks: allTasks.length,
      overdue: overdueCount,
      inProgress,
      pendingReview: pendingReview.length,
      newProspects: newProspects.length,
      recentBotRuns: recentBotRuns.length,
      failedRuns: failedRuns.length,
    },
    generatedAt: now.toISOString(),
  })
}
