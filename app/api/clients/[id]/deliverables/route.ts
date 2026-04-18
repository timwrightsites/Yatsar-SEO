/**
 * GET /api/clients/[id]/deliverables
 *
 * Returns every deliverable for a client (strategy docs, audit reports,
 * backlink plans, content briefs, GEO plans, recap reports, etc.) sorted
 * by most recent. Enriches with the issue title so the tab can show
 * "TRU-28: Cobb In Focus outreach → Backlink plan" at a glance.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

interface Props {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, { params }: Props) {
  const { id } = await params

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: deliverables, error } = await supabase
    .from('deliverables')
    .select('id, issue_id, type, title, content_md, external_url, status, author_agent, reviewer_notes, submitted_for_review_at, approved_at, rejected_at, sent_at, created_at, updated_at')
    .eq('client_id', id)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const issueIds = [...new Set(
    (deliverables ?? [])
      .map(d => d.issue_id)
      .filter((v): v is string => Boolean(v))
  )]

  let issueMap = new Map<string, string>()
  if (issueIds.length > 0) {
    const { data: issues } = await supabase
      .from('issues')
      .select('id, title')
      .in('id', issueIds)
    issueMap = new Map(
      (issues ?? []).map((i: { id: string; title: string | null }) => [i.id, i.title ?? ''])
    )
  }

  const enriched = (deliverables ?? []).map(d => ({
    ...d,
    issue_title: d.issue_id ? (issueMap.get(d.issue_id) ?? null) : null,
  }))

  return NextResponse.json({
    deliverables: enriched,
    counts: {
      total          : enriched.length,
      pending_review : enriched.filter(d => d.status === 'pending_review').length,
      approved       : enriched.filter(d => d.status === 'approved').length,
      sent           : enriched.filter(d => d.status === 'sent').length,
      rejected       : enriched.filter(d => d.status === 'rejected').length,
      draft          : enriched.filter(d => d.status === 'draft').length,
    },
  })
}
