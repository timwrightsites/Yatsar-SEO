import { createClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json() as {
    subject?:        string
    body?:           string
    tone?:           string
    status?:         string
    reviewer_notes?: string
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = {}
  if ('subject'        in body) update.subject        = body.subject
  if ('body'           in body) update.body           = body.body
  if ('tone'           in body) update.tone           = body.tone
  if ('status'         in body) update.status         = body.status
  if ('reviewer_notes' in body) update.reviewer_notes = body.reviewer_notes

  if (body.status === 'approved' || body.status === 'rejected' || body.status === 'sent') {
    update.reviewed_at = new Date().toISOString()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('outreach_drafts')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('outreach_drafts')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
