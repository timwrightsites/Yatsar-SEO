/**
 * Projects rollup helper.
 *
 * In Yatsar-SEO, "project" == "client". This module computes the stats
 * that the Paperclip-style Projects grid needs for each client:
 *
 *   • task-status counts from `strategy_tasks`
 *   • pending-review queue depth across content_drafts +
 *     outreach_threads + deliverables
 *   • last-activity micro-feed entry from `activity_logs`
 *
 * All the heavy lifting is done in a handful of batched queries so the
 * Agency View stays snappy regardless of client count. We deliberately
 * avoid per-client N+1 calls.
 *
 * Shared by:
 *   • app/page.tsx      (server component, direct import)
 *   • app/api/projects/ (GET endpoint)
 */

import type { Client, ActivityLog } from '@/types/database'

// ── Output types ───────────────────────────────────────────────────────

export interface ProjectTaskCounts {
  total:          number
  todo:           number
  in_progress:    number
  needs_approval: number
  blocked:        number
  done:           number
  overdue:        number
}

export interface ProjectReviewCounts {
  content_drafts:   number
  outreach_threads: number
  deliverables:     number
  total:            number
}

export interface ProjectLastActivity {
  created_at: string
  title:      string
  detail:     string | null
  bot:        string | null
  status:     ActivityLog['status']
}

export interface ProjectRollup {
  id:                string
  name:              string
  domain:            string | null
  status:            string
  industry:          string | null
  monthly_retainer:  number | null
  tasks:             ProjectTaskCounts
  review:            ProjectReviewCounts
  last_activity:     ProjectLastActivity | null
}

// ── Helpers ────────────────────────────────────────────────────────────

const EMPTY_TASKS: ProjectTaskCounts = {
  total: 0, todo: 0, in_progress: 0, needs_approval: 0,
  blocked: 0, done: 0, overdue: 0,
}

const EMPTY_REVIEW: ProjectReviewCounts = {
  content_drafts: 0, outreach_threads: 0, deliverables: 0, total: 0,
}

function bucketForTaskStatus(s: string): keyof ProjectTaskCounts | null {
  switch (s) {
    case 'todo':           return 'todo'
    case 'in_progress':    return 'in_progress'
    case 'needs_approval': return 'needs_approval'
    case 'blocked':        return 'blocked'
    case 'done':           return 'done'
    default:               return null
  }
}

// ── Main rollup ────────────────────────────────────────────────────────

/**
 * Given a Supabase client (server or service-role), return a
 * ProjectRollup for every client row passed in.
 *
 * The caller decides whether to filter by status before passing the
 * list in (e.g. only `active` on the home page); we just roll up
 * whatever we get.
 */
export async function buildProjectsRollup(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  clients: Pick<Client, 'id' | 'name' | 'domain' | 'status' | 'industry' | 'monthly_retainer'>[],
): Promise<ProjectRollup[]> {
  const clientIds = clients.map(c => c.id)
  if (clientIds.length === 0) return []

  const nowIso = new Date().toISOString()

  const [
    { data: tasks },
    { data: drafts },
    { data: threads },
    { data: dels },
    { data: logs },
  ] = await Promise.all([
    supabase
      .from('strategy_tasks')
      .select('client_id, status, scheduled_for')
      .in('client_id', clientIds),
    supabase
      .from('content_drafts')
      .select('client_id')
      .in('client_id', clientIds)
      .eq('status', 'pending_review'),
    supabase
      .from('outreach_threads')
      .select('client_id')
      .in('client_id', clientIds)
      .eq('status', 'pending_review'),
    supabase
      .from('deliverables')
      .select('client_id')
      .in('client_id', clientIds)
      .eq('status', 'pending_review'),
    supabase
      .from('activity_logs')
      .select('id, client_id, created_at, title, detail, bot_type, status')
      .in('client_id', clientIds)
      .order('created_at', { ascending: false })
      .limit(Math.max(clientIds.length * 5, 50)),
  ])

  // Bucket tasks per client.
  const taskBuckets = new Map<string, ProjectTaskCounts>()
  for (const t of (tasks ?? []) as { client_id: string; status: string; scheduled_for: string | null }[]) {
    const b = taskBuckets.get(t.client_id) ?? { ...EMPTY_TASKS }
    const k = bucketForTaskStatus(t.status)
    if (k) b[k] += 1
    b.total += 1
    const open = t.status !== 'done'
    if (open && t.scheduled_for && t.scheduled_for < nowIso) b.overdue += 1
    taskBuckets.set(t.client_id, b)
  }

  // Bucket review-queue counts.
  const reviewBuckets = new Map<string, ProjectReviewCounts>()
  function bumpReview(clientId: string, field: keyof ProjectReviewCounts) {
    const b = reviewBuckets.get(clientId) ?? { ...EMPTY_REVIEW }
    if (field !== 'total') b[field] += 1
    b.total += 1
    reviewBuckets.set(clientId, b)
  }
  for (const r of (drafts  ?? []) as { client_id: string }[]) bumpReview(r.client_id, 'content_drafts')
  for (const r of (threads ?? []) as { client_id: string }[]) bumpReview(r.client_id, 'outreach_threads')
  for (const r of (dels    ?? []) as { client_id: string }[]) bumpReview(r.client_id, 'deliverables')

  // Pick the most-recent activity per client. `logs` is already desc
  // by created_at — first hit per client_id wins.
  const latest = new Map<string, ProjectLastActivity>()
  for (const l of (logs ?? []) as {
    id: string
    client_id: string | null
    created_at: string | null
    title: string | null
    detail: string | null
    bot_type: string | null
    status: ActivityLog['status']
  }[]) {
    if (!l.client_id || !l.created_at) continue
    if (latest.has(l.client_id)) continue
    latest.set(l.client_id, {
      created_at: l.created_at,
      title:      l.title ?? '',
      detail:     l.detail,
      bot:        l.bot_type,
      status:     l.status,
    })
  }

  return clients.map(c => ({
    id:               c.id,
    name:             c.name,
    domain:           c.domain ?? null,
    status:           c.status ?? 'active',
    industry:         c.industry ?? null,
    monthly_retainer: c.monthly_retainer ?? null,
    tasks:            taskBuckets.get(c.id)   ?? { ...EMPTY_TASKS  },
    review:           reviewBuckets.get(c.id) ?? { ...EMPTY_REVIEW },
    last_activity:    latest.get(c.id)        ?? null,
  }))
}
