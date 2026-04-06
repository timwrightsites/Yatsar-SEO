import { createClient } from '@/lib/supabase-server'
import { createSign } from 'crypto'
import { NextResponse } from 'next/server'

// ── Auth ───────────────────────────────────────────────────────────────────────

async function isAuthorized(request: Request): Promise<boolean> {
  const agentKey = request.headers.get('x-agent-key')
  if (agentKey && agentKey === process.env.OPENCLAW_GATEWAY_TOKEN) return true
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return !!user
}

// ── Google service account JWT ────────────────────────────────────────────────

function base64url(input: string): string {
  return Buffer.from(input).toString('base64url')
}

function signJWT(clientEmail: string, privateKey: string, scope: string): string {
  const header  = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const now     = Math.floor(Date.now() / 1000)
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

async function getAccessToken(clientEmail: string, privateKey: string, scope: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  signJWT(clientEmail, privateKey, scope),
    }),
  })
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`)
  return ((await res.json()) as { access_token: string }).access_token
}

// ── Submit a single URL to Google Indexing API ────────────────────────────────

interface IndexResult {
  url: string
  status: 'submitted' | 'error'
  message?: string
}

async function submitUrl(token: string, url: string): Promise<IndexResult> {
  try {
    const res = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, type: 'URL_UPDATED' }),
    })
    if (!res.ok) {
      const body = await res.text()
      return { url, status: 'error', message: body }
    }
    return { url, status: 'submitted' }
  } catch (err) {
    return { url, status: 'error', message: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ── POST — submit URLs for indexing ──────────────────────────────────────────

export async function POST(request: Request) {
  if (!await isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { urls?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { urls } = body
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json({ error: 'Missing or empty urls array' }, { status: 400 })
  }

  const urlsToSubmit = urls.slice(0, 200) // Google Indexing API: 200/day limit

  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!saJson) return NextResponse.json({ error: 'GOOGLE_SERVICE_ACCOUNT_JSON not set' }, { status: 500 })

  let sa: { client_email: string; private_key: string }
  try { sa = JSON.parse(saJson) }
  catch { return NextResponse.json({ error: 'Invalid GOOGLE_SERVICE_ACCOUNT_JSON' }, { status: 500 }) }

  try {
    const token   = await getAccessToken(sa.client_email, sa.private_key, 'https://www.googleapis.com/auth/indexing')
    const results = await Promise.all(urlsToSubmit.map(url => submitUrl(token, url)))

    return NextResponse.json({
      total:     urlsToSubmit.length,
      submitted: results.filter(r => r.status === 'submitted').length,
      errors:    results.filter(r => r.status === 'error').length,
      results,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}

// ── GET — inspect a single URL ────────────────────────────────────────────────

export async function GET(request: Request) {
  if (!await isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const url      = searchParams.get('url')
  const property = searchParams.get('property')

  if (!url || !property) {
    return NextResponse.json({ error: 'Missing url or property param' }, { status: 400 })
  }

  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!saJson) return NextResponse.json({ error: 'GOOGLE_SERVICE_ACCOUNT_JSON not set' }, { status: 500 })

  let sa: { client_email: string; private_key: string }
  try { sa = JSON.parse(saJson) }
  catch { return NextResponse.json({ error: 'Invalid GOOGLE_SERVICE_ACCOUNT_JSON' }, { status: 500 }) }

  try {
    const token = await getAccessToken(
      sa.client_email,
      sa.private_key,
      'https://www.googleapis.com/auth/webmasters.readonly'
    )

    const res = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectionUrl: url, siteUrl: property }),
    })

    if (!res.ok) {
      const body = await res.text()
      return NextResponse.json({ error: `URL Inspection API error: ${body}` }, { status: 500 })
    }

    const data = await res.json() as {
      inspectionResult?: {
        indexStatusResult?: {
          verdict?:        string
          indexingState?:  string
          lastCrawlTime?:  string
          crawledAs?:      string
          robotsTxtState?: string
          coverageState?:  string
        }
      }
    }

    type IndexStatusResult = {
      verdict?:        string
      indexingState?:  string
      lastCrawlTime?:  string
      crawledAs?:      string
      robotsTxtState?: string
      coverageState?:  string
    }
    const result: IndexStatusResult = data.inspectionResult?.indexStatusResult ?? {}

    return NextResponse.json({
      url,
      verdict:        result.verdict        ?? 'UNKNOWN',
      indexingState:  result.indexingState  ?? 'UNKNOWN',
      lastCrawlTime:  result.lastCrawlTime  ?? null,
      crawledAs:      result.crawledAs      ?? null,
      coverageState:  result.coverageState  ?? null,
      robotsTxtState: result.robotsTxtState ?? null,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
