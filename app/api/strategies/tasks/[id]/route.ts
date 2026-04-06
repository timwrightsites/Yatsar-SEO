import { createClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

function isAgentCall(request: Request) {
  const key = request.headers.get('x-agent-key')
  return key && key === process.env.OPENCLAW_GATEWAY_TOKEN
}

async function getUser(request: Request) {
  if (isAgentCall(request)) return { authorized: true }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { authorized: !!user }
}

// PATCH /api/strategies/tasks/[id] — update task (status, notes, output_ref, etc.)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { authorized } = await getUser(request)
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  const allowed = ['title', 'description', 'type', 'status', 'priority', 'due_date', 'assigned_agent', 'output_ref', 'notes']
  const updates = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)))

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('strategy_tasks')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/strategies/tasks/[id]
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { authorized } = await getUser(request)
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('strategy_tasks').delete().eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
