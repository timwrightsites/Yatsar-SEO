/**
 * Technical Bot — PageSpeed Insights audit.
 *
 * Picks up `strategy_tasks` of type='technical' and runs a Google PageSpeed
 * Insights audit against the client's `pagespeed_url`. Parses Core Web
 * Vitals + the top opportunities, writes a Markdown summary back to the
 * task notes, and creates an activity_logs entry so the dashboard timeline
 * shows what happened.
 *
 * Why PSI: it's free, requires no auth (rate-limited by IP), and gives us
 * the most concrete, immediately useful technical SEO signal we can ship
 * without an external integration. Adding GOOGLE_PAGESPEED_API_KEY to env
 * raises the rate limit but is optional.
 */

import type {
  BotExecutionResult,
  StandingOrder,
  StrategyTask,
  SupabaseClient,
} from './types'

const PSI_BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'

interface ClientRow {
  id:            string
  name:          string
  domain:        string
  pagespeed_url: string | null
}

export interface TechnicalBotInput {
  supabase:      SupabaseClient
  client:        ClientRow
  task:          StrategyTask
  standingOrder: StandingOrder
}

export async function runTechnicalBot({
  supabase, client, task,
}: TechnicalBotInput): Promise<BotExecutionResult> {
  const url = client.pagespeed_url || `https://${client.domain}`

  if (!url) {
    return {
      status: 'escalated',
      error:  'No pagespeed_url or domain configured for this client.',
    }
  }

  // Run mobile + desktop audits in parallel — both are cheap.
  let mobile: PsiResult
  let desktop: PsiResult
  try {
    [mobile, desktop] = await Promise.all([
      runPsi(url, 'mobile'),
      runPsi(url, 'desktop'),
    ])
  } catch (err) {
    return {
      status: 'failed',
      error:  err instanceof Error ? err.message : 'PageSpeed Insights request failed',
    }
  }

  const summary = formatSummary(url, mobile, desktop)

  // Persist the summary back onto the task so it shows up next to the task
  // wherever the dashboard renders strategy_tasks.notes / output_ref.
  try {
    await supabase
      .from('strategy_tasks')
      .update({
        notes:      summary,
        output_ref: 'technical-bot:psi',
        // 'needs_approval' is the natural resting state for a completed
        // audit — the human reviews the findings and decides next actions.
        status:     'needs_approval',
        updated_at: new Date().toISOString(),
      })
      .eq('id', task.id)
  } catch (err) {
    console.warn('[technical-bot] Failed to update strategy_task:', err)
  }

  // Activity log entry — drives the timeline strip on the client page.
  try {
    await supabase
      .from('activity_logs')
      .insert({
        client_id:  client.id,
        bot_type:   'technical',
        event_type: 'audit_completed',
        status:     'success',
        message:    `Technical Bot completed PageSpeed audit for ${url}`,
        metadata:   {
          task_id:       task.id,
          mobile_score:  mobile.performanceScore,
          desktop_score: desktop.performanceScore,
        },
      })
  } catch (err) {
    console.warn('[technical-bot] Failed to insert activity_log:', err)
  }

  return {
    status:  'succeeded',
    summary,
    output:  {
      url,
      mobile:  mobile.snapshot,
      desktop: desktop.snapshot,
    },
  }
}

// ── PageSpeed Insights call + parsing ────────────────────────────────────

interface PsiResult {
  performanceScore: number
  snapshot: {
    score:        number
    lcp_ms:       number | null
    cls:          number | null
    inp_ms:       number | null
    fcp_ms:       number | null
    tbt_ms:       number | null
    opportunities: { id: string; title: string; savings_ms: number }[]
  }
}

async function runPsi(url: string, strategy: 'mobile' | 'desktop'): Promise<PsiResult> {
  const params = new URLSearchParams({
    url,
    strategy,
    category: 'performance',
  })
  const apiKey = process.env.GOOGLE_PAGESPEED_API_KEY
  if (apiKey) params.set('key', apiKey)

  const res = await fetch(`${PSI_BASE}?${params.toString()}`, {
    // PSI can take 30+ seconds for cold pages
    signal: AbortSignal.timeout(60_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`PageSpeed Insights ${res.status}: ${body.slice(0, 200)}`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json()
  const lighthouse = data.lighthouseResult ?? {}
  const audits     = lighthouse.audits     ?? {}
  const categories = lighthouse.categories ?? {}

  const score = Math.round(((categories.performance?.score ?? 0) as number) * 100)

  const num = (auditId: string, field: 'numericValue' | 'displayValue' = 'numericValue') => {
    const v = audits[auditId]?.[field]
    return typeof v === 'number' ? Math.round(v) : null
  }

  // Top opportunities sorted by savings, top 5
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opportunities = Object.values(audits as Record<string, any>)
    .filter(a => a?.details?.type === 'opportunity' && (a.numericValue ?? 0) > 0)
    .sort((a, b) => (b.numericValue ?? 0) - (a.numericValue ?? 0))
    .slice(0, 5)
    .map(a => ({
      id:         String(a.id),
      title:      String(a.title ?? ''),
      savings_ms: Math.round(a.numericValue ?? 0),
    }))

  return {
    performanceScore: score,
    snapshot: {
      score,
      lcp_ms: num('largest-contentful-paint'),
      cls:    audits['cumulative-layout-shift']?.numericValue ?? null,
      inp_ms: num('interaction-to-next-paint') ?? num('experimental-interaction-to-next-paint'),
      fcp_ms: num('first-contentful-paint'),
      tbt_ms: num('total-blocking-time'),
      opportunities,
    },
  }
}

function formatSummary(url: string, mobile: PsiResult, desktop: PsiResult): string {
  const verdict = (s: number) =>
    s >= 90 ? '🟢 good' : s >= 50 ? '🟡 needs improvement' : '🔴 poor'

  const lines: string[] = []
  lines.push(`**PageSpeed audit for ${url}** (run ${new Date().toISOString().slice(0, 10)})`)
  lines.push('')
  lines.push(`- **Mobile performance:** ${mobile.performanceScore}/100 — ${verdict(mobile.performanceScore)}`)
  lines.push(`- **Desktop performance:** ${desktop.performanceScore}/100 — ${verdict(desktop.performanceScore)}`)
  lines.push('')
  lines.push('### Mobile Core Web Vitals')
  lines.push(`- LCP: ${fmtMs(mobile.snapshot.lcp_ms)}`)
  lines.push(`- CLS: ${fmtCls(mobile.snapshot.cls)}`)
  lines.push(`- INP: ${fmtMs(mobile.snapshot.inp_ms)}`)
  lines.push(`- FCP: ${fmtMs(mobile.snapshot.fcp_ms)}`)
  lines.push(`- TBT: ${fmtMs(mobile.snapshot.tbt_ms)}`)

  if (mobile.snapshot.opportunities.length) {
    lines.push('')
    lines.push('### Top mobile opportunities')
    mobile.snapshot.opportunities.forEach((o, i) => {
      lines.push(`${i + 1}. ${o.title} — save ~${(o.savings_ms / 1000).toFixed(1)}s`)
    })
  }

  return lines.join('\n')
}

function fmtMs(v: number | null): string {
  if (v == null) return 'n/a'
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`
}

function fmtCls(v: number | null): string {
  if (v == null) return 'n/a'
  return v.toFixed(3)
}
