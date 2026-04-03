import { createClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    name: string
    domain: string
    industry?: string | null
    monthly_retainer?: number | null
    gsc_property?: string | null
    pagespeed_url?: string | null
    status?: string
  }

  if (!body.name || !body.domain) {
    return NextResponse.json({ error: 'name and domain are required' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('clients')
    .insert({
      name: body.name,
      domain: body.domain,
      industry: body.industry ?? null,
      monthly_retainer: body.monthly_retainer ?? null,
      gsc_property: body.gsc_property ?? null,
      pagespeed_url: body.pagespeed_url ?? null,
      status: body.status ?? 'active',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
