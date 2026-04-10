import { createClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

// GET /api/competitors?clientId=xxx — list competitors for a client
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('competitors')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/competitors — add a competitor
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { client_id, domain, notes } = body

  if (!client_id || !domain) {
    return NextResponse.json({ error: 'Missing client_id or domain' }, { status: 400 })
  }

  // Normalize domain — strip protocol, trailing slash, www
  const clean = domain
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
    .toLowerCase()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('competitors')
    .upsert(
      { client_id, domain: clean, notes: notes || null },
      { onConflict: 'client_id,domain' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/competitors?id=xxx — remove a competitor
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('competitors')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
