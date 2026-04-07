import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { fetchCompetitors, AhrefsKeyMissingError, AhrefsApiError } from '@/lib/ahrefs'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId')
  const target   = searchParams.get('target')
  const limit    = Number(searchParams.get('limit') ?? 25)
  const fresh    = searchParams.get('fresh') === '1'

  if (!clientId || !target) {
    return NextResponse.json({ error: 'clientId and target are required' }, { status: 400 })
  }

  try {
    const supabase = await createClient()
    const data = await fetchCompetitors({ supabase, clientId, target, limit, forceFresh: fresh })
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof AhrefsKeyMissingError) {
      return NextResponse.json({ error: 'AHREFS_API_KEY not set', code: 'KEY_MISSING' }, { status: 503 })
    }
    if (err instanceof AhrefsApiError) {
      return NextResponse.json({ error: err.message, code: 'AHREFS_ERROR', status: err.status }, { status: 502 })
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
