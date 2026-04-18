/**
 * Link Bot — two execution modes:
 *
 * 1. **Strategist-driven mode** (preferred for early-stage clients)
 *    Triggered when the strategist includes a `link_targets` array in the
 *    task metadata. The strategist hand-picks 10-15 plausible targets based
 *    on industry knowledge — niche blogs, trade associations, podcasts,
 *    local directories, complementary services, guest post opportunities.
 *    Each target has a `domain` and an `angle` (the pitch reason). The bot
 *    upserts them as `link_prospects` with `source='strategist'`, optionally
 *    enriches with Ahrefs DR as a sanity check, and fans out OpenClaw calls
 *    to draft personalized outreach using the angle as context. No Ahrefs
 *    gap analysis is required — the bot will still run if Ahrefs is missing.
 *
 * 2. **Ahrefs gap-analysis mode** (the default when no link_targets given)
 *    a. Pull the client's top 5 organic competitors from Ahrefs (cached).
 *    b. Pull the referring-domains list for the client AND each competitor
 *       (also cached, weekly bucket — so a fresh task in week N costs 6
 *       Ahrefs calls and every other link task that week costs 0).
 *    c. Compute the link gap: domains that link to ≥2 competitors but NOT
 *       to the client. Score by `DR + log(competitor_count)*10`, take top 15.
 *    d. Upsert into `link_prospects` with `source='gap_analysis'`.
 *    e. Draft outreach via OpenClaw; save to `outreach_threads` with
 *       status='pending_review' so it enters the human review queue.
 *    This mode requires a client with meaningful backlink data (~DR 15+,
 *    20+ referring domains). Escalates otherwise.
 *
 * Both modes end the same way: update the strategy_task to `needs_approval`,
 * write a summary into notes, log activity.
 *
 * Failure modes:
 *   - Missing AHREFS_API_KEY  → gap mode escalates; strategist mode still runs
 *   - Missing OpenClaw env    → prospects saved; outreach drafting skipped
 *   - Empty gap               → succeeds with "no gap found" summary
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
const LINK_AGENT_ID    = process.env.LINK_BOT_AGENT_ID || 'link-agent'
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

interface StrategistLinkTarget {
  domain: string
  angle?: string
}

export async function runLinkBot(input: LinkBotInput): Promise<BotExecutionResult> {
  // ── Mode switch ──────────────────────────────────────────────────────
  // If the strategist hand-picked targets at task creation time, use
  // strategist-driven mode and skip Ahrefs gap analysis entirely. This
  // lets the Link Bot produce value for early-stage clients that don't
  // yet have enough backlink data for a meaningful gap analysis.
  const targets = extractStrategistTargets(input.task.metadata)
  if (targets.length > 0) {
    console.log(`[link-bot] Strategist mode: ${targets.length} hand-picked targets`)
    return runLinkBotFromTargets(input, targets)
  }
  return runLinkBotGapAnalysis(input)
}

/**
 * Read task.metadata.link_targets safely and normalize into a clean list.
 * Tolerates missing metadata, non-array values, and malformed entries.
 */
function extractStrategistTargets(
  metadata: Record<string, unknown> | null | undefined,
): StrategistLinkTarget[] {
  if (!metadata || typeof metadata !== 'object') return []
  const raw = (metadata as { link_targets?: unknown }).link_targets
  if (!Array.isArray(raw)) return []
  const out: StrategistLinkTarget[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as { domain?: unknown; angle?: unknown }
    const domain = typeof row.domain === 'string' ? normalizeDomain(row.domain) : ''
    if (!domain) continue
    out.push({
      domain,
      angle: typeof row.angle === 'string' ? row.angle : undefined,
    })
  }
  return out
}

async function runLinkBotGapAnalysis({
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
          source:                'gap_analysis',
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
        // Writes land in outreach_threads (the gated table), NOT the legacy
        // outreach_drafts table. Threads are addressed via issue_id so the
        // Issues tab can pull them into the right thread. to_email /
        // from_email start null — the outreach reviewer fills them at
        // approval time.
        await supabase
          .from('outreach_threads')
          .insert({
            client_id:               client.id,
            prospect_id:             p.id,
            subject:                 draft.subject,
            body_md:                 draft.body,
            status:                  'pending_review',
            submitted_for_review_at: new Date().toISOString(),
            issue_id:                typeof task.metadata?.issue_id === 'string' ? task.metadata.issue_id : null,
            reviewer_notes:          `Drafted by ${LINK_AGENT_ID} for prospect ${p.domain}`,
          })
        draftCount++
      } catch (err) {
        console.warn(`[link-bot] Failed to insert outreach_thread for ${p.domain}:`, err)
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

// ── Strategist-driven mode ──────────────────────────────────────────────
// When the strategist provides `link_targets` in task.metadata, we skip
// the whole Ahrefs gap-analysis pipeline and work directly off that list.
// This is the primary mode for early-stage clients who don't have enough
// backlink data for a meaningful competitor gap analysis.
async function runLinkBotFromTargets(
  { supabase, client, task }: LinkBotInput,
  targets: StrategistLinkTarget[],
): Promise<BotExecutionResult> {
  // De-dupe on normalized domain — guard against strategist repeating themselves
  const deduped: StrategistLinkTarget[] = []
  const seen = new Set<string>()
  for (const t of targets) {
    if (seen.has(t.domain)) continue
    seen.add(t.domain)
    deduped.push(t)
  }

  // Optional Ahrefs enrichment: pull DR for each target as a sanity check.
  // Best-effort — if Ahrefs is missing or fails, we proceed with null DR
  // rather than failing the whole run.
  const enrichment = await enrichTargetsWithAhrefs(supabase, client.id, deduped)

  // ── Upsert prospects with source='strategist' ────────────────────────
  const insertedProspects: { id: string; domain: string; angle: string | undefined; domain_rating: number | null }[] = []
  for (const target of deduped) {
    const dr = enrichment[target.domain] ?? null
    const why = target.angle
      ? target.angle
      : `Hand-picked by strategist.`
    try {
      const { data, error } = await supabase
        .from('link_prospects')
        .upsert({
          client_id:             client.id,
          task_id:               task.id,
          domain:                target.domain,
          domain_rating:         dr,
          domain_traffic:        null,
          competitors_linking:   [],
          competitor_link_count: 0,
          // Prospect score is DR when present, otherwise a neutral 50 so
          // strategist-picked rows still sort above obvious junk.
          prospect_score:        dr ?? 50,
          why,
          source:                'strategist',
          updated_at:            new Date().toISOString(),
        }, { onConflict: 'client_id,domain' })
        .select('id, domain')
        .single() as { data: { id: string; domain: string } | null; error: { message: string } | null }

      if (error) {
        console.warn(`[link-bot] Failed to upsert strategist prospect ${target.domain}:`, error.message)
        continue
      }
      if (data) {
        insertedProspects.push({
          id:            data.id,
          domain:        data.domain,
          angle:         target.angle,
          domain_rating: dr,
        })
      }
    } catch (err) {
      console.warn(`[link-bot] Unexpected upsert error for ${target.domain}:`, err)
    }
  }

  // ── Fan out OpenClaw outreach drafts using the strategist's angle ────
  let draftCount = 0
  if (GATEWAY_URL && GATEWAY_TOKEN) {
    const drafts = await Promise.allSettled(
      insertedProspects.map(p =>
        draftOutreachFromAngle(client, task, p.domain, p.angle, p.domain_rating)
          .then(draft => ({ p, draft })),
      ),
    )
    for (const result of drafts) {
      if (result.status !== 'fulfilled' || !result.value.draft) continue
      const { p, draft } = result.value
      try {
        // Strategist-mode writes also land in the gated outreach_threads
        // table. The strategist's angle is captured in reviewer_notes so
        // the approver sees the original pitch reason at review time.
        await supabase
          .from('outreach_threads')
          .insert({
            client_id:               client.id,
            prospect_id:             p.id,
            subject:                 draft.subject,
            body_md:                 draft.body,
            status:                  'pending_review',
            submitted_for_review_at: new Date().toISOString(),
            issue_id:                typeof task.metadata?.issue_id === 'string' ? task.metadata.issue_id : null,
            reviewer_notes:          `Strategist-picked target: ${p.domain}. Angle: ${p.angle ?? 'n/a'}`,
          })
        draftCount++
      } catch (err) {
        console.warn(`[link-bot] Failed to insert strategist outreach_thread for ${p.domain}:`, err)
      }
    }
  } else {
    console.warn('[link-bot] OpenClaw env missing — skipping email drafting, strategist prospects only.')
  }

  // ── Summary + task update ────────────────────────────────────────────
  const summary = formatStrategistSummary(deduped, insertedProspects.length, draftCount, enrichment)
  await markTaskNeedsApproval(supabase, task.id, summary, 'link-bot:strategist')
  await logActivity(supabase, client.id, 'link', 'prospects_generated', summary, {
    task_id:   task.id,
    mode:      'strategist',
    prospects: insertedProspects.length,
    drafts:    draftCount,
    targets:   deduped.length,
  })

  return {
    status:  'succeeded',
    summary,
    output:  {
      mode:      'strategist',
      prospects: insertedProspects.length,
      drafts:    draftCount,
      targets:   deduped.length,
    },
  }
}

/**
 * Best-effort DR enrichment for strategist-picked targets. Uses the same
 * cached `fetchReferringDomains` pathway as gap mode, but here we're calling
 * it on the TARGET's own domain just to grab its DR from the first row the
 * refdomains response contains. Any error for any target is silently swallowed
 * — strategist mode should still function without Ahrefs.
 *
 * NOTE: We're not using a dedicated "domain overview" Ahrefs endpoint here
 * to avoid adding another call path. This uses whatever the existing ahrefs
 * helpers already support. If AHREFS_API_KEY is missing, every call throws
 * AhrefsKeyMissingError and we return an empty enrichment map.
 */
async function enrichTargetsWithAhrefs(
  supabase: SupabaseClient,
  clientId: string,
  targets:  StrategistLinkTarget[],
): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {}
  if (targets.length === 0) return out
  try {
    // Probe Ahrefs with the first target. If it throws AhrefsKeyMissingError,
    // we short-circuit the whole enrichment (no point hammering a missing key).
    await fetchReferringDomains({
      supabase, clientId, target: targets[0].domain, limit: 1,
    })
  } catch (err) {
    if (err instanceof AhrefsKeyMissingError) {
      console.log('[link-bot] Strategist mode: Ahrefs key missing, skipping DR enrichment')
      return out
    }
    // Other errors we'll catch per-target below
  }

  const enriched = await Promise.allSettled(
    targets.map(async t => {
      const raw = await fetchReferringDomains({
        supabase, clientId, target: t.domain, limit: 1,
      })
      const rows = extractRefdomains(raw)
      const dr = rows[0]?.domain_rating ?? null
      return { domain: t.domain, dr }
    }),
  )
  for (const r of enriched) {
    if (r.status === 'fulfilled') {
      out[r.value.domain] = r.value.dr
    }
  }
  return out
}

function formatStrategistSummary(
  targets:     StrategistLinkTarget[],
  upserted:    number,
  draftCount:  number,
  enrichment:  Record<string, number | null>,
): string {
  const lines: string[] = []
  lines.push(`**Link Bot (strategist mode) processed ${upserted} hand-picked target${upserted === 1 ? '' : 's'}.**`)
  lines.push('')
  const hasDR = Object.values(enrichment).some(v => v !== null && v !== undefined)
  if (hasDR) {
    lines.push(`Enriched with Ahrefs DR where available.`)
  } else {
    lines.push(`Ahrefs enrichment unavailable — prospects saved with strategist-provided angles only.`)
  }
  if (draftCount > 0) {
    lines.push(`Drafted ${draftCount} personalized outreach email${draftCount === 1 ? '' : 's'} (status: pending_review).`)
  } else {
    lines.push(`No outreach emails drafted (OpenClaw unavailable). Prospects saved.`)
  }
  lines.push('')
  lines.push(`**Targets:**`)
  for (const t of targets.slice(0, 15)) {
    const dr = enrichment[t.domain]
    const drStr = dr !== null && dr !== undefined ? ` — DR ${dr}` : ''
    const angleStr = t.angle ? ` — ${t.angle}` : ''
    lines.push(`- \`${t.domain}\`${drStr}${angleStr}`)
  }
  lines.push('')
  lines.push(`Open the **Link Prospects** view to review and approve outreach.`)
  return lines.join('\n')
}

/**
 * Variant of draftOutreach that uses the strategist's angle as primary
 * context instead of gap-analysis data. Keeps the same output format so
 * the parser below is shared.
 */
async function draftOutreachFromAngle(
  client:        ClientRow,
  task:          StrategyTask,
  domain:        string,
  angle:         string | undefined,
  domainRating:  number | null,
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
    `- Open with a specific, honest reason you're reaching out (the angle below).\n` +
    `- Make a concrete offer (resource, data, guest contribution, collaboration).\n` +
    `- One soft CTA. No "circle back" language.\n` +
    `- Never invent stats. Use only the facts provided.`

  const userPrompt =
    `Client: ${client.name} (${client.domain})\n` +
    (client.industry ? `Industry: ${client.industry}\n` : '') +
    `Task context: ${task.title}\n` +
    (task.description ? `Task notes: ${task.description}\n` : '') +
    `\n` +
    `Prospect: ${domain}\n` +
    `Strategist's angle (use this as the pitch reason): ${angle ?? 'Hand-picked by strategist — craft a generic but relevant opener for this vertical.'}\n` +
    (domainRating !== null ? `Ahrefs DR: ${domainRating}\n` : '') +
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
      console.warn(`[link-bot] OpenClaw ${res.status} for ${domain}`)
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
    console.warn(`[link-bot] Draft failed for ${domain}:`, err)
    return null
  }
}

// ── OpenClaw outreach drafter (gap-analysis mode) ───────────────────────

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
