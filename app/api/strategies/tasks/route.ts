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

// GET /api/strategies/tasks?clientId=xxx  — all tasks for a client (agency view)
// GET /api/strategies/tasks?strategyId=xxx — tasks for one strategy
export async function GET(request: Request) {
  const { authorized } = await getUser(request)
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const clientId    = searchParams.get('clientId')
  const strategyId  = searchParams.get('strategyId')
  const allActive   = searchParams.get('allActive') // agency view — all active clients

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from('strategy_tasks')
    .select(`*, strategies(name, status), clients(name, domain)`)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (strategyId) {
    q = q.eq('strategy_id', strategyId)
  } else if (clientId) {
    q = q.eq('client_id', clientId)
  } else if (allActive === 'true') {
    // Agency view: tasks for all active clients with gsc_property
    const { data: activeClients } = await (supabase as any)
      .from('clients')
      .select('id')
      .eq('status', 'active')
      .not('gsc_property', 'is', null)
    const ids = (activeClients ?? []).map((c: { id: string }) => c.id)
    if (ids.length === 0) return NextResponse.json([])
    q = q.in('client_id', ids)
  } else {
    return NextResponse.json({ error: 'Missing clientId, strategyId, or allActive param' }, { status: 400 })
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/strategies/tasks — create a task (agent or user)
export async function POST(request: Request) {
  const { authorized } = await getUser(request)
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { strategy_id, client_id, title, description, type, priority, due_date, assigned_agent, notes } = body

  if (!strategy_id || !client_id || !title) {
    return NextResponse.json({ error: 'Missing strategy_id, client_id, or title' }, { status: 400 })
  }

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('strategy_tasks')
    .insert({ strategy_id, client_id, title, description, type, priority, due_date, assigned_agent, notes })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
