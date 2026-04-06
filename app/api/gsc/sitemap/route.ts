import { createClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

// ── Auth check (same pattern as main GSC route) ───────────────────────────────

async function isAuthorized(request: Request): Promise<boolean> {
  const agentKey = request.headers.get('x-agent-key')
  if (agentKey && agentKey === process.env.OPENCLAW_GATEWAY_TOKEN) return true
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return !!user
}

// ── Sitemap parser ─────────────────────────────────────────────────────────────

function extractLocs(xml: string): string[] {
  const matches = xml.match(/<loc>(.*?)<\/loc>/g) ?? []
  return matches
    .map(m => m.replace(/<\/?loc>/g, '').trim())
    .filter(Boolean)
}

async function fetchSitemapUrls(domain: string): Promise<string[]> {
  const base = domain.startsWith('http') ? domain : `https://${domain}`

  // Try sitemap.xml first, then sitemap_index.xml
  const candidates = [
    `${base}/sitemap.xml`,
    `${base}/sitemap_index.xml`,
    `${base}/sitemap-index.xml`,
  ]

  let sitemapXml = ''
  let usedUrl = ''

  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Yatsar-SEO-Bot/1.0' }, signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        sitemapXml = await res.text()
        usedUrl = url
        break
      }
    } catch {
      continue
    }
  }

  if (!sitemapXml) return []

  // Check if it's a sitemap index (contains <sitemap> elements)
  const isSitemapIndex = sitemapXml.includes('<sitemapindex')

  if (isSitemapIndex) {
    // Extract child sitemap URLs
    const childSitemaps = extractLocs(sitemapXml).filter(u => u !== usedUrl)
    const allUrls: string[] = []

    // Fetch each child sitemap (limit to first 5 to avoid timeout)
    await Promise.all(childSitemaps.slice(0, 5).map(async (childUrl) => {
      try {
        const res = await fetch(childUrl, { headers: { 'User-Agent': 'Yatsar-SEO-Bot/1.0' }, signal: AbortSignal.timeout(8000) })
        if (res.ok) {
          const xml = await res.text()
          allUrls.push(...extractLocs(xml))
        }
      } catch { /* skip failed child sitemaps */ }
    }))

    return [...new Set(allUrls)]
  }

  return extractLocs(sitemapXml)
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  if (!await isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const domain = searchParams.get('domain')
  if (!domain) return NextResponse.json({ error: 'Missing domain param' }, { status: 400 })

  try {
    const urls = await fetchSitemapUrls(domain)
    return NextResponse.json({
      domain,
      count: urls.length,
      urls,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
