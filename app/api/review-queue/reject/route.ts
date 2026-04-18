/**
 * POST /api/review-queue/reject
 *
 * Body: { source_type, source_id, notes }
 *
 * Flips the source row from `pending_review` → `rejected`, stamps rejected_at,
 * persists reviewer_notes (required — reviewer must say why), and writes an
 * `approvals` audit row. The agent can pick the rejected row back up and
 * re-submit a new version using the notes as guidance.
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
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { source_type, source_id, notes } = body

  if (!source_type || !source_id || !(source_type in TABLE_FOR)) {
    return NextResponse.json({ error: 'missing_or_invalid_params' }, { status: 400 })
  }

  if (!notes || notes.trim().length === 0) {
    return NextResponse.json({ error: 'reviewer_notes_required' }, { status: 400 })
  }

  const ssr = await createServerClient()
  const { data: authRes } = await ssr.auth.getUser()
  const actorId = authRes.user?.id ?? null

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const now = new Date().toISOString()
  const table = TABLE_FOR[source_type]

  const patch: Record<string, unknown> = {
    status         : 'rejected',
    rejected_at    : now,
    reviewer_notes : notes.trim(),
    updated_at     : now,
  }

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

  await admin.from('approvals').insert({
    target_type : source_type,
    target_id   : source_id,
    action      : 'reject',
    actor_type  : actorId ? 'user' : 'agent',
    actor_id    : actorId,
    notes       : notes.trim(),
  })

  return NextResponse.json({ ok: true })
}
