/**
 * GET/POST/PATCH/DELETE /api/clients/memory?clientId=xxx
 *
 * CRUD for client_memory entries. Used by the Memory panel UI
 * and by agents writing back what they learned.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// ── GET: List memory entries for a client ─────────────────────────────
export async function GET(req: Request) {
  const url = new URL(req.url)
  const clientId = url.searchParams.get('clientId')
  const showArchived = url.searchParams.get('archived') === 'true'
  const limit = Math.min(Number(url.searchParams.get('limit') || '50'), 200)

  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  }

  const supabase = getSupabase()

  let query = supabase
    .from('client_memory')
    .select('*')
    .eq('client_id', clientId)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (!showArchived) {
    query = query.eq('archived', false)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}

// ── POST: Add a new memory entry ──────────────────────────────────────
export async function POST(req: Request) {
  const body = await req.json()
  const { clientId, agent, category, content, importance, metadata } = body

  if (!clientId || !content) {
    return NextResponse.json({ error: 'clientId and content required' }, { status: 400 })
  }

  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('client_memory')
    .insert({
      client_id: clientId,
      agent: agent || 'user',
      category: category || 'insight',
      content,
      importance: importance || 'normal',
      metadata: metadata || {},
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

// ── PATCH: Update a memory entry (pin, edit, archive) ─────────────────
export async function PATCH(req: Request) {
  const body = await req.json()
  const { id, ...updates } = body

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  // Only allow safe fields to be updated
  const allowed: Record<string, unknown> = {}
  if ('content' in updates) allowed.content = updates.content
  if ('pinned' in updates) allowed.pinned = updates.pinned
  if ('archived' in updates) allowed.archived = updates.archived
  if ('importance' in updates) allowed.importance = updates.importance
  if ('category' in updates) allowed.category = updates.category

  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('client_memory')
    .update(allowed)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

// ── DELETE: Hard delete a memory entry ────────────────────────────────
export async function DELETE(req: Request) {
  const url = new URL(req.url)
  const id = url.searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  const supabase = getSupabase()

  const { error } = await supabase
    .from('client_memory')
    .delete()
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ deleted: true })
}
