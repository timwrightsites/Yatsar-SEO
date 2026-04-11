/**
 * POST /api/agents/dispatch
 *
 * Triggers a Managed Agent session for a given strategy task.
 *
 * Body: {
 *   taskId:        string           — the strategy_task to execute
 *   triggerSource?: 'task_created' | 'cron' | 'manual'
 *   customPrompt?: string           — optional user instructions from the modal
 *   botTypeOverride?: string        — force a specific bot type (for modal "run X agent")
 * }
 *
 * Returns: {
 *   ok:        boolean
 *   runId:     string      — bot_runs row ID
 *   sessionId: string      — Managed Agent session ID (for streaming)
 *   status:    string
 * }
 *
 * Auth: accepts either BOTS_DISPATCH_SECRET (server-to-server) or
 * same-origin browser requests (no secret needed — matches /api/agent pattern).
 *
 * Usage from the UI:
 *   1. POST here with taskId + optional customPrompt
 *   2. Get back sessionId
 *   3. Open SSE connection to /api/agents/{sessionId}/stream to watch progress
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { dispatchManagedAgent } from '@/lib/agents/dispatch-managed'
import type { BotType, StandingOrder, StrategyTask } from '@/lib/bots/types'

export const runtime = 'nodejs'
export const maxDuration = 30 // Just creates the session — doesn't wait for completion

// Task type → bot type routing (mirrors dispatch.ts)
const TASK_TYPE_TO_BOT: Record<string, BotType | undefined> = {
  technical: 'technical',
  content:   'content',
  link:      'link',
  meta:      'content',
  keyword:   'keyword',
  analytics: 'analytics',
  audit:     'audit',
  geo:       'geo',
  optimizer: 'optimizer',
  alerter:   'alerter',
  reporter:  'reporter',
}

export async function POST(req: Request) {
  // ── Auth: shared secret (server-to-server) or same-origin (browser) ──
  // Browser calls from the dashboard don't carry the secret — that's fine,
  // they're same-origin and the user is already authenticated.
  // Server-to-server callers (cron, webhooks) pass the secret in Authorization.
  const secret = process.env.BOTS_DISPATCH_SECRET
  const auth   = req.headers.get('authorization') ?? ''
  const origin = req.headers.get('origin') ?? ''
  const referer = req.headers.get('referer') ?? ''
  const isBrowserRequest = origin || referer  // Browser requests include origin/referer
  if (secret && auth !== `Bearer ${secret}` && !isBrowserRequest) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // ── Body ────────────────────────────────────────────────────
  let body: {
    taskId?: string
    triggerSource?: string
    customPrompt?: string
    botTypeOverride?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (!body.taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
  }

  const triggerSource =
    body.triggerSource === 'cron'   ? 'cron'   :
    body.triggerSource === 'manual' ? 'manual' :
                                      'task_created'

  // ── Init Supabase ───────────────────────────────────────────
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // ── Load task ───────────────────────────────────────────────
  const { data: task, error: taskErr } = await supabase
    .from('strategy_tasks')
    .select('*')
    .eq('id', body.taskId)
    .single() as { data: StrategyTask | null; error: { message: string } | null }

  if (taskErr || !task) {
    return NextResponse.json(
      { error: `Task not found: ${taskErr?.message ?? 'no row'}` },
      { status: 404 },
    )
  }

  // ── Resolve bot type ────────────────────────────────────────
  const botType = (body.botTypeOverride as BotType) || TASK_TYPE_TO_BOT[task.type]
  if (!botType) {
    return NextResponse.json(
      { error: `No bot routes for task.type='${task.type}'` },
      { status: 400 },
    )
  }

  // ── Load standing order ─────────────────────────────────────
  const { data: standingOrder } = await supabase
    .from('bot_standing_orders')
    .select('*')
    .eq('client_id', task.client_id)
    .eq('bot_type', botType)
    .maybeSingle() as { data: StandingOrder | null }

  if (!standingOrder) {
    return NextResponse.json(
      { error: `No standing order for ${botType} on this client. Configure one in Settings.` },
      { status: 400 },
    )
  }

  if (!standingOrder.enabled) {
    return NextResponse.json(
      { error: `Standing order for ${botType} is disabled for this client.` },
      { status: 400 },
    )
  }

  // ── Load client ─────────────────────────────────────────────
  const { data: client } = await supabase
    .from('clients')
    .select('id, name, domain, pagespeed_url')
    .eq('id', task.client_id)
    .single()

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  // ── Dispatch to Managed Agent ───────────────────────────────
  try {
    const result = await dispatchManagedAgent({
      supabase,
      task,
      client,
      botType,
      standingOrder,
      triggerSource,
      customPrompt: body.customPrompt,
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'dispatch failed' },
      { status: 500 },
    )
  }
}
