import { createClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import {
  fetchOverview,
  fetchOrganicKeywords,
  fetchTopPages,
  AhrefsKeyMissingError,
} from '@/lib/ahrefs'

export const runtime = 'nodejs'
export const maxDuration = 60

interface Props { params: Promise<{ id: string }> }

export async function POST(_req: Request, { params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  // ── 1. Load the competitor record ─────────────────────────────
  const { data: comp, error: compErr } = await db
    .from('competitors')
    .select('*, clients(name, domain)')
    .eq('id', id)
    .single()

  if (compErr || !comp) {
    return NextResponse.json({ error: 'Competitor not found' }, { status: 404 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  // ── 2. Pull Ahrefs data for competitor domain ─────────────────
  let ahrefsData: Record<string, unknown> = {}
  try {
    const [overview, keywords, pages] = await Promise.all([
      fetchOverview({ supabase, clientId: comp.client_id, target: comp.domain, forceFresh: false }),
      fetchOrganicKeywords({ supabase, clientId: comp.client_id, target: comp.domain, limit: 25, forceFresh: false }),
      fetchTopPages({ supabase, clientId: comp.client_id, target: comp.domain, limit: 25, forceFresh: false }),
    ])

    ahrefsData = {
      overview: overview ?? null,
      top_keywords: keywords ?? [],
      top_pages: pages ?? [],
    }
  } catch (err) {
    if (err instanceof AhrefsKeyMissingError) {
      ahrefsData = { error: 'No Ahrefs API key — analysis based on domain only' }
    } else {
      ahrefsData = { error: `Ahrefs fetch failed: ${(err as Error).message}` }
    }
  }

  // ── 3. Also pull the CLIENT's overview for comparison ─────────
  let clientOverview: unknown = null
  if (comp.clients?.domain) {
    try {
      clientOverview = await fetchOverview({
        supabase, clientId: comp.client_id, target: comp.clients.domain, forceFresh: false,
      })
    } catch { /* ok */ }
  }

  // ── 4. Build the prompt ───────────────────────────────────────
  const prompt = `You are an SEO strategist. Analyze this competitor and produce a brief, actionable summary.

## Your Client
- Name: ${comp.clients?.name ?? 'Unknown'}
- Domain: ${comp.clients?.domain ?? 'Unknown'}
${clientOverview ? `- Client Ahrefs overview: ${JSON.stringify(clientOverview, null, 2)}` : ''}

## Competitor
- Domain: ${comp.domain}
${comp.notes ? `- Notes: ${comp.notes}` : ''}

## Competitor Ahrefs Data
${JSON.stringify(ahrefsData, null, 2)}

## Instructions
Write a competitor analysis summary in HTML format (use <h3>, <p>, <ul>, <li>, <strong>, <em> tags — no <html>/<body>/<head>).

Structure it as:
1. **Overview** — Who are they, what's their domain authority / traffic level vs the client?
2. **Keyword Strategy** — What are they ranking for? Any gaps the client could target?
3. **Top Content** — What pages drive their traffic? What formats do they use?
4. **Strengths** — What are they doing well?
5. **Weaknesses & Opportunities** — Where can the client beat them?
6. **Recommended Actions** — 3-5 specific things the client should do based on this analysis.

Keep it concise but insightful. Use real data from the Ahrefs numbers where available. Write for a non-technical agency owner.`

  // ── 5. Call Claude ────────────────────────────────────────────
  const anthropic = new Anthropic({ apiKey })

  let summaryHtml: string
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    })

    summaryHtml = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
  } catch (err) {
    return NextResponse.json({
      error: `Claude API error: ${(err as Error).message}`,
    }, { status: 502 })
  }

  // ── 6. Save to Supabase ───────────────────────────────────────
  const { data: updated, error: updateErr } = await db
    .from('competitors')
    .update({
      summary_html: summaryHtml,
      summary_generated_at: new Date().toISOString(),
      ahrefs_data: ahrefsData,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json(updated)
}
