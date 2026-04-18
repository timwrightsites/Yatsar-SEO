/**
 * /api/tasks
 *
 *   GET  — list tasks, optionally filtered by client/status/priority/search.
 *          Returns rows joined with the client name so the agency-wide
 *          inbox can show a client chip without a second round-trip.
 *
 *   POST — create a new task. Only client_id and title are required;
 *          everything else defaults.
 *
 * The view is designed for two surfaces:
 *   - Top-level /tasks — cross-client daily inbox
 *   - Per-client tab   — `?client_id=<uuid>` to scope to a single client
 *
 * Status values (what the UI exposes; enforced here, not in the DB):
 *   todo | in_progress | needs_approval | done | blocked
 *
 * Priority values:
 *   urgent | high | normal | low
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_STATUSES   = ['todo', 'in_progress', 'needs_approval', 'done', 'blocked'] as const
const VALID_PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const

export interface TaskListItem {
  id:            string
  client_id:     string
  client_name:   string | null
  title:         string
  description:   string | null
  type:          string | null
  status:        string
  priority:      string
  scheduled_for: string | null
  completed_at:  string | null
  notes:         string | null
  created_at:    string
  updated_at:    string
}

export interface TaskListResponse {
  tasks: TaskListItem[]
  counts: {
    total:          number
    todo:           number
    in_progress:    number
    needs_approval: number
    done:           number
    blocked:        number
    overdue:        number
  }
}

// ── GET — list with filters ─────────────────────────────────────────────

export async function GET(req: Request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const url = new URL(req.url)
  const clientId  = url.searchParams.get('client_id')
  const statusQ   = url.searchParams.get('status')
  const priorityQ = url.searchParams.get('priority')
  const search    = url.searchParams.get('q')?.trim()
  const limit     = Math.min(Number(url.searchParams.get('limit') ?? 200), 500)

  let q = supabase
    .from('strategy_tasks')
    .select('id, client_id, title, description, type, status, priority, scheduled_for, completed_at, notes, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (clientId)                                              q = q.eq('client_id', clientId)
  if (statusQ   && (VALID_STATUSES   as readonly string[]).includes(statusQ))   q = q.eq('status',   statusQ)
  if (priorityQ && (VALID_PRIORITIES as readonly string[]).includes(priorityQ)) q = q.eq('priority', priorityQ)
  if (search)                                                q = q.ilike('title', `%${search}%`)

  const { data: rawTasks, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  type Row = {
    id: string; client_id: string; title: string; description: string | null
    type: string | null; status: string; priority: string
    scheduled_for: string | null; completed_at: string | null
    notes: string | null; created_at: string; updated_at: string
  }
  const tasks = (rawTasks ?? []) as Row[]

  // ── Hydrate client name in one round-trip ─────────────────────────────
  const clientIds = Array.from(new Set(tasks.map(t => t.client_id)))
  const clientNameById = new Map<string, string>()
  if (clientIds.length > 0) {
    const { data: clients } = await supabase
      .from('clients')
      .select('id, name')
      .in('id', clientIds)
    for (const c of (clients ?? []) as { id: string; name: string }[]) {
      clientNameById.set(c.id, c.name)
    }
  }

  const nowMs = Date.now()
  const counts = {
    total:          tasks.length,
    todo:           0,
    in_progress:    0,
    needs_approval: 0,
    done:           0,
    blocked:        0,
    overdue:        0,
  }

  const out: TaskListItem[] = tasks.map(t => {
    // Bump counters as we go so we don't re-iterate.
    if (t.status === 'todo')           counts.todo++
    if (t.status === 'in_progress')    counts.in_progress++
    if (t.status === 'needs_approval') counts.needs_approval++
    if (t.status === 'done')           counts.done++
    if (t.status === 'blocked')        counts.blocked++
    if (t.scheduled_for && t.status !== 'done' && Date.parse(t.scheduled_for) < nowMs) {
      counts.overdue++
    }

    return {
      id:            t.id,
      client_id:     t.client_id,
      client_name:   clientNameById.get(t.client_id) ?? null,
      title:         t.title,
      description:   t.description,
      type:          t.type,
      status:        t.status,
      priority:      t.priority,
      scheduled_for: t.scheduled_for,
      completed_at:  t.completed_at,
      notes:         t.notes,
      created_at:    t.created_at,
      updated_at:    t.updated_at,
    }
  })

  const body: TaskListResponse = { tasks: out, counts }
  return NextResponse.json(body)
}

// ── POST — create a new task ────────────────────────────────────────────

export async function POST(req: Request) {
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

  const clientId      = typeof payload.client_id     === 'string' ? payload.client_id     : null
  const title         = typeof payload.title         === 'string' ? payload.title.trim()  : ''
  const description   = typeof payload.description   === 'string' ? payload.description   : null
  const type          = typeof payload.type          === 'string' ? payload.type          : null
  const notes         = typeof payload.notes         === 'string' ? payload.notes         : null
  const scheduledFor  = typeof payload.scheduled_for === 'string' ? payload.scheduled_for : null
  const statusRaw     = typeof payload.status        === 'string' ? payload.status        : 'todo'
  const priorityRaw   = typeof payload.priority      === 'string' ? payload.priority      : 'normal'

  if (!clientId) return NextResponse.json({ error: 'client_id is required' }, { status: 400 })
  if (!title)    return NextResponse.json({ error: 'title is required'     }, { status: 400 })

  const status   = (VALID_STATUSES   as readonly string[]).includes(statusRaw)   ? statusRaw   : 'todo'
  const priority = (VALID_PRIORITIES as readonly string[]).includes(priorityRaw) ? priorityRaw : 'normal'

  const { data, error } = await supabase
    .from('strategy_tasks')
    .insert({
      client_id:     clientId,
      title,
      description,
      type,
      notes,
      scheduled_for: scheduledFor,
      status,
      priority,
    })
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

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
  }

  // Hydrate client name for the optimistic UI.
  const { data: clientRow } = await supabase
    .from('clients')
    .select('name')
    .eq('id', clientId)
    .maybeSingle() as { data: { name: string } | null }

  const task: TaskListItem = {
    ...data,
    client_name: clientRow?.name ?? null,
  }

  return NextResponse.json({ task }, { status: 201 })
}
