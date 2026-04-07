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
 *
 * The other three (content, link, geo) immediately mark their bot_runs row
 * as 'skipped' with a "not yet implemented" note. This keeps the dispatch
 * pipeline complete while we ship one bot at a time.
 */

import { runTechnicalBot } from './technical'
import { runContentBot }   from './content'
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
  technical: 'technical',
  content:   'content',
  link:      'link',
  keyword:   'content',  // keyword research routes to content bot
  meta:      'content',  // meta tag work routes to content bot
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
    case 'geo':
      return {
        status:  'skipped',
        summary: `${args.botType} bot is not yet implemented — task left in queue.`,
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
