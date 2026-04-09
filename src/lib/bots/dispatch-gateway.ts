/**
 * Gateway agent dispatcher.
 *
 * For operational agents that run inside the OpenClaw runtime (not inside
 * the Vercel serverless lambda). Covers: analytics, audit, keyword, geo,
 * optimizer, alerter, reporter.
 *
 * Why this exists:
 *   Inline bots (technical/content/link) run synchronously inside the
 *   lambda and complete within the request lifecycle. Gateway-spawned
 *   operational agents run autonomously in OpenClaw, often for minutes,
 *   and update `bot_runs` themselves via direct PostgREST curl (see
 *   each agent's AGENTS.md + TOOLS.md "Supabase Staging via curl" section).
 *
 * Contract:
 *   1. We open the `bot_runs` row with status='running' BEFORE firing
 *      the gateway request, so the dashboard sees it immediately.
 *   2. We POST to the gateway's /v1/chat/completions endpoint with the
 *      agent's brief as the user message. The brief includes the
 *      `bot_run_id` we just created so the agent PATCHes the existing
 *      row instead of inserting a duplicate.
 *   3. We use Vercel's `waitUntil` to keep the lambda alive for the
 *      background fetch without blocking the HTTP response to the
 *      dashboard user.
 *   4. The agent is responsible for the final PATCH to bot_runs
 *      (status → succeeded|failed|escalated) and the activity_logs INSERT.
 *      If the agent crashes, a sweeper (not yet built) should catch
 *      bot_runs rows stuck in 'running' for > N minutes and mark them
 *      failed.
 */

import { after as vercelAfter } from 'next/server'
import type {
  BotRunRecord,
  BotType,
  StandingOrder,
  StrategyTask,
  SupabaseClient,
  TriggerSource,
} from './types'

// ── Which bot_types are dispatched via the gateway, not inline ────────────
export const GATEWAY_BOT_TYPES: ReadonlySet<BotType> = new Set<BotType>([
  'analytics',
  'audit',
  'keyword',
  'geo',
  'optimizer',
  'alerter',
  'reporter',
])

export function isGatewayBotType(bot: BotType): boolean {
  return GATEWAY_BOT_TYPES.has(bot)
}

// ── bot_type → OpenClaw agentId (registered in ~/.openclaw/openclaw.json) ──
const AGENT_ID_BY_BOT_TYPE: Record<string, string> = {
  analytics: 'analytics-agent',
  audit:     'crawler-agent',
  keyword:   'keyword-agent',
  geo:       'geo-agent',
  optimizer: 'optimizer-agent',
  alerter:   'alerter-agent',
  reporter:  'reporter-agent',
}

// ── Dispatch input mirrors the inline dispatcher for drop-in compatibility ──
export interface GatewayDispatchInput {
  supabase:      SupabaseClient
  task:          StrategyTask
  client:        { id: string; name: string; domain: string | null; pagespeed_url: string | null }
  botType:       BotType
  standingOrder: StandingOrder
  triggerSource: TriggerSource
}

export interface GatewayDispatchResult {
  ok:       boolean
  runId?:   string
  status:   'running' | 'failed'
  reason?:  string
}

export async function dispatchGatewayAgent(
  input: GatewayDispatchInput,
): Promise<GatewayDispatchResult> {
  const { supabase, task, client, botType, standingOrder, triggerSource } = input

  const GATEWAY_URL   = process.env.OPENCLAW_GATEWAY_URL
  const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN
  if (!GATEWAY_URL || !GATEWAY_TOKEN) {
    return { ok: false, status: 'failed', reason: 'OpenClaw gateway not configured' }
  }

  const agentId = AGENT_ID_BY_BOT_TYPE[botType]
  if (!agentId) {
    return { ok: false, status: 'failed', reason: `No agentId mapping for bot_type='${botType}'` }
  }

  // ── 1. Open the bot_runs row up-front so the dashboard sees 'running' ──
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
        spawned_via:   'dashboard_gateway_bridge',
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

  // Flip task + bot_configs to running so the dashboard badges reflect reality
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
  const brief = buildAgentBrief({ agentId, botType, task, client, standingOrder, runId })

  // ── 3. Fire the gateway request in the background via waitUntil ──
  // We do NOT await the upstream stream. The lambda returns immediately;
  // the background task keeps the connection open until the agent finishes
  // its work, which triggers the agent's own PATCH to bot_runs.
  const upstreamPromise = fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GATEWAY_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model:    `openclaw/${agentId}`,
      stream:   true,
      messages: [{ role: 'user', content: brief }],
    }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        console.error(`[dispatch-gateway] Upstream ${res.status} for run ${runId}:`, body.slice(0, 500))
        await markRunFailed(supabase, runId, `Gateway returned ${res.status}: ${body.slice(0, 300)}`)
        return
      }
      // Drain the stream so the connection stays open until the agent
      // actually finishes. We ignore the content — the agent writes its
      // own bot_runs update via curl. We just need to keep the socket
      // alive so the gateway doesn't kill the session.
      const reader = res.body?.getReader()
      if (!reader) return
      try {
        while (true) {
          const { done } = await reader.read()
          if (done) break
        }
      } catch (err) {
        console.error(`[dispatch-gateway] Stream drain error for run ${runId}:`, err)
      }
    })
    .catch(async (err) => {
      console.error(`[dispatch-gateway] Fetch error for run ${runId}:`, err)
      await markRunFailed(supabase, runId, `Fetch to gateway failed: ${err?.message ?? 'unknown'}`)
    })

  // Vercel: keep the lambda alive for the background work.
  // Falls back to a no-op in local dev if `after` isn't available.
  try {
    vercelAfter(upstreamPromise)
  } catch {
    // Not running on Vercel — let the promise run uncaptured.
    // This is fine in local dev where the process doesn't freeze.
    void upstreamPromise
  }

  return { ok: true, runId, status: 'running' }
}

// ── Scope resolution ──────────────────────────────────────────────────────
// Standing orders define the default scope per bot_type; tasks can override
// it via metadata.scope. Individual agents read their TOOLS.md for what
// scopes they support (e.g. analytics supports monthly_rollup | cwv_audit).
function resolveScope(
  botType: BotType,
  task: StrategyTask,
  standingOrder: StandingOrder,
): string {
  const metaScope = (task.metadata?.scope as string | undefined) ?? undefined
  if (metaScope) return metaScope
  if (standingOrder.scope) return standingOrder.scope
  // Fallback defaults
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

// ── Brief builder ─────────────────────────────────────────────────────────
// The brief is what the operational agent reads as its "task" prompt.
// It deliberately references the agent's own AGENTS.md + TOOLS.md instead
// of restating procedures here — keeps the brief short and avoids drift.
interface BuildBriefArgs {
  agentId:       string
  botType:       BotType
  task:          StrategyTask
  client:        { id: string; name: string; domain: string | null; pagespeed_url: string | null }
  standingOrder: StandingOrder
  runId:         string
}

function buildAgentBrief(args: BuildBriefArgs): string {
  const { agentId, botType, task, client, standingOrder, runId } = args
  const scope = resolveScope(botType, task, standingOrder)

  return `DASHBOARD TASK — ${botType.toUpperCase()} AGENT

You have been spawned by the Yatsar-SEO dashboard via the gateway bridge.
Follow your own AGENTS.md and TOOLS.md exactly. Do not improvise the
Supabase write path — use the curl pattern documented in TOOLS.md under
"Supabase Staging via curl — Canonical Write Path".

Client:      ${client.name}
client_id:   ${client.id}
Domain:      ${client.domain ?? '(none)'}

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
  - event_type: (see your AGENTS.md for the canonical event_type for this scope)
  - message:   human-readable one-liner
  - metadata:  { "bot_run_id": "${runId}", "task_id": "${task.id}", "scope": "${scope}" }

Supabase credentials live in ~/Projects/Yatsar-SEO/.env.local.
Valid bot_runs.status values: queued | running | succeeded | failed | escalated | skipped.
NEVER use "completed".

When finished, return a completion report in this exact format:

  STATUS: succeeded | failed | escalated
  BOT_RUN_ID: ${runId}
  ACTIVITY_LOG_ID: <uuid>
  NOTES: <one line>
`
}

// ── Failure helper ────────────────────────────────────────────────────────
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
  } catch (err) {
    console.error(`[dispatch-gateway] Failed to mark run ${runId} as failed:`, err)
  }
}
