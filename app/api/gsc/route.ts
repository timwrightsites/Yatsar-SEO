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
  const signature = sign.sign(privateKey, 'base64url')

  return `${header}.${payload}.${signature}`
}

async function getGoogleAccessToken(clientEmail: string, privateKey: string, scope: string): Promise<string> {
  const jwt = signJWT(clientEmail, privateKey, scope)

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Google token exchange failed: ${err}`)
  }

  const data = await res.json() as { access_token: string }
  return data.access_token
}

// ── GSC API helpers ───────────────────────────────────────────────────────────

interface GSCRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

async function querySearchAnalytics(
  accessToken: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
  dimensions: string[],
  rowLimit = 10,
): Promise<GSCRow[]> {
  const encodedSite = encodeURIComponent(siteUrl)
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ startDate, endDate, dimensions, rowLimit }),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`GSC API error: ${err}`)
  }

  const data = await res.json() as { rows?: GSCRow[] }
  return data.rows ?? []
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  // Verify Supabase session
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const property = searchParams.get('property')
  if (!property) {
    return NextResponse.json({ error: 'Missing property param' }, { status: 400 })
  }

  // Default to last 90 days
  const endDate = searchParams.get('endDate') ?? new Date().toISOString().split('T')[0]
  const startDate = searchParams.get('startDate') ?? (() => {
    const d = new Date()
    d.setDate(d.getDate() - 90)
    return d.toISOString().split('T')[0]
  })()

  // Load service account credentials
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!saJson) {
    return NextResponse.json({ error: 'GOOGLE_SERVICE_ACCOUNT_JSON env var not set' }, { status: 500 })
  }

  let serviceAccount: { client_email: string; private_key: string }
  try {
    serviceAccount = JSON.parse(saJson)
  } catch {
    return NextResponse.json({ error: 'Invalid GOOGLE_SERVICE_ACCOUNT_JSON' }, { status: 500 })
  }

  try {
    const accessToken = await getGoogleAccessToken(
      serviceAccount.client_email,
      serviceAccount.private_key,
      'https://www.googleapis.com/auth/webmasters.readonly',
    )

    // Fetch overview (no dimensions = site totals), top queries, top pages in parallel
    const [overviewRows, queryRows, pageRows] = await Promise.all([
      querySearchAnalytics(accessToken, property, startDate, endDate, [], 1),
      querySearchAnalytics(accessToken, property, startDate, endDate, ['query'], 10),
      querySearchAnalytics(accessToken, property, startDate, endDate, ['page'], 10),
    ])

    const overview = overviewRows[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 }

    return NextResponse.json({
      property,
      startDate,
      endDate,
      overview: {
        clicks: overview.clicks,
        impressions: overview.impressions,
        ctr: Number((overview.ctr * 100).toFixed(1)),
        position: Number(overview.position.toFixed(1)),
      },
      topQueries: queryRows.map(r => ({
        query: r.keys[0],
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: Number((r.ctr * 100).toFixed(1)),
        position: Number(r.position.toFixed(1)),
      })),
      topPages: pageRows.map(r => ({
        page: r.keys[0],
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: Number((r.ctr * 100).toFixed(1)),
        position: Number(r.position.toFixed(1)),
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
