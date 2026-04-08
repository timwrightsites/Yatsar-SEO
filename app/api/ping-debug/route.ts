import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Brand-new route to bypass any route-level cache. Delete after debugging.
export async function GET(request: Request) {
  const key = request.headers.get('x-agent-key') ?? ''
  const envKey = process.env.OPENCLAW_GATEWAY_TOKEN ?? ''

  return NextResponse.json({
    marker: 'PING_DEBUG_V1',
    now: new Date().toISOString(),
    header: {
      present: !!key,
      length: key.length,
      first3: key.slice(0, 3),
      last3: key.slice(-3),
      charCodes: Array.from(key).map(c => c.charCodeAt(0)),
    },
    env: {
      present: !!envKey,
      length: envKey.length,
      first3: envKey.slice(0, 3),
      last3: envKey.slice(-3),
      charCodes: Array.from(envKey).map(c => c.charCodeAt(0)),
    },
    match: key === envKey,
  })
}
