/**
 * Bot dispatcher.
 *
 * Single entry point for kicking off bot work. Given a task ID, it:
 *   1. Loads the strategy_task and resolves bot_type from task.type
 *   2. Loads the matching standing order for (client × bot_type)
 *   3. Honors enabled flag (skips if disabled)
 *   4. Creates a `bot_runs` row in 'running' state, also flips bot_configs.status
 *   5. Calls the right concrete bot implementation
 *   6. Writes the result back to bot_runs + bot_configs
 *
 * Failure semantics: every error path writes a `failed` row to bot_runs with
 * the error message, so the agency owner has a complete audit trail.
 *
 * Currently implemented bots:
 *   - technical (PageSpeed Insights)
 *   - content   (OpenClaw article drafts)
 *   - link      (Ahrefs link gap + strategist-driven outreach drafts)
 *
 * GEO/analytics/audit/optimizer/alerter/reporter work is handled by
 * dedicated OpenClaw agents running in their own runtimes — those will
 * be wired in later via a webhook callback pattern, not as bots in this
 * dispatcher (so OpenClaw's full agent-loop power isn't constrained by
 * our serverless lambda timeouts).
 */

import { runTechnicalBot } from './technical'
import { runContentBot }   from './content'
import { runLinkBot }      from './link'
import { dispatchGatewayAgent, isGatewayBotType } from './dispatch-gateway'
import type {
  BotExecutionResult,
  BotRunRecord,
  BotType,
  StandingOrder,
  StrategyTask,
  SupabaseClient,
  TriggerSource,
} from './types'

const TASK_TYPE_TO_BOT: Record<string, BotType | undefined> = {
  // Inline bots (execute in the Vercel lambda)
  technical: 'technical',
  content:   'content',
  link:      'link',
  meta:      'content',  // meta tag work routes to content bot
  // Gateway-spawned operational agents (execute in OpenClaw runtime)
  keyword:   'keyword',    // was 'content' — now routes to keyword-agent
  analytics: 'analytics',
  audit:     'audit',
  geo:       'geo',
  optimizer: 'optimizer',
  alerter:   'alerter',
  reporter:  'reporter',
  // 'other' has no bot — dispatcher will skip it
}

export interface DispatchInput {
  supabase:      SupabaseClient
  taskId:        string
  triggerSource: TriggerSource
}

export interface DispatchResult {
  ok:        boolean
  reason?:   string
  runId?:    string
  status?:   string
}

export async function dispatchBotForTask({
  supabase, taskId, triggerSource,
}: DispatchInput): Promise<DispatchResult> {
  // ── 1. Load the task ──────────────────────────────────────
  const { data: task, error: taskErr } = await supabase
    .from('strategy_tasks')
    .select('*')
    .eq('id', taskId)
    .single() as { data: StrategyTask | null; error: { message: string } | null }

  if (taskErr || !task) {
    return { ok: false, reason: `Task not found: ${taskErr?.message ?? 'no row'}` }
  }

  // ── 2. Resolve bot_type from task.type ────────────────────
  const botType = TASK_TYPE_TO_BOT[task.type]
  if (!botType) {
    return { ok: false, reason: `No bot routes for task.type='${task.type}'` }
  }

  // ── 3. Load standing order ────────────────────────────────
  const { data: standingOrder } = await supabase
    .from('bot_standing_orders')
    .select('*')
    .eq('client_id', task.client_id)
    .eq('bot_type', botType)
    .maybeSingle() as { data: StandingOrder | null }

  if (!standingOrder) {
    return await recordSkipped({
      supabase, task, botType, triggerSource,
      reason: `No standing order configured for ${botType} bot on this client`,
    })
  }

  if (!standingOrder.enabled) {
    return await recordSkipped({
      supabase, task, botType, triggerSource,
      reason: `Standing order for ${botType} is disabled for this client`,
    })
  }

  // ── 4. Load client (bots need at least name/domain/pagespeed_url) ──
  const { data: client } = await supabase
    .from('clients')
    .select('id, name, domain, pagespeed_url')
    .eq('id', task.client_id)
    .single()

  if (!client) {
    return { ok: false, reason: 'Client not found' }
  }

  // ── 4b. Gateway routing fork ──────────────────────────────
  // Operational agents (analytics/audit/keyword/geo/optimizer/alerter/reporter)
  // execute in the OpenClaw runtime, not inside this lambda. The gateway
  // dispatcher opens the bot_runs row, fires the spawn request in the
  // background via waitUntil, and returns immediately. The agent itself
  // handles the final PATCH to bot_runs via direct PostgREST curl.
  if (isGatewayBotType(botType)) {
    const gwResult = await dispatchGatewayAgent({
      supabase,
      task,
      client,
      botType,
      standingOrder,
      triggerSource,
    })
    return {
      ok:     gwResult.ok,
      runId:  gwResult.runId,
      status: gwResult.status,
      reason: gwResult.reason,
    }
  }

  // ── 5. Open a bot_runs row + flip task and bot_configs to running ──
  const startedAt = new Date()
  const { data: runRow } = await supabase
    .from('bot_runs')
    .insert({
      client_id:      task.client_id,
      bot_type:       botType,
      task_id:        task.id,
      status:         'running',
      trigger_source: triggerSource,
      input:          { task_id: task.id, task_title: task.title },
      started_at:     startedAt.toISOString(),
    } satisfies Omit<BotRunRecord, 'id'>)
    .select('id')
    .single() as { data: { id: string } | null }

  const runId = runRow?.id ?? null

  // Mark the task as in_progress so the dashboard reflects reality
  await supabase
    .from('strategy_tasks')
    .update({ status: 'in_progress', updated_at: startedAt.toISOString() })
    .eq('id', task.id)

  // Mark bot_configs.status='running' for the dashboard badge
  await supabase
    .from('bot_configs')
    .update({ status: 'running', last_run_at: startedAt.toISOString() })
    .eq('client_id', task.client_id)
    .eq('bot_type', botType)

  // ── 6. Execute the bot ────────────────────────────────────
  let result: BotExecutionResult
  try {
    result = await executeBot({ botType, supabase, client, task, standingOrder })
  } catch (err) {
    result = {
      status: 'failed',
      error:  err instanceof Error ? err.message : 'Unknown bot error',
    }
  }

  const finishedAt = new Date()
  const durationMs = finishedAt.getTime() - startedAt.getTime()

  // ── 7. Persist result to bot_runs + bot_configs ───────────
  if (runId) {
    await supabase
      .from('bot_runs')
      .update({
        status:        result.status,
        output:        result.output ?? null,
        error_message: result.error ?? null,
        finished_at:   finishedAt.toISOString(),
        duration_ms:   durationMs,
      })
      .eq('id', runId)
  }

  // Reset bot_configs back to idle (or 'error' if the run failed)
  await supabase
    .from('bot_configs')
    .update({
      status:      result.status === 'failed' || result.status === 'escalated' ? 'error' : 'idle',
      last_run_at: finishedAt.toISOString(),
    })
    .eq('client_id', task.client_id)
    .eq('bot_type', botType)

  return {
    ok:     result.status === 'succeeded',
    runId:  runId ?? undefined,
    status: result.status,
    reason: result.error,
  }
}

// ── Bot router ────────────────────────────────────────────────────────────

interface ExecuteBotArgs {
  botType:       BotType
  supabase:      SupabaseClient
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client:        any
  task:          StrategyTask
  standingOrder: StandingOrder
}

async function executeBot(args: ExecuteBotArgs): Promise<BotExecutionResult> {
  // Gateway-spawned operational agents are intercepted earlier in
  // dispatchBotForTask by the isGatewayBotType() fork, so they should
  // never reach this switch. If one does, that's a programmer error —
  // fail loudly rather than silently returning undefined.
  switch (args.botType) {
    case 'technical':
      return runTechnicalBot({
        supabase:      args.supabase,
        client:        args.client,
        task:          args.task,
        standingOrder: args.standingOrder,
      })
    case 'content':
      return runContentBot({
        supabase:      args.supabase,
        client:        args.client,
        task:          args.task,
        standingOrder: args.standingOrder,
      })
    case 'link':
      return runLinkBot({
        supabase:      args.supabase,
        client:        args.client,
        task:          args.task,
        standingOrder: args.standingOrder,
      })
    default:
      return {
        status: 'failed',
        error:  `executeBot() reached for gateway-only bot_type='${args.botType}'. ` +
                `This should have been intercepted by isGatewayBotType() in dispatchBotForTask.`,
      }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

interface SkipArgs {
  supabase:      SupabaseClient
  task:          StrategyTask
  botType:       BotType
  triggerSource: TriggerSource
  reason:        string
}

async function recordSkipped({
  supabase, task, botType, triggerSource, reason,
}: SkipArgs): Promise<DispatchResult> {
  const now = new Date().toISOString()
  const { data } = await supabase
    .from('bot_runs')
    .insert({
      client_id:      task.client_id,
      bot_type:       botType,
      task_id:        task.id,
      status:         'skipped',
      trigger_source: triggerSource,
      input:          { task_id: task.id },
      error_message:  reason,
      started_at:     now,
      finished_at:    now,
      duration_ms:    0,
    })
    .select('id')
    .single() as { data: { id: string } | null }
  return { ok: false, reason, runId: data?.id, status: 'skipped' }
}
