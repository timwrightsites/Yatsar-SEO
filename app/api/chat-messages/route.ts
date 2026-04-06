import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

// GET /api/chat-messages?clientId=xxx&agentId=yyy&limit=50
// Returns persisted messages for a client/agent combo, oldest first
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  const agentId  = searchParams.get('agentId') || 'seo-co-strategist'
  const limit    = Math.min(parseInt(searchParams.get('limit') || '50'), 200)

  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('chat_messages')
    .select('id, role, content, created_at, agent_id')
    .eq('client_id', clientId)
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Reverse so oldest is first (chat display order)
  return NextResponse.json((data || []).reverse())
}

// POST /api/chat-messages
// Saves a single message (called after each user send + assistant reply)
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { clientId: string; agentId?: string; role: string; content: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { clientId, agentId = 'seo-co-strategist', role, content } = body

  if (!clientId || !role || !content) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('chat_messages')
    .insert({ client_id: clientId, agent_id: agentId, role, content })
    .select('id, role, content, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/chat-messages?clientId=xxx&agentId=yyy
// Clears conversation history for a client (useful "clear chat" button)
export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  const agentId  = searchParams.get('agentId') || 'seo-co-strategist'

  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('chat_messages')
    .delete()
    .eq('client_id', clientId)
    .eq('agent_id', agentId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
