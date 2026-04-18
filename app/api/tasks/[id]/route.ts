/**
 * /api/tasks/[id]
 *
 *   PATCH  — update any subset of { status, priority, title, description,
 *            notes, scheduled_for, type }. Stamps updated_at and, when
 *            the status flips to 'done', also stamps completed_at (and
 *            clears it when flipped back off 'done').
 *
 *   DELETE — hard delete. The task list is the authoritative PM surface
 *            here, so soft-delete adds noise without buying anything.
 *
 * Both endpoints return the resulting row joined with client name so the
 * client-side optimistic cache can refresh without an extra fetch.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_STATUSES   = ['todo', 'in_progress', 'needs_approval', 'done', 'blocked'] as const
const VALID_PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const

interface Params { params: Promise<{ id: string }> }

// ── PATCH ───────────────────────────────────────────────────────────────

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}

  if (typeof payload.title === 'string') {
    const t = payload.title.trim()
    if (!t) return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 })
    update.title = t
  }

  if (payload.description === null || typeof payload.description === 'string') {
    update.description = payload.description
  }

  if (payload.notes === null || typeof payload.notes === 'string') {
    update.notes = payload.notes
  }

  if (typeof payload.type === 'string' || payload.type === null) {
    update.type = payload.type
  }

  if (typeof payload.scheduled_for === 'string' || payload.scheduled_for === null) {
    update.scheduled_for = payload.scheduled_for
  }

  if (typeof payload.priority === 'string') {
    if (!(VALID_PRIORITIES as readonly string[]).includes(payload.priority)) {
      return NextResponse.json({ error: `invalid priority '${payload.priority}'` }, { status: 400 })
    }
    update.priority = payload.priority
  }

  if (typeof payload.status === 'string') {
    if (!(VALID_STATUSES as readonly string[]).includes(payload.status)) {
      return NextResponse.json({ error: `invalid status '${payload.status}'` }, { status: 400 })
    }
    update.status = payload.status
    // completed_at tracks "when the reviewer flipped this to done". Clear
    // it when the task is un-done so history stays honest.
    update.completed_at = payload.status === 'done' ? new Date().toISOString() : null
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'no updatable fields supplied' }, { status: 400 })
  }

  update.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('strategy_tasks')
    .update(update)
    .eq('id', id)
    .select('id, client_id, title, description, type, status, priority, scheduled_for, completed_at, notes, created_at, updated_at')
    .single() as {
      data: {
        id: string; client_id: string; title: string; description: string | null
        type: string | null; status: string; priority: string
        scheduled_for: string | null; completed_at: string | null
        notes: string | null; created_at: string; updated_at: string
      } | null
      error: { message: string } | null
    }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const { data: clientRow } = await supabase
    .from('clients')
    .select('name')
    .eq('id', data.client_id)
    .maybeSingle() as { data: { name: string } | null }

  return NextResponse.json({
    task: { ...data, client_name: clientRow?.name ?? null },
  })
}

// ── DELETE ──────────────────────────────────────────────────────────────

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { error } = await supabase
    .from('strategy_tasks')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
