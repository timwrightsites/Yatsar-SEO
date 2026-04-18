/**
 * POST /api/review-queue/approve
 *
 * Body: { source_type, source_id, notes?, edited_body? }
 *
 * Flips the source row from `pending_review` → `approved`, stamps approved_at,
 * optionally persists an edited body (content_drafts.body_html or
 * outreach_threads.body_md or deliverables.content_md), and writes an
 * `approvals` audit row.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'

type SourceType = 'deliverable' | 'content_draft' | 'outreach_thread'

const TABLE_FOR: Record<SourceType, string> = {
  deliverable     : 'deliverables',
  content_draft   : 'content_drafts',
  outreach_thread : 'outreach_threads',
}

export async function POST(req: Request) {
  let body: {
    source_type?: SourceType
    source_id?: string
    notes?: string
    edited_body?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { source_type, source_id, notes, edited_body } = body

  if (!source_type || !source_id || !(source_type in TABLE_FOR)) {
    return NextResponse.json({ error: 'missing_or_invalid_params' }, { status: 400 })
  }

  // Resolve the acting user (if signed in) for the audit trail.
  const ssr = await createServerClient()
  const { data: authRes } = await ssr.auth.getUser()
  const actorId = authRes.user?.id ?? null

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const now = new Date().toISOString()
  const table = TABLE_FOR[source_type]

  // Build the update patch per source type
  const patch: Record<string, unknown> = {
    status      : 'approved',
    approved_at : now,
    updated_at  : now,
  }
  if (typeof notes === 'string' && notes.trim().length > 0) {
    patch.reviewer_notes = notes.trim()
  }
  if (typeof edited_body === 'string' && edited_body.length > 0) {
    if (source_type === 'deliverable')     patch.content_md = edited_body
    if (source_type === 'content_draft')   patch.body_html  = edited_body
    if (source_type === 'outreach_thread') patch.body_md    = edited_body
  }

  // outreach_threads has no updated_at column; drop it to avoid errors
  if (source_type === 'outreach_thread') {
    delete patch.updated_at
  }

  const { error: updateErr } = await admin
    .from(table)
    .update(patch)
    .eq('id', source_id)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // Audit trail (best-effort; don't fail the request if logging fails)
  await admin.from('approvals').insert({
    target_type : source_type,
    target_id   : source_id,
    action      : 'approve',
    actor_type  : actorId ? 'user' : 'agent',
    actor_id    : actorId,
    notes       : notes?.trim() || null,
  })

  return NextResponse.json({ ok: true })
}
