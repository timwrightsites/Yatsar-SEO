import { createClient } from '@/lib/supabase-server'
import { createSign } from 'crypto'
import { NextResponse } from 'next/server'

// ── Google service account JWT auth ──────────────────────────────────────────

function base64url(input: string): string {
  return Buffer.from(input).toString('base64url')
}

function signJWT(clientEmail: string, privateKey: string, scope: string): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const payload = base64url(JSON.stringify({
    iss: clientEmail,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }))
  const sign = createSign('RSA-SHA256')
  sign.update(`${header}.${payload}`)
  return `${header}.${payload}.${sign.sign(privateKey, 'base64url')}`
}

async function getGoogleAccessToken(clientEmail: string, privateKey: string, scope: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signJWT(clientEmail, privateKey, scope),
    }),
  })
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`)
  return ((await res.json()) as { access_token: string }).access_token
}

// ── GSC API helper ────────────────────────────────────────────────────────────

interface GSCRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

async function query(
  accessToken: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
  dimensions: string[],
  rowLimit = 25,
): Promise<GSCRow[]> {
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate, endDate, dimensions, rowLimit }),
    }
  )
  if (!res.ok) throw new Error(`GSC API error: ${await res.text()}`)
  return ((await res.json()) as { rows?: GSCRow[] }).rows ?? []
}

function fmt(rows: GSCRow[], keyFn: (keys: string[]) => Record<string, string>) {
  return rows.map(r => ({
    ...keyFn(r.keys),
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: Number((r.ctr * 100).toFixed(1)),
    position: Number(r.position.toFixed(1)),
  }))
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const property = searchParams.get('property')
  if (!property) return NextResponse.json({ error: 'Missing property param' }, { status: 400 })

  const endDate   = searchParams.get('endDate')   ?? daysAgo(0)
  const startDate = searchParams.get('startDate') ?? daysAgo(90)

  // Previous period — same length, shifted back
  const periodMs    = new Date(endDate).getTime() - new Date(startDate).getTime()
  const prevEnd     = new Date(new Date(startDate).getTime() - 86400000).toISOString().split('T')[0]
  const prevStart   = new Date(new Date(startDate).getTime() - periodMs - 86400000).toISOString().split('T')[0]

  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!saJson) return NextResponse.json({ error: 'GOOGLE_SERVICE_ACCOUNT_JSON not set' }, { status: 500 })

  let sa: { client_email: string; private_key: string }
  try { sa = JSON.parse(saJson) }
  catch { return NextResponse.json({ error: 'Invalid GOOGLE_SERVICE_ACCOUNT_JSON' }, { status: 500 }) }

  try {
    const token = await getGoogleAccessToken(sa.client_email, sa.private_key, 'https://www.googleapis.com/auth/webmasters.readonly')

    // All fetches in parallel
    const [
      overviewRows,
      queryRows,
      pageRows,
      dateRows,
      deviceRows,
      keywordsByPageRows,
      prevQueryRows,
    ] = await Promise.all([
      query(token, property, startDate, endDate, [],              1),
      query(token, property, startDate, endDate, ['query'],      25),
      query(token, property, startDate, endDate, ['page'],       15),
      query(token, property, startDate, endDate, ['date'],       90),
      query(token, property, startDate, endDate, ['device'],      3),
      query(token, property, startDate, endDate, ['query','page'], 50),
      query(token, property, prevStart,  prevEnd, ['query'],     25),
    ])

    const ov = overviewRows[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 }

    // ── Derived insights ───────────────────────────────────────────────────────

    const avgCtr         = ov.ctr * 100
    const avgImpressions = queryRows.reduce((s, r) => s + r.impressions, 0) / (queryRows.length || 1)

    // High impression / low CTR — ranking well but not getting clicked
    const highImpLowCTR = queryRows
      .filter(r => r.impressions > avgImpressions && r.ctr * 100 < avgCtr * 0.7)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 10)

    // High CTR / low impressions — performing well but not indexed broadly
    const highCTRLowImp = queryRows
      .filter(r => r.impressions < avgImpressions && r.ctr * 100 > avgCtr * 1.3)
      .sort((a, b) => b.ctr - a.ctr)
      .slice(0, 10)

    // Position changes — compare current vs previous period
    const prevMap = new Map(prevQueryRows.map(r => [r.keys[0], r.position]))
    const positionChanges = queryRows
      .filter(r => prevMap.has(r.keys[0]))
      .map(r => ({
        query: r.keys[0],
        currentPosition: Number(r.position.toFixed(1)),
        prevPosition:    Number((prevMap.get(r.keys[0]) ?? r.position).toFixed(1)),
        change:          Number(((prevMap.get(r.keys[0]) ?? r.position) - r.position).toFixed(1)),
        clicks:          r.clicks,
        impressions:     r.impressions,
      }))
      .filter(r => Math.abs(r.change) > 0)
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 15)

    // Keywords by page — group query+page rows by page
    const byPageMap = new Map<string, { query: string; clicks: number; impressions: number; ctr: number; position: number }[]>()
    for (const r of keywordsByPageRows) {
      const [kw, page] = r.keys
      if (!byPageMap.has(page)) byPageMap.set(page, [])
      byPageMap.get(page)!.push({ query: kw, clicks: r.clicks, impressions: r.impressions, ctr: Number((r.ctr * 100).toFixed(1)), position: Number(r.position.toFixed(1)) })
    }
    const keywordsByPage = Array.from(byPageMap.entries())
      .map(([page, keywords]) => ({ page, keywords: keywords.sort((a, b) => b.clicks - a.clicks) }))
      .sort((a, b) => b.keywords.reduce((s, k) => s + k.clicks, 0) - a.keywords.reduce((s, k) => s + k.clicks, 0))
      .slice(0, 10)

    // Device breakdown with CTR
    const devices = deviceRows.map(r => ({
      device:      r.keys[0],
      clicks:      r.clicks,
      impressions: r.impressions,
      ctr:         Number((r.ctr * 100).toFixed(1)),
      position:    Number(r.position.toFixed(1)),
    }))

    return NextResponse.json({
      property, startDate, endDate,
      overview: {
        clicks:      ov.clicks,
        impressions: ov.impressions,
        ctr:         Number((ov.ctr * 100).toFixed(1)),
        position:    Number(ov.position.toFixed(1)),
      },
      dateRows:    fmt(dateRows,  keys => ({ date: keys[0] })),
      topQueries:  fmt(queryRows, keys => ({ query: keys[0] })),
      topPages:    fmt(pageRows,  keys => ({ page: keys[0] })),
      devices,
      highImpLowCTR:   fmt(highImpLowCTR, keys => ({ query: keys[0] })),
      highCTRLowImp:   fmt(highCTRLowImp, keys => ({ query: keys[0] })),
      positionChanges,
      keywordsByPage,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
