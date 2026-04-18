/**
 * GET /api/clients/[id]/issues
 *
 * Returns every Paperclip-orchestration issue for a client, enriched with
 * per-issue activity counts (agent runs, deliverables, content drafts,
 * outreach threads, approvals). Drives the Issues tab on the client page.
 *
 * Sort order: open/in_progress/blocked first (by most-recent activity),
 * then resolved/archived.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type IssueStatus = 'open' | 'in_progress' | 'blocked' | 'resolved' | 'archived'
type IssuePriority = 'low' | 'normal' | 'high' | 'urgent'

export interface IssueListItem {
  id: string
  title: string
  description: string | null
  status: IssueStatus
  priority: IssuePriority
  assignee_agent: string | null
  external_url: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
  last_activity_at: string
  counts: {
    agent_runs: number
    deliverables: number
    content_drafts: number
    outreach_threads: number
    approvals: number
    pending_review: number
    total: number
  }
}

interface Props {
  params: Promise<{ id: string }>
}

const STATUS_RANK: Record<IssueStatus, number> = {
  open: 0,
  in_progress: 1,
  blocked: 2,
  resolved: 3,
  archived: 4,
}

export async function GET(_req: Request, { params }: Props) {
  const { id: clientId } = await params

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: issues, error: issuesErr } = await supabase
    .from('issues')
    .select('id, title, description, status, priority, assignee_agent, external_url, created_at, updated_at, resolved_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(500)

  if (issuesErr) {
    return NextResponse.json({ error: issuesErr.message }, { status: 500 })
  }

  const issueIds = (issues ?? []).map(i => i.id)
  if (issueIds.length === 0) {
    return NextResponse.json({
      issues: [] as IssueListItem[],
      counts: { total: 0, open: 0, in_progress: 0, blocked: 0, resolved: 0, archived: 0 },
    })
  }

  // Parallel count queries, each returning id + issue_id so we can bucket in-memory.
  const [runsRes, delivsRes, draftsRes, threadsRes, approvalsRes] = await Promise.all([
    supabase
      .from('agent_runs')
      .select('id, issue_id, started_at, finished_at')
      .in('issue_id', issueIds)
      .limit(5000),
    supabase
      .from('deliverables')
      .select('id, issue_id, status, updated_at')
      .in('issue_id', issueIds)
      .limit(5000),
    supabase
      .from('content_drafts')
      .select('id, issue_id, status, updated_at')
      .in('issue_id', issueIds)
      .limit(5000),
    supabase
      .from('outreach_threads')
      .select('id, issue_id, status, last_activity_at, created_at')
      .in('issue_id', issueIds)
      .limit(5000),
    supabase
      .from('approvals')
      .select('id, target_type, target_id, created_at')
      .limit(10000),
  ])

  type RunRow    = { id: string; issue_id: string | null; started_at: string | null; finished_at: string | null }
  type DelivRow  = { id: string; issue_id: string | null; status: string; updated_at: string }
  type DraftRow  = { id: string; issue_id: string | null; status: string; updated_at: string | null }
  type ThreadRow = { id: string; issue_id: string | null; status: string; last_activity_at: string | null; created_at: string | null }
  type ApprovalRow = { id: string; target_type: string; target_id: string; created_at: string }

  const runs    = (runsRes.data ?? []) as RunRow[]
  const delivs  = (delivsRes.data ?? []) as DelivRow[]
  const drafts  = (draftsRes.data ?? []) as DraftRow[]
  const threads = (threadsRes.data ?? []) as ThreadRow[]
  const allApprovals = (approvalsRes.data ?? []) as ApprovalRow[]

  // Approvals don't FK to issue_id directly; index by target (deliverable/draft/thread) → issue_id
  const targetToIssue = new Map<string, string>()
  for (const d of delivs)  if (d.issue_id) targetToIssue.set(`deliverable:${d.id}`, d.issue_id)
  for (const d of drafts)  if (d.issue_id) targetToIssue.set(`content_draft:${d.id}`, d.issue_id)
  for (const t of threads) if (t.issue_id) targetToIssue.set(`outreach_thread:${t.id}`, t.issue_id)

  const approvalsByIssue = new Map<string, number>()
  for (const a of allApprovals) {
    const key = `${a.target_type}:${a.target_id}`
    const issueId = targetToIssue.get(key)
    if (!issueId) continue
    approvalsByIssue.set(issueId, (approvalsByIssue.get(issueId) ?? 0) + 1)
  }

  function bucketByIssue<T extends { issue_id: string | null }>(rows: T[]) {
    const map = new Map<string, T[]>()
    for (const r of rows) {
      if (!r.issue_id) continue
      const arr = map.get(r.issue_id) ?? []
      arr.push(r)
      map.set(r.issue_id, arr)
    }
    return map
  }

  const runsByIssue    = bucketByIssue(runs)
  const delivsByIssue  = bucketByIssue(delivs)
  const draftsByIssue  = bucketByIssue(drafts)
  const threadsByIssue = bucketByIssue(threads)

  const statusCounts = { open: 0, in_progress: 0, blocked: 0, resolved: 0, archived: 0 }
  const pendingStatuses = new Set(['pending_review'])

  const enriched: IssueListItem[] = (issues ?? []).map(issue => {
    const r = runsByIssue.get(issue.id)    ?? []
    const d = delivsByIssue.get(issue.id)  ?? []
    const c = draftsByIssue.get(issue.id)  ?? []
    const t = threadsByIssue.get(issue.id) ?? []

    const pending =
      d.filter(x => pendingStatuses.has(x.status)).length +
      c.filter(x => pendingStatuses.has(x.status)).length +
      t.filter(x => pendingStatuses.has(x.status)).length

    const activityCandidates = [
      issue.updated_at,
      ...r.map(x => x.finished_at ?? x.started_at ?? null),
      ...d.map(x => x.updated_at),
      ...c.map(x => x.updated_at ?? null),
      ...t.map(x => x.last_activity_at ?? x.created_at ?? null),
    ].filter((v): v is string => Boolean(v))

    const last_activity_at = activityCandidates.sort().slice(-1)[0] ?? issue.updated_at

    const status = issue.status as IssueStatus
    statusCounts[status] = (statusCounts[status] ?? 0) + 1

    return {
      id: issue.id,
      title: issue.title,
      description: issue.description,
      status,
      priority: issue.priority as IssuePriority,
      assignee_agent: issue.assignee_agent,
      external_url: issue.external_url,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      resolved_at: issue.resolved_at,
      last_activity_at,
      counts: {
        agent_runs      : r.length,
        deliverables    : d.length,
        content_drafts  : c.length,
        outreach_threads: t.length,
        approvals       : approvalsByIssue.get(issue.id) ?? 0,
        pending_review  : pending,
        total           : r.length + d.length + c.length + t.length,
      },
    }
  })

  enriched.sort((a, b) => {
    const rankDelta = STATUS_RANK[a.status] - STATUS_RANK[b.status]
    if (rankDelta !== 0) return rankDelta
    return b.last_activity_at.localeCompare(a.last_activity_at)
  })

  return NextResponse.json({
    issues: enriched,
    counts: {
      total       : enriched.length,
      open        : statusCounts.open,
      in_progress : statusCounts.in_progress,
      blocked     : statusCounts.blocked,
      resolved    : statusCounts.resolved,
      archived    : statusCounts.archived,
    },
  })
}
