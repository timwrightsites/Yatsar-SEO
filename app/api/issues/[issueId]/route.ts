/**
 * GET /api/issues/[issueId]
 *
 * Returns a single issue plus its full chronological thread — every
 * agent run, deliverable, content draft, outreach email, and approval
 * action that references the issue. Used by the Issues tab's
 * expand-in-place thread view.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export type ThreadEventKind =
  | 'agent_run'
  | 'deliverable'
  | 'content_draft'
  | 'outreach_thread'
  | 'approval'

export interface ThreadEvent {
  kind: ThreadEventKind
  id: string
  timestamp: string
  title: string
  status: string | null
  actor: string | null
  preview: string | null
  meta: Record<string, unknown>
}

interface Props {
  params: Promise<{ issueId: string }>
}

export async function GET(_req: Request, { params }: Props) {
  const { issueId } = await params

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: issue, error: issueErr } = await supabase
    .from('issues')
    .select('id, client_id, title, description, status, priority, assignee_agent, external_url, created_at, updated_at, resolved_at')
    .eq('id', issueId)
    .maybeSingle()

  if (issueErr)  return NextResponse.json({ error: issueErr.message }, { status: 500 })
  if (!issue)    return NextResponse.json({ error: 'Issue not found' }, { status: 404 })

  const [runsRes, delivsRes, draftsRes, threadsRes] = await Promise.all([
    supabase
      .from('agent_runs')
      .select('id, agent, status, started_at, finished_at, input, output_summary, cost_cents')
      .eq('issue_id', issueId)
      .order('started_at', { ascending: false })
      .limit(200),
    supabase
      .from('deliverables')
      .select('id, type, title, status, author_agent, content_md, external_url, reviewer_notes, submitted_for_review_at, approved_at, rejected_at, sent_at, created_at, updated_at')
      .eq('issue_id', issueId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('content_drafts')
      .select('id, title, target_url, target_keyword, status, author_agent, body_html, reviewer_notes, submitted_for_review_at, approved_at, rejected_at, published_at, created_at, updated_at')
      .eq('issue_id', issueId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('outreach_threads')
      .select('id, subject, to_email, from_email, status, body_md, last_message, reviewer_notes, submitted_for_review_at, approved_at, rejected_at, sent_at, last_activity_at, created_at')
      .eq('issue_id', issueId)
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  type RunRow    = { id: string; agent: string; status: string; started_at: string | null; finished_at: string | null; input: string | null; output_summary: string | null; cost_cents: number | null }
  type DelivRow  = { id: string; type: string; title: string; status: string; author_agent: string | null; content_md: string | null; external_url: string | null; reviewer_notes: string | null; submitted_for_review_at: string | null; approved_at: string | null; rejected_at: string | null; sent_at: string | null; created_at: string; updated_at: string }
  type DraftRow  = { id: string; title: string; target_url: string | null; target_keyword: string | null; status: string; author_agent: string | null; body_html: string | null; reviewer_notes: string | null; submitted_for_review_at: string | null; approved_at: string | null; rejected_at: string | null; published_at: string | null; created_at: string | null; updated_at: string | null }
  type ThreadRow = { id: string; subject: string | null; to_email: string | null; from_email: string | null; status: string; body_md: string | null; last_message: string | null; reviewer_notes: string | null; submitted_for_review_at: string | null; approved_at: string | null; rejected_at: string | null; sent_at: string | null; last_activity_at: string | null; created_at: string | null }

  const runs    = (runsRes.data    ?? []) as RunRow[]
  const delivs  = (delivsRes.data  ?? []) as DelivRow[]
  const drafts  = (draftsRes.data  ?? []) as DraftRow[]
  const threads = (threadsRes.data ?? []) as ThreadRow[]

  // Pull approvals that target any of the items above so we can show
  // the full approval chain in the thread.
  const deliverableIds = delivs.map(d => d.id)
  const draftIds       = drafts.map(d => d.id)
  const threadIds      = threads.map(t => t.id)

  const approvalFilters: string[] = []
  if (deliverableIds.length) approvalFilters.push(`and(target_type.eq.deliverable,target_id.in.(${deliverableIds.join(',')}))`)
  if (draftIds.length)       approvalFilters.push(`and(target_type.eq.content_draft,target_id.in.(${draftIds.join(',')}))`)
  if (threadIds.length)      approvalFilters.push(`and(target_type.eq.outreach_thread,target_id.in.(${threadIds.join(',')}))`)

  type ApprovalRow = { id: string; target_type: string; target_id: string; action: string; actor_type: string; actor_id: string | null; notes: string | null; created_at: string }
  let approvals: ApprovalRow[] = []
  if (approvalFilters.length > 0) {
    const { data } = await supabase
      .from('approvals')
      .select('id, target_type, target_id, action, actor_type, actor_id, notes, created_at')
      .or(approvalFilters.join(','))
      .order('created_at', { ascending: false })
      .limit(500)
    approvals = (data ?? []) as ApprovalRow[]
  }

  function stripHtml(html: string | null): string {
    if (!html) return ''
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }
  function truncate(s: string, n: number): string {
    if (s.length <= n) return s
    return s.slice(0, n).trimEnd() + '…'
  }

  const delivTitleById = new Map(delivs.map(d => [d.id, d.title]))
  const draftTitleById = new Map(drafts.map(d => [d.id, d.title]))
  const threadTitleById = new Map(threads.map(t => [t.id, t.subject ?? '(no subject)']))

  const events: ThreadEvent[] = [
    ...runs.map((r): ThreadEvent => ({
      kind: 'agent_run',
      id: r.id,
      timestamp: r.finished_at ?? r.started_at ?? new Date(0).toISOString(),
      title: `${r.agent} run`,
      status: r.status,
      actor: r.agent,
      preview: truncate(r.output_summary ?? r.input ?? '', 200),
      meta: {
        input: r.input,
        output_summary: r.output_summary,
        cost_cents: r.cost_cents,
        started_at: r.started_at,
        finished_at: r.finished_at,
      },
    })),
    ...delivs.map((d): ThreadEvent => ({
      kind: 'deliverable',
      id: d.id,
      timestamp: d.updated_at ?? d.created_at,
      title: d.title,
      status: d.status,
      actor: d.author_agent,
      preview: truncate(d.content_md ?? '', 200),
      meta: {
        type: d.type,
        content_md: d.content_md,
        external_url: d.external_url,
        reviewer_notes: d.reviewer_notes,
        submitted_for_review_at: d.submitted_for_review_at,
        approved_at: d.approved_at,
        rejected_at: d.rejected_at,
        sent_at: d.sent_at,
      },
    })),
    ...drafts.map((d): ThreadEvent => ({
      kind: 'content_draft',
      id: d.id,
      timestamp: d.updated_at ?? d.created_at ?? new Date(0).toISOString(),
      title: d.title,
      status: d.status,
      actor: d.author_agent,
      preview: truncate(stripHtml(d.body_html ?? ''), 200),
      meta: {
        target_url: d.target_url,
        target_keyword: d.target_keyword,
        body_html: d.body_html,
        reviewer_notes: d.reviewer_notes,
        submitted_for_review_at: d.submitted_for_review_at,
        approved_at: d.approved_at,
        rejected_at: d.rejected_at,
        published_at: d.published_at,
      },
    })),
    ...threads.map((t): ThreadEvent => ({
      kind: 'outreach_thread',
      id: t.id,
      timestamp: t.last_activity_at ?? t.created_at ?? new Date(0).toISOString(),
      title: t.subject ?? '(no subject)',
      status: t.status,
      actor: t.from_email,
      preview: truncate(t.body_md ?? t.last_message ?? '', 200),
      meta: {
        to_email: t.to_email,
        from_email: t.from_email,
        body_md: t.body_md,
        last_message: t.last_message,
        reviewer_notes: t.reviewer_notes,
        submitted_for_review_at: t.submitted_for_review_at,
        approved_at: t.approved_at,
        rejected_at: t.rejected_at,
        sent_at: t.sent_at,
      },
    })),
    ...approvals.map((a): ThreadEvent => {
      const targetTitle =
        a.target_type === 'deliverable'     ? delivTitleById.get(a.target_id) :
        a.target_type === 'content_draft'   ? draftTitleById.get(a.target_id) :
        a.target_type === 'outreach_thread' ? threadTitleById.get(a.target_id) :
        null
      return {
        kind: 'approval',
        id: a.id,
        timestamp: a.created_at,
        title: `${prettyAction(a.action)} · ${targetTitle ?? a.target_type}`,
        status: a.action,
        actor: a.actor_type === 'agent' ? (a.actor_id ?? 'agent') : (a.actor_id ?? 'user'),
        preview: a.notes,
        meta: {
          target_type: a.target_type,
          target_id: a.target_id,
          actor_type: a.actor_type,
        },
      }
    }),
  ]

  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp))

  return NextResponse.json({
    issue,
    events,
    counts: {
      agent_runs      : runs.length,
      deliverables    : delivs.length,
      content_drafts  : drafts.length,
      outreach_threads: threads.length,
      approvals       : approvals.length,
      total           : events.length,
    },
  })
}

function prettyAction(action: string): string {
  switch (action) {
    case 'submit_for_review': return 'Submitted for review'
    case 'approve'          : return 'Approved'
    case 'reject'           : return 'Rejected'
    case 'edit'             : return 'Edited'
    case 'send'             : return 'Sent'
    case 'archive'          : return 'Archived'
    case 'revert'           : return 'Reverted'
    default                 : return action
  }
}
