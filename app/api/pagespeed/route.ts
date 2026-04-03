import { createClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

interface CoreWebVital {
  score: number | null
  displayValue?: string
}

interface PageSpeedResult {
  url: string
  strategy: 'mobile' | 'desktop'
  scores: {
    performance: number | null
    accessibility: number | null
    bestPractices: number | null
    seo: number | null
  }
  vitals: {
    lcp: CoreWebVital   // Largest Contentful Paint
    fid: CoreWebVital   // First Input Delay
    cls: CoreWebVital   // Cumulative Layout Shift
    fcp: CoreWebVital   // First Contentful Paint
    ttfb: CoreWebVital  // Time to First Byte
    tbt: CoreWebVital   // Total Blocking Time
  }
}

function extractScore(category: { score: number | null } | undefined): number | null {
  if (!category || category.score === null) return null
  return Math.round(category.score * 100)
}

function extractAudit(audits: Record<string, { score: number | null; displayValue?: string }>, id: string): CoreWebVital {
  const audit = audits[id]
  if (!audit) return { score: null }
  return {
    score: audit.score !== null ? Math.round(audit.score * 100) : null,
    displayValue: audit.displayValue,
  }
}

async function runPageSpeed(url: string, strategy: 'mobile' | 'desktop', apiKey: string): Promise<PageSpeedResult> {
  const params = new URLSearchParams({
    url,
    strategy,
    key: apiKey,
    category: 'performance',
    category2: 'accessibility',
    category3: 'best-practices',
    category4: 'seo',
  })

  const res = await fetch(
    `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`,
    { next: { revalidate: 3600 } } // cache for 1 hour
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`PageSpeed API error: ${err}`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as any
  const categories = data.lighthouseResult?.categories ?? {}
  const audits = data.lighthouseResult?.audits ?? {}

  return {
    url,
    strategy,
    scores: {
      performance: extractScore(categories.performance),
      accessibility: extractScore(categories.accessibility),
      bestPractices: extractScore(categories['best-practices']),
      seo: extractScore(categories.seo),
    },
    vitals: {
      lcp: extractAudit(audits, 'largest-contentful-paint'),
      fid: extractAudit(audits, 'max-potential-fid'),
      cls: extractAudit(audits, 'cumulative-layout-shift'),
      fcp: extractAudit(audits, 'first-contentful-paint'),
      ttfb: extractAudit(audits, 'server-response-time'),
      tbt: extractAudit(audits, 'total-blocking-time'),
    },
  }
}

export async function GET(request: Request) {
  // Verify Supabase session
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url')
  if (!url) {
    return NextResponse.json({ error: 'Missing url param' }, { status: 400 })
  }

  const apiKey = process.env.PAGESPEED_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'PAGESPEED_API_KEY env var not set' }, { status: 500 })
  }

  try {
    // Run mobile and desktop in parallel
    const [mobile, desktop] = await Promise.all([
      runPageSpeed(url, 'mobile', apiKey),
      runPageSpeed(url, 'desktop', apiKey),
    ])

    return NextResponse.json({ mobile, desktop })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
