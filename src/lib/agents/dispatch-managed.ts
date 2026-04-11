/**
 * Managed Agents dispatcher.
 *
 * Replaces the OpenClaw gateway bridge (`dispatch-gateway.ts`) with
 * Anthropic's Managed Agents API (beta). Instead of POSTing to
 * /v1/chat/completions, we:
 *   1. Create a session on the managed agent
 *   2. Send the brief as a user message
 *   3. Return the session ID so the UI can stream events via SSE
 *
 * The agent runs autonomously in Anthropic's infrastructure, using the
 * tools and environment configured in console.claude.com. It writes
 * back to Supabase via bash/curl (as documented in each agent's system
 * prompt) — same contract as the OpenClaw gateway agents.
 *
 * API reference (beta):
 *   POST /v1/sessions                — create session on an agent
 *   POST /v1/sessions/{id}/events    — send user message
 *   GET  /v1/sessions/{id}/stream    — SSE stream of agent events
 *   Header: anthropic-beta: managed-agents-2026-04-01
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  BotRunRecord,
  BotType,
  StandingOrder,
  StrategyTask,
  SupabaseClient,
  TriggerSource,
} from '../bots/types'

// ── Agent ID mapping ─────────────────────────────────────────────────────
// These are the Managed Agent IDs from console.claude.com.
// Override per bot_type via env vars (e.g. MANAGED_AGENT_ID_ANALYTICS=xxx).
// Placeholder defaults match the naming convention from the prompts doc.
const MANAGED_AGENT_IDS: Record<string, string> = {
  analytics: process.env.MANAGED_AGENT_ID_ANALYTICS || 'analytics-agent',
  audit:     process.env.MANAGED_AGENT_ID_AUDIT     || 'crawler-agent',
  keyword:   process.env.MANAGED_AGENT_ID_KEYWORD   || 'keyword-agent',
  geo:       process.env.MANAGED_AGENT_ID_GEO       || 'geo-agent',
  optimizer: process.env.MANAGED_AGENT_ID_OPTIMIZER  || 'optimizer-agent',
  alerter:   process.env.MANAGED_AGENT_ID_ALERTER   || 'alerter-agent',
  reporter:  process.env.MANAGED_AGENT_ID_REPORTER  || 'reporter-agent',
  content:   process.env.MANAGED_AGENT_ID_CONTENT   || 'writer-agent',
  link:      process.env.MANAGED_AGENT_ID_LINK      || 'link-agent',
  technical: process.env.MANAGED_AGENT_ID_TECHNICAL || 'technical-agent',
}

// Single shared environment — all agents use the same allowed hosts / secrets
const MANAGED_ENV_ID = process.env.MANAGED_ENVIRONMENT_ID || ''

// ── Anthropic client singleton ───────────────────────────────────────────
let _client: Anthropic | null = null

function getAnthropicClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')
    _client = new Anthropic({
      apiKey,
      defaultHeaders: {
        'anthropic-beta': 'managed-agents-2026-04-01',
      },
    })
  }
  return _client
}

// ── Public types ─────────────────────────────────────────────────────────

export interface ManagedDispatchInput {
  supabase:       SupabaseClient
  task:           StrategyTask
  client:         { id: string; name: string; domain: string | null; pagespeed_url: string | null }
  botType:        BotType
  standingOrder:  StandingOrder
  triggerSource:  TriggerSource
  customPrompt?:  string   // Optional user-provided instructions from the modal
}

export interface ManagedDispatchResult {
  ok:         boolean
  runId?:     string
  sessionId?: string   // Managed Agent session ID for streaming
  status:     'running' | 'failed'
  reason?:    string
}

// ── Main dispatch function ───────────────────────────────────────────────

export async function dispatchManagedAgent(
  input: ManagedDispatchInput,
): Promise<ManagedDispatchResult> {
  const {
    supabase, task, client, botType, standingOrder,
    triggerSource, customPrompt,
  } = input

  // ── Validate config ──
  const agentId = MANAGED_AGENT_IDS[botType]
  if (!agentId) {
    return { ok: false, status: 'failed', reason: `No managed agent mapping for bot_type='${botType}'` }
  }

  if (!MANAGED_ENV_ID) {
    return { ok: false, status: 'failed', reason: 'MANAGED_ENVIRONMENT_ID not configured' }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, status: 'failed', reason: 'ANTHROPIC_API_KEY not configured' }
  }

  // ── 1. Open bot_runs row immediately so the dashboard sees 'running' ──
  const startedAt = new Date().toISOString()
  const { data: runRow, error: runErr } = await supabase
    .from('bot_runs')
    .insert({
      client_id:      task.client_id,
      bot_type:       botType,
      task_id:        task.id,
      status:         'running',
      trigger_source: triggerSource,
      input: {
        task_id:       task.id,
        task_title:    task.title,
        agent_id:      agentId,
        scope:         resolveScope(botType, task, standingOrder),
        dispatched_via: 'managed_agents',
      },
      started_at: startedAt,
    } satisfies Omit<BotRunRecord, 'id'>)
    .select('id')
    .single() as { data: { id: string } | null; error: { message: string } | null }

  if (runErr || !runRow) {
    return {
      ok:     false,
      status: 'failed',
      reason: `Failed to open bot_runs row: ${runErr?.message ?? 'no row returned'}`,
    }
  }
  const runId = runRow.id

  // Flip task + bot_configs to running
  await supabase
    .from('strategy_tasks')
    .update({ status: 'in_progress', updated_at: startedAt })
    .eq('id', task.id)

  await supabase
    .from('bot_configs')
    .update({ status: 'running', last_run_at: startedAt })
    .eq('client_id', task.client_id)
    .eq('bot_type', botType)

  // ── 2. Build the agent brief ──
  const brief = buildAgentBrief({
    agentId, botType, task, client, standingOrder, runId, customPrompt,
  })

  // ── 3. Create Managed Agent session + send brief ──
  let sessionId: string
  try {
    const anthropic = getAnthropicClient()

    // Create session on the managed agent
    const session = await (anthropic.beta as any).sessions.create({
      agent: agentId,
      environment_id: MANAGED_ENV_ID,
    })
    sessionId = session.id

    // Send the task brief as a user message
    await (anthropic.beta as any).sessions.events.send(sessionId, {
      events: [
        {
          type: 'user.message',
          content: [{ type: 'text', text: brief }],
        },
      ],
    })

    // Store session ID in bot_runs metadata for reference
    await supabase
      .from('bot_runs')
      .update({
        input: {
          task_id:        task.id,
          task_title:     task.title,
          agent_id:       agentId,
          scope:          resolveScope(botType, task, standingOrder),
          dispatched_via: 'managed_agents',
          session_id:     sessionId,
        },
      })
      .eq('id', runId)

  } catch (err) {
    console.error('[dispatch-managed] Failed to create session or send brief:', err)
    await markRunFailed(supabase, runId, err instanceof Error ? err.message : 'Session creation failed')
    return {
      ok:     false,
      runId,
      status: 'failed',
      reason: err instanceof Error ? err.message : 'Managed agent session creation failed',
    }
  }

  return { ok: true, runId, sessionId, status: 'running' }
}

// ── Scope resolution (same logic as dispatch-gateway.ts) ─────────────────

function resolveScope(
  botType: BotType,
  task: StrategyTask,
  standingOrder: StandingOrder,
): string {
  const metaScope = (task.metadata?.scope as string | undefined) ?? undefined
  if (metaScope) return metaScope
  if (standingOrder.scope) return standingOrder.scope
  switch (botType) {
    case 'analytics': return 'monthly_rollup'
    case 'audit':     return 'full_crawl'
    case 'keyword':   return 'opportunity_scan'
    case 'geo':       return 'visibility_audit'
    case 'optimizer': return 'on_page_rewrite'
    case 'alerter':   return 'anomaly_check'
    case 'reporter':  return 'monthly_recap'
    default:          return 'default'
  }
}

// ── Brief builder ────────────────────────────────────────────────────────

interface BuildBriefArgs {
  agentId:       string
  botType:       BotType
  task:          StrategyTask
  client:        { id: string; name: string; domain: string | null; pagespeed_url: string | null }
  standingOrder: StandingOrder
  runId:         string
  customPrompt?: string
}

function buildAgentBrief(args: BuildBriefArgs): string {
  const { agentId, botType, task, client, standingOrder, runId, customPrompt } = args
  const scope = resolveScope(botType, task, standingOrder)

  let brief = `DASHBOARD TASK — ${botType.toUpperCase()} AGENT

You have been spawned by the Yatsar-SEO dashboard via the Managed Agents bridge.
Follow your system prompt instructions exactly. Do not improvise the
Supabase write path — use the curl pattern documented in your system prompt.

Client:      ${client.name}
client_id:   ${client.id}
Domain:      ${client.domain ?? '(none)'}
${client.pagespeed_url ? `PageSpeed URL: ${client.pagespeed_url}` : ''}

Task:        ${task.title}
task_id:     ${task.id}
Scope:       ${scope}
Priority:    ${task.priority}
Description: ${task.description ?? '(none)'}

IMPORTANT — bot_runs row already opened:
  bot_run_id: ${runId}
  status:     running

The dashboard has ALREADY inserted a bot_runs row for this task with the
id above. Do NOT insert a new bot_runs row. Your job is to PATCH the
existing row at id=eq.${runId} when you finish:

  - On success: status='succeeded', output=<your report jsonb>, finished_at, duration_ms
  - On failure: status='failed',    error_message=<reason>,     finished_at, duration_ms
  - On escalation: status='escalated', error_message=<reason>, finished_at, duration_ms

You MUST also INSERT one row into activity_logs with:
  - client_id: ${client.id}
  - bot_type:  ${botType}
  - event_type: (see your system prompt for the canonical event_type for this scope)
  - message:   human-readable one-liner
  - metadata:  { "bot_run_id": "${runId}", "task_id": "${task.id}", "scope": "${scope}" }

Valid bot_runs.status values: queued | running | succeeded | failed | escalated | skipped.
NEVER use "completed".

Valid activity_logs.status values: success | warning | error | info.
NEVER use "succeeded".`

  if (customPrompt) {
    brief += `\n\nADDITIONAL INSTRUCTIONS FROM USER:\n${customPrompt}`
  }

  brief += `\n\nWhen finished, return a completion report in this exact format:

  STATUS: succeeded | failed | escalated
  BOT_RUN_ID: ${runId}
  ACTIVITY_LOG_ID: <uuid>
  NOTES: <one line>
`

  return brief
}

// ── Stream helper — returns an async iterable of SSE events ──────────────

export async function streamManagedSession(
  sessionId: string,
): Promise<ReadableStream> {
  const anthropic = getAnthropicClient()

  // The Managed Agents streaming endpoint returns SSE
  const response = await fetch(
    `https://api.anthropic.com/v1/sessions/${sessionId}/stream`,
    {
      method: 'GET',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-beta': 'managed-agents-2026-04-01',
        'Accept': 'text/event-stream',
      },
    },
  )

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Stream failed ${response.status}: ${body.slice(0, 400)}`)
  }

  if (!response.body) {
    throw new Error('No response body from streaming endpoint')
  }

  return response.body
}

// ── Failure helper ───────────────────────────────────────────────────────

async function markRunFailed(
  supabase: SupabaseClient,
  runId: string,
  reason: string,
): Promise<void> {
  const now = new Date().toISOString()
  try {
    await supabase
      .from('bot_runs')
      .update({
        status:        'failed',
        error_message: reason,
        finished_at:   now,
      })
      .eq('id', runId)

    // Also reset bot_configs to error state
  } catch (err) {
    console.error(`[dispatch-managed] Failed to mark run ${runId} as failed:`, err)
  }
}

// ── Preset prompts per bot type (for the UI modal) ───────────────────────

export const AGENT_PRESETS: Record<string, { label: string; prompts: { label: string; value: string }[] }> = {
  analytics: {
    label: 'Analytics Agent',
    prompts: [
      { label: 'Monthly traffic rollup', value: 'Run a monthly traffic rollup — summarize organic sessions, top growing/declining keywords, and click trends.' },
      { label: 'Core Web Vitals audit', value: 'Run a Core Web Vitals audit — check LCP, FID, CLS for the top 10 pages and flag anything failing.' },
      { label: 'GSC performance snapshot', value: 'Pull a GSC performance snapshot — top queries by clicks, impressions, CTR, and average position for the last 28 days.' },
    ],
  },
  audit: {
    label: 'Crawler Agent',
    prompts: [
      { label: 'Full site crawl', value: 'Run a full technical crawl — check for broken links, missing meta tags, redirect chains, thin content, and orphan pages.' },
      { label: 'Indexation audit', value: 'Run an indexation audit — compare sitemap URLs vs indexed URLs, find noindex issues, and check robots.txt.' },
      { label: 'Page speed check', value: 'Run a page speed check on the top 10 traffic pages — flag anything with LCP > 2.5s or CLS > 0.1.' },
    ],
  },
  keyword: {
    label: 'Keyword Agent',
    prompts: [
      { label: 'Opportunity scan', value: 'Run a keyword opportunity scan — find keywords in positions 4-20 with high volume where we can push to page 1.' },
      { label: 'Competitor gap analysis', value: 'Run a competitor keyword gap analysis — find high-value keywords our competitors rank for that we don\'t.' },
      { label: 'Content gap finder', value: 'Find content gaps — topics with search volume in our niche that we have zero coverage on.' },
    ],
  },
  content: {
    label: 'Writer Agent',
    prompts: [
      { label: 'Write article from task', value: 'Write the article as specified in the task description. Target striking-distance keywords from the Ahrefs data.' },
      { label: 'GEO-optimized article', value: 'Write a GEO-optimized article — structure it for AI Overview citations with question H2s, Key Takeaways, and FAQ schema hints.' },
    ],
  },
  link: {
    label: 'Link Agent',
    prompts: [
      { label: 'Ahrefs link gap analysis', value: 'Run an Ahrefs link gap analysis against our top 3 competitors. Find prospects with DR 20-70 that link to competitors but not us.' },
      { label: 'Draft outreach emails', value: 'Research the link targets in the task metadata and draft personalized outreach emails for each prospect.' },
    ],
  },
  geo: {
    label: 'GEO Agent',
    prompts: [
      { label: 'AI visibility audit', value: 'Run a GEO visibility audit — check which of our keywords trigger AI Overviews, whether we\'re cited, and identify gaps.' },
      { label: 'Citation opportunity scan', value: 'Scan for citation opportunities — find AI Overview queries in our niche where we have ranking content but aren\'t being cited.' },
    ],
  },
  optimizer: {
    label: 'Optimizer Agent',
    prompts: [
      { label: 'On-page optimization', value: 'Run an on-page optimization pass — rewrite title tags, meta descriptions, H1s, and internal link suggestions for the specified pages.' },
      { label: 'Content refresh', value: 'Identify stale content (>6 months, declining traffic) and suggest specific updates to regain rankings.' },
    ],
  },
  alerter: {
    label: 'Alerter Agent',
    prompts: [
      { label: 'Anomaly check', value: 'Run an anomaly check — compare this week vs last week for traffic, rankings, and indexation. Flag anything that dropped >15%.' },
      { label: 'Competitor movement alert', value: 'Check if any competitors had major ranking movements this week on our target keywords.' },
    ],
  },
  reporter: {
    label: 'Reporter Agent',
    prompts: [
      { label: 'Monthly SEO recap', value: 'Generate a monthly SEO recap report — organic traffic trends, keyword movements, content published, links acquired, and next month priorities.' },
      { label: 'Client-facing summary', value: 'Write a client-facing summary email — plain English, highlight wins, explain any drops, and list next steps.' },
    ],
  },
  technical: {
    label: 'Technical Agent',
    prompts: [
      { label: 'PageSpeed analysis', value: 'Run a full PageSpeed analysis and generate technical recommendations with priority rankings.' },
      { label: 'Schema markup audit', value: 'Audit the site\'s structured data — check for missing schema types, validation errors, and opportunities.' },
    ],
  },
}
