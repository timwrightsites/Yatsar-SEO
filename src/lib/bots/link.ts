/**
 * Link Bot — link-gap analysis + outreach email drafting.
 *
 * Pipeline:
 *   1. Pull the client's top 5 organic competitors from Ahrefs (cached).
 *   2. Pull the referring-domains list for the client AND each competitor
 *      (also cached, weekly bucket — so a fresh task in week N costs 6
 *      Ahrefs calls and every other link task that week costs 0).
 *   3. Compute the link gap: domains that link to ≥2 competitors but NOT
 *      to the client. Score them by `domain_rating + log(competitor_count) * 10`
 *      and take the top 15.
 *   4. Upsert into `link_prospects` (deduped on client_id + domain).
 *   5. For each prospect, ask OpenClaw to draft a personalized cold-outreach
 *      email — short, specific, no generic flattery. Save to `outreach_drafts`
 *      as `pending_review`.
 *   6. Update the strategy_task to `needs_approval`, write a summary into
 *      notes, log activity.
 *
 * Failure modes:
 *   - Missing AHREFS_API_KEY → escalated (this bot is useless without Ahrefs)
 *   - Missing OpenClaw env   → still succeeds with prospects only; drafts skipped
 *   - Ahrefs gap is empty    → succeeds with summary "no gap found"
 *   - All-fail              → failed
 */

import {
  fetchCompetitors,
  fetchReferringDomains,
  AhrefsKeyMissingError,
} from '../ahrefs'
import type {
  BotExecutionResult,
  StandingOrder,
  StrategyTask,
  SupabaseClient,
} from './types'

const GATEWAY_URL      = process.env.OPENCLAW_GATEWAY_URL
const GATEWAY_TOKEN    = process.env.OPENCLAW_GATEWAY_TOKEN
const LINK_AGENT_ID    = process.env.LINK_BOT_AGENT_ID || 'seo-co-strategist'
const MAX_PROSPECTS    = 15
const MAX_COMPETITORS  = 5
const MIN_OVERLAP      = 2   // a domain must link to ≥2 competitors to count
const REFDOMAINS_LIMIT = 25  // Ahrefs Standard plan caps at 25/row

interface ClientRow {
  id:            string
  name:          string
  domain:        string
  pagespeed_url: string | null
  industry?:     string | null
}

export interface LinkBotInput {
  supabase:      SupabaseClient
  client:        ClientRow
  task:          StrategyTask
  standingOrder: StandingOrder
}

interface RefDomainRow {
  domain:                   string
  domain_rating:            number | null
  traffic_domain:           number | null
  dofollow_links_to_target: number | null
  links_to_target:          number | null
}

interface ScoredProspect {
  domain:                string
  domain_rating:         number
  domain_traffic:        number
  competitors_linking:   string[]
  competitor_link_count: number
  prospect_score:        number
  why:                   string
}

interface DraftedOutreach {
  subject: string
  body:    string
}

export async function runLinkBot({
  supabase, client, task, standingOrder,
}: LinkBotInput): Promise<BotExecutionResult> {
  // ── 1. Pull competitors ──────────────────────────────────────────────
  let competitorDomains: string[]
  try {
    const compRaw = await fetchCompetitors({
      supabase, clientId: client.id, target: client.domain, limit: MAX_COMPETITORS,
    })
    competitorDomains = extractCompetitorDomains(compRaw).slice(0, MAX_COMPETITORS)
  } catch (err) {
    if (err instanceof AhrefsKeyMissingError) {
      return { status: 'escalated', error: 'AHREFS_API_KEY not configured. Link Bot needs Ahrefs to run.' }
    }
    return { status: 'failed', error: err instanceof Error ? err.message : 'Failed to fetch competitors' }
  }

  if (competitorDomains.length === 0) {
    return {
      status:  'escalated',
      error:   'No competitors returned from Ahrefs. Cannot compute link gap. Configure manual competitors or check the domain.',
    }
  }

  // ── 2. Pull refdomains for client + competitors in parallel ──────────
  let clientRefdomains: RefDomainRow[]
  let competitorRefdomains: { competitor: string; rows: RefDomainRow[] }[]
  try {
    const [clientRaw, ...compRaws] = await Promise.all([
      fetchReferringDomains({
        supabase, clientId: client.id, target: client.domain, limit: REFDOMAINS_LIMIT,
      }),
      ...competitorDomains.map(comp =>
        fetchReferringDomains({
          supabase, clientId: client.id, target: comp, limit: REFDOMAINS_LIMIT,
        }),
      ),
    ])
    clientRefdomains      = extractRefdomains(clientRaw)
    competitorRefdomains  = compRaws.map((raw, i) => ({
      competitor: competitorDomains[i],
      rows:       extractRefdomains(raw),
    }))
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : 'Failed to fetch refdomains' }
  }

  // ── 3. Compute link gap ──────────────────────────────────────────────
  const clientLinkers = new Set(clientRefdomains.map(r => normalizeDomain(r.domain)))

  // Map of normalized prospect domain → aggregate
  const prospects = new Map<string, ScoredProspect>()

  for (const { competitor, rows } of competitorRefdomains) {
    for (const row of rows) {
      const dom = normalizeDomain(row.domain)
      if (!dom || dom === normalizeDomain(client.domain)) continue
      if (clientLinkers.has(dom)) continue   // already links to us — not a gap

      const existing = prospects.get(dom)
      if (existing) {
        if (!existing.competitors_linking.includes(competitor)) {
          existing.competitors_linking.push(competitor)
          existing.competitor_link_count = existing.competitors_linking.length
        }
        // Take the highest DR / traffic we've seen for this domain
        if ((row.domain_rating ?? 0) > existing.domain_rating) {
          existing.domain_rating = row.domain_rating ?? 0
        }
        if ((row.traffic_domain ?? 0) > existing.domain_traffic) {
          existing.domain_traffic = row.traffic_domain ?? 0
        }
      } else {
        prospects.set(dom, {
          domain:                dom,
          domain_rating:         row.domain_rating ?? 0,
          domain_traffic:        row.traffic_domain ?? 0,
          competitors_linking:   [competitor],
          competitor_link_count: 1,
          prospect_score:        0,
          why:                   '',
        })
      }
    }
  }

  // Filter by overlap, score, sort, take top N
  const scored = Array.from(prospects.values())
    .filter(p => p.competitor_link_count >= MIN_OVERLAP)
    .map(p => {
      // Score: DR (0-100) + log(N) * 10. A domain linking to 4 competitors
      // with DR 70 scores 70 + log(4)*10 ≈ 84. A DR-30 single-competitor
      // domain scores 30 + 0 = 30. DR matters more than overlap, but overlap
      // breaks ties.
      p.prospect_score = p.domain_rating + Math.log(p.competitor_link_count) * 10
      p.why = `Links to ${p.competitor_link_count}/${competitorDomains.length} competitors (${p.competitors_linking.slice(0, 3).join(', ')}${p.competitors_linking.length > 3 ? '…' : ''}). DR ${p.domain_rating}.`
      return p
    })
    .sort((a, b) => b.prospect_score - a.prospect_score)
    .slice(0, MAX_PROSPECTS)

  if (scored.length === 0) {
    // Update task with a clean "nothing found" summary and return
    const summary =
      `**Link Bot ran but found no qualifying prospects.**\n\n` +
      `Checked ${competitorDomains.length} competitors against ${clientRefdomains.length} of the client's existing referring domains. ` +
      `No domains linked to ≥${MIN_OVERLAP} competitors without already linking to the client.\n\n` +
      `Try: increasing the refdomains sample size, adding manual competitors, or running the Content Bot first to build linkable assets.`

    await markTaskNeedsApproval(supabase, task.id, summary, 'link-bot:no-gap')
    await logActivity(supabase, client.id, 'link', 'gap_analysis_complete', summary, {
      task_id:    task.id,
      prospects:  0,
      competitors: competitorDomains.length,
    })
    return { status: 'succeeded', summary, output: { prospects: 0 } }
  }

  // ── 4. Upsert prospects ──────────────────────────────────────────────
  const insertedProspects: { id: string; domain: string }[] = []
  for (const p of scored) {
    try {
      const { data, error } = await supabase
        .from('link_prospects')
        .upsert({
          client_id:             client.id,
          task_id:               task.id,
          domain:                p.domain,
          domain_rating:         p.domain_rating || null,
          domain_traffic:        p.domain_traffic || null,
          competitors_linking:   p.competitors_linking,
          competitor_link_count: p.competitor_link_count,
          prospect_score:        p.prospect_score,
          why:                   p.why,
          updated_at:            new Date().toISOString(),
        }, { onConflict: 'client_id,domain' })
        .select('id, domain')
        .single() as { data: { id: string; domain: string } | null; error: { message: string } | null }

      if (error) {
        console.warn(`[link-bot] Failed to upsert prospect ${p.domain}:`, error.message)
        continue
      }
      if (data) insertedProspects.push(data)
    } catch (err) {
      console.warn(`[link-bot] Unexpected upsert error for ${p.domain}:`, err)
    }
  }

  // ── 5. Draft outreach for each prospect (in parallel, capped) ────────
  let draftCount = 0
  if (GATEWAY_URL && GATEWAY_TOKEN) {
    const drafts = await Promise.allSettled(
      insertedProspects.map(p => {
        const scoredP = scored.find(s => s.domain === p.domain)!
        return draftOutreach(client, task, scoredP).then(draft => ({ p, scoredP, draft }))
      }),
    )

    for (const result of drafts) {
      if (result.status !== 'fulfilled' || !result.value.draft) continue
      const { p, draft } = result.value
      try {
        await supabase
          .from('outreach_drafts')
          .insert({
            client_id:   client.id,
            prospect_id: p.id,
            task_id:     task.id,
            subject:     draft.subject,
            body:        draft.body,
            tone:        'direct',
            status:      'pending_review',
            agent_id:    LINK_AGENT_ID,
            agent_notes: `Drafted for prospect ${p.domain}`,
          })
        draftCount++
      } catch (err) {
        console.warn(`[link-bot] Failed to insert outreach_draft for ${p.domain}:`, err)
      }
    }
  } else {
    console.warn('[link-bot] OpenClaw env missing — skipping email drafting, prospects only.')
  }

  // ── 6. Update task + activity log ────────────────────────────────────
  const summary = formatSummary(scored, draftCount, competitorDomains.length)
  await markTaskNeedsApproval(supabase, task.id, summary, 'link-bot:prospects')
  await logActivity(supabase, client.id, 'link', 'prospects_generated', summary, {
    task_id:     task.id,
    prospects:   insertedProspects.length,
    drafts:      draftCount,
    competitors: competitorDomains.length,
  })

  return {
    status:  'succeeded',
    summary,
    output:  {
      prospects:   insertedProspects.length,
      drafts:      draftCount,
      competitors: competitorDomains.length,
    },
  }
}

// ── OpenClaw outreach drafter ───────────────────────────────────────────

async function draftOutreach(
  client:  ClientRow,
  task:    StrategyTask,
  prospect: ScoredProspect,
): Promise<DraftedOutreach | null> {
  const systemPrompt =
    `You are a senior outreach strategist for an SEO agency. ` +
    `You write short, specific cold pitches that get replies — never generic ` +
    `flattery, never "I love your blog!", never multi-paragraph essays. ` +
    `\n\n` +
    `Output format — respond with EXACTLY this structure, no preamble:\n` +
    `\n` +
    `SUBJECT: <subject line, 6-9 words, no clickbait>\n` +
    `---\n` +
    `<email body, 90-130 words, plain text, two short paragraphs max, ` +
    `signed "— ${client.name} team">\n` +
    `\n` +
    `Rules:\n` +
    `- Open with one specific reason you noticed them (the gap data below).\n` +
    `- Make a concrete offer (resource, data, guest contribution).\n` +
    `- One soft CTA. No "circle back" language.\n` +
    `- Never invent stats. Use only the facts provided.`

  const userPrompt =
    `Client: ${client.name} (${client.domain})\n` +
    (client.industry ? `Industry: ${client.industry}\n` : '') +
    `Task context: ${task.title}\n` +
    (task.description ? `Task notes: ${task.description}\n` : '') +
    `\n` +
    `Prospect: ${prospect.domain}\n` +
    `Why this prospect: ${prospect.why}\n` +
    `Domain rating: ${prospect.domain_rating}\n` +
    `\n` +
    `Draft the pitch.`

  try {
    const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GATEWAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: `openclaw/${LINK_AGENT_ID}`,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(45_000),
    })

    if (!res.ok) {
      console.warn(`[link-bot] OpenClaw ${res.status} for ${prospect.domain}`)
      return null
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json()
    const raw: string = data?.choices?.[0]?.message?.content ?? ''
    if (!raw || raw.length < 30) return null

    const sepIdx = raw.indexOf('\n---')
    const head   = sepIdx >= 0 ? raw.slice(0, sepIdx) : ''
    const body   = sepIdx >= 0 ? raw.slice(sepIdx + 4).trim() : raw.trim()
    const subjectMatch = head.match(/SUBJECT:\s*(.+)/i)
    const subject = subjectMatch?.[1]?.trim() ?? `Quick note from ${client.name}`

    return { subject, body }
  } catch (err) {
    console.warn(`[link-bot] Draft failed for ${prospect.domain}:`, err)
    return null
  }
}

// ── Ahrefs response shape extractors ────────────────────────────────────

function extractCompetitorDomains(raw: unknown): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any
  const arr =
    r?.organic_competitors ??
    r?.competitors ??
    r?.data ??
    (Array.isArray(r) ? r : [])
  if (!Array.isArray(arr)) return []
  return arr
    .map(c => c?.competitor_domain ?? c?.domain ?? c?.url)
    .filter((d: unknown): d is string => typeof d === 'string' && d.length > 0)
    .map(normalizeDomain)
}

function extractRefdomains(raw: unknown): RefDomainRow[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any
  const arr =
    r?.refdomains ??
    r?.referring_domains ??
    r?.data ??
    (Array.isArray(r) ? r : [])
  if (!Array.isArray(arr)) return []
  return arr
    .filter((row: unknown) => row && typeof row === 'object')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((row: any) => ({
      domain:                   String(row.domain ?? ''),
      domain_rating:            typeof row.domain_rating === 'number' ? row.domain_rating : null,
      traffic_domain:           typeof row.traffic_domain === 'number' ? row.traffic_domain : null,
      dofollow_links_to_target: typeof row.dofollow_links_to_target === 'number' ? row.dofollow_links_to_target : null,
      links_to_target:          typeof row.links_to_target === 'number' ? row.links_to_target : null,
    }))
    .filter((r: RefDomainRow) => r.domain.length > 0)
}

function normalizeDomain(d: string): string {
  return d
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
    .trim()
}

// ── Persistence helpers ─────────────────────────────────────────────────

async function markTaskNeedsApproval(
  supabase: SupabaseClient,
  taskId:   string,
  notes:    string,
  outputRef: string,
) {
  try {
    await supabase
      .from('strategy_tasks')
      .update({
        notes,
        output_ref: outputRef,
        status:     'needs_approval',
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId)
  } catch (err) {
    console.warn('[link-bot] Failed to update strategy_task:', err)
  }
}

async function logActivity(
  supabase:  SupabaseClient,
  clientId:  string,
  botType:   string,
  eventType: string,
  message:   string,
  metadata:  Record<string, unknown>,
) {
  try {
    await supabase
      .from('activity_logs')
      .insert({
        client_id:  clientId,
        bot_type:   botType,
        event_type: eventType,
        status:     'success',
        message,
        metadata,
      })
  } catch (err) {
    console.warn('[link-bot] Failed to insert activity_log:', err)
  }
}

function formatSummary(
  scored:           ScoredProspect[],
  draftCount:       number,
  competitorCount:  number,
): string {
  const lines: string[] = []
  lines.push(`**Link Bot found ${scored.length} prospects across ${competitorCount} competitors.**`)
  lines.push('')
  if (draftCount > 0) {
    lines.push(`Drafted ${draftCount} outreach email${draftCount === 1 ? '' : 's'} (status: pending_review).`)
  } else {
    lines.push(`No outreach emails drafted (OpenClaw unavailable). Prospects saved.`)
  }
  lines.push('')
  lines.push(`**Top 5 prospects:**`)
  for (const p of scored.slice(0, 5)) {
    lines.push(`- \`${p.domain}\` — DR ${p.domain_rating}, links to ${p.competitor_link_count} competitors (score ${p.prospect_score.toFixed(1)})`)
  }
  lines.push('')
  lines.push(`Open the **Link Prospects** view to review and approve outreach.`)
  return lines.join('\n')
}
