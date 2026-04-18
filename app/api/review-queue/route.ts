/**
 * GET /api/review-queue
 *
 * Returns every item currently waiting for human approval — unioned across:
 *   • deliverables
 *   • content_drafts
 *   • outreach_threads
 *
 * Each item is normalised into a ReviewItem shape so the UI can render a single
 * expandable list. Results are enriched with client + issue context so the
 * reviewer can triage without drilling into the client page.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export type ReviewSourceType = 'deliverable' | 'content_draft' | 'outreach_thread'

export interface ReviewItem {
  source_type: ReviewSourceType
  source_id: string
  title: string
  type_label: string
  preview: string
  submitted_at: string | null
  created_at: string
  author_agent: string | null
  client: {
    id: string
    name: string | null
    domain: string | null
  } | null
  issue: {
    id: string
    title: string | null
  } | null
  // Source-specific payload for the expanded view
  payload: Record<string, unknown>
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Run the three pending_review queries in parallel
  const [deliverablesRes, draftsRes, threadsRes] = await Promise.all([
    supabase
      .from('deliverables')
      .select('id, client_id, issue_id, type, title, content_md, external_url, author_agent, submitted_for_review_at, created_at')
      .eq('status', 'pending_review')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('content_drafts')
      .select('id, client_id, issue_id, title, target_url, target_keyword, body_html, author_agent, submitted_for_review_at, created_at')
      .eq('status', 'pending_review')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('outreach_threads')
      .select('id, client_id, issue_id, subject, to_email, from_email, body_md, last_message, submitted_for_review_at, created_at')
      .eq('status', 'pending_review')
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  for (const res of [deliverablesRes, draftsRes, threadsRes]) {
    if (res.error) {
      return NextResponse.json({ error: res.error.message }, { status: 500 })
    }
  }

  const deliverables = deliverablesRes.data ?? []
  const drafts       = draftsRes.data ?? []
  const threads      = threadsRes.data ?? []

  // Collect ids for enrichment
  const clientIds = [...new Set([
    ...deliverables.map(d => d.client_id),
    ...drafts.map(d => d.client_id),
    ...threads.map(t => t.client_id),
  ])].filter((v): v is string => Boolean(v))

  const issueIds = [...new Set([
    ...deliverables.map(d => d.issue_id),
    ...drafts.map(d => d.issue_id),
    ...threads.map(t => t.issue_id),
  ])].filter((v): v is string => Boolean(v))

  const [clientsRes, issuesRes] = await Promise.all([
    clientIds.length > 0
      ? supabase.from('clients').select('id, name, domain').in('id', clientIds)
      : Promise.resolve({ data: [], error: null }),
    issueIds.length > 0
      ? supabase.from('issues').select('id, title').in('id', issueIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  type ClientRow = { id: string; name: string | null; domain: string | null }
  type IssueRow  = { id: string; title: string | null }

  const clientMap = new Map<string, ClientRow>(
    ((clientsRes.data ?? []) as ClientRow[]).map(c => [c.id, c])
  )
  const issueMap = new Map<string, IssueRow>(
    ((issuesRes.data ?? []) as IssueRow[]).map(i => [i.id, i])
  )

  function attachRefs(clientId: string | null, issueId: string | null) {
    return {
      client: clientId ? (clientMap.get(clientId) ?? { id: clientId, name: null, domain: null }) : null,
      issue : issueId  ? { id: issueId, title: issueMap.get(issueId)?.title ?? null } : null,
    }
  }

  function stripHtml(html: string | null): string {
    if (!html) return ''
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }

  // Normalise each source into a ReviewItem
  const items: ReviewItem[] = [
    ...deliverables.map((d): ReviewItem => ({
      source_type: 'deliverable',
      source_id: d.id,
      title: d.title,
      type_label: humanizeDeliverableType(d.type),
      preview: truncate(d.content_md ?? '', 240),
      submitted_at: d.submitted_for_review_at,
      created_at: d.created_at,
      author_agent: d.author_agent,
      ...attachRefs(d.client_id, d.issue_id),
      payload: {
        content_md  : d.content_md,
        external_url: d.external_url,
        type        : d.type,
      },
    })),
    ...drafts.map((d): ReviewItem => ({
      source_type: 'content_draft',
      source_id: d.id,
      title: d.title,
      type_label: 'Content draft',
      preview: truncate(stripHtml(d.body_html ?? ''), 240),
      submitted_at: d.submitted_for_review_at,
      created_at: d.created_at,
      author_agent: d.author_agent,
      ...attachRefs(d.client_id, d.issue_id),
      payload: {
        body_html      : d.body_html,
        target_url     : d.target_url,
        target_keyword : d.target_keyword,
      },
    })),
    ...threads.map((t): ReviewItem => ({
      source_type: 'outreach_thread',
      source_id: t.id,
      title: t.subject ?? '(no subject)',
      type_label: 'Outreach email',
      preview: truncate(t.body_md ?? t.last_message ?? '', 240),
      submitted_at: t.submitted_for_review_at,
      created_at: t.created_at,
      author_agent: null,
      ...attachRefs(t.client_id, t.issue_id),
      payload: {
        body_md    : t.body_md,
        to_email   : t.to_email,
        from_email : t.from_email,
      },
    })),
  ]

  // Newest submissions at the top. Fall back to created_at when submitted_at is null.
  items.sort((a, b) => {
    const aKey = a.submitted_at ?? a.created_at
    const bKey = b.submitted_at ?? b.created_at
    return bKey.localeCompare(aKey)
  })

  return NextResponse.json({
    items,
    counts: {
      total           : items.length,
      deliverables    : deliverables.length,
      content_drafts  : drafts.length,
      outreach_threads: threads.length,
    },
  })
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n).trimEnd() + '…'
}

function humanizeDeliverableType(t: string): string {
  switch (t) {
    case 'backlink_plan'    : return 'Backlink plan'
    case 'acquisition_plan' : return 'Acquisition plan'
    case 'audit_report'     : return 'Audit report'
    case 'content_brief'    : return 'Content brief'
    case 'strategy_doc'     : return 'Strategy doc'
    case 'keyword_research' : return 'Keyword research'
    case 'competitor_brief' : return 'Competitor brief'
    case 'geo_plan'         : return 'GEO plan'
    case 'recap_report'     : return 'Recap report'
    default                 : return 'Deliverable'
  }
}
