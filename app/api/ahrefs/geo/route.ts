import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { fetchGeoVisibility, AhrefsKeyMissingError, AhrefsApiError } from '@/lib/ahrefs'

/**
 * GET /api/ahrefs/geo?clientId=…&target=…&country=us&limit=50&fresh=1
 *
 * Returns a Generative Engine Optimization visibility report — what slice of
 * the client's organic-keyword footprint shows up in AI Overviews / SGE /
 * featured snippets / knowledge panels. Data is sourced from Ahrefs API v3
 * `site-explorer/organic-keywords` with the `serp_features` selector.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId')
  const target   = searchParams.get('target')
  const country  = searchParams.get('country') ?? undefined
  const limit    = Number(searchParams.get('limit') ?? 50)
  const fresh    = searchParams.get('fresh') === '1'

  if (!clientId || !target) {
    return NextResponse.json({ error: 'clientId and target are required' }, { status: 400 })
  }

  try {
    const supabase = await createClient()
    const data = await fetchGeoVisibility({ supabase, clientId, target, country, limit, forceFresh: fresh })
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
