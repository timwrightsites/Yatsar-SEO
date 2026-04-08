import { createClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

function isAgentCall(request: Request) {
  const key = request.headers.get('x-agent-key')
  const envKey = process.env.OPENCLAW_GATEWAY_TOKEN
  // TEMP DIAGNOSTIC - remove after fixing auth
  console.log('[AUTH-DEBUG]', JSON.stringify({
    headerPresent: !!key,
    headerLen: key?.length ?? 0,
    headerFirst3: key?.slice(0, 3) ?? null,
    headerLast3: key?.slice(-3) ?? null,
    envPresent: !!envKey,
    envLen: envKey?.length ?? 0,
    envFirst3: envKey?.slice(0, 3) ?? null,
    envLast3: envKey?.slice(-3) ?? null,
    match: key === envKey,
  }))
  return key && key === envKey
}


async function getUser(request: Request) {
  if (isAgentCall(request)) return { authorized: true }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { authorized: !!user }
}

// GET /api/strategies?clientId=xxx  — list strategies for a client
export async function GET(request: Request) {
  const { authorized } = await getUser(request)
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('strategies')
    .select(`*, strategy_tasks(*)`)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/strategies — create a strategy
export async function POST(request: Request) {
  const { authorized } = await getUser(request)
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { client_id, name, description } = body
  if (!client_id || !name) return NextResponse.json({ error: 'Missing client_id or name' }, { status: 400 })

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('strategies')
    .insert({ client_id, name, description })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
