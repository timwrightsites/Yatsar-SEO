/**
 * GET /api/agents/check-sessions
 *
 * Server-side completion checker for Managed Agent sessions.
 *
 * Problem: Managed agents run on Anthropic's infrastructure and are
 * instructed to PATCH bot_runs via curl when done. But if the agent
 * can't reach Supabase (env misconfiguration, network, or crash),
 * the bot_run stays stuck in 'running' forever until the sweeper kills it.
 *
 * Solution: This endpoint polls the Managed Agents API to check session
 * status for all running bot_runs dispatched via managed_agents. If a
 * session has completed, we extract the result and update the bot_run
 * from our server (which definitely has Supabase access).
 *
 * Call this from:
 *   - Vercel cron (every 2 minutes)
 *   - The client-side status poller as a side-effect
 *   - Manual trigger for debugging
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const maxDuration = 30

// ── Types ──────────────────────────────────────────────────────────────────

interface SessionStatus {
  id: string
  status: 'active' | 'completed' | 'failed' | 'expired'
  result?: {
    type: string
    content?: Array<{ type: string; text?: string }>
  }
  error?: { message: string }
}

export async function GET(req: Request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  // Find all running bot_runs that were dispatched via managed_agents
  const { data: runningRuns, error: queryErr } = await supabase
    .from('bot_runs')
    .select('id, bot_type, client_id, task_id, input, started_at')
    .eq('status', 'running')
    .order('started_at', { ascending: true })
    .limit(20)

  if (queryErr) {
    return NextResponse.json({ error: queryErr.message }, { status: 500 })
  }

  // Filter to only managed agent runs that have a session_id
  const managedRuns = (runningRuns ?? []).filter(
    (r) => {
      const input = r.input as Record<string, unknown> | null
      return input?.dispatched_via === 'managed_agents' && input?.session_id
    }
  )

  if (managedRuns.length === 0) {
    return NextResponse.json({ checked: 0, updated: 0, message: 'No running managed agent sessions' })
  }

  let updated = 0
  const results: Array<{ runId: string; sessionId: string; sessionStatus: string; action: string }> = []

  for (const run of managedRuns) {
    const input = run.input as Record<string, unknown>
    const sessionId = input.session_id as string

    try {
      // Check session status via Managed Agents API
      const sessionRes = await fetch(
        `https://api.anthropic.com/v1/sessions/${sessionId}`,
        {
          headers: {
            'x-api-key': apiKey,
            'anthropic-beta': 'managed-agents-2026-04-01',
            'content-type': 'application/json',
          },
        },
      )

      if (!sessionRes.ok) {
        const errorBody = await sessionRes.text().catch(() => '')
        results.push({
          runId: run.id,
          sessionId,
          sessionStatus: `api_error_${sessionRes.status}`,
          action: 'skipped',
        })

        // If 404, the session doesn't exist — mark as failed
        if (sessionRes.status === 404) {
          await markRunCompleted(supabase, run.id, 'failed', null, 'Managed agent session not found (404)')
          updated++
          results[results.length - 1].action = 'marked_failed'
        }
        continue
      }

      const session: SessionStatus = await sessionRes.json()

      if (session.status === 'active') {
        // Still running — check if it's been running too long (>12 min)
        const elapsed = Date.now() - new Date(run.started_at).getTime()
        results.push({
          runId: run.id,
          sessionId,
          sessionStatus: 'active',
          action: elapsed > 12 * 60_000 ? 'still_running_long' : 'still_running',
        })
        continue
      }

      if (session.status === 'completed') {
        // Extract output from the session result
        const output = extractSessionOutput(session)

        // Check if the bot_run was already updated by the agent itself
        const { data: currentRun } = await supabase
          .from('bot_runs')
          .select('status')
          .eq('id', run.id)
          .single()

        if (currentRun?.status !== 'running') {
          // Agent already updated it — skip
          results.push({ runId: run.id, sessionId, sessionStatus: 'completed', action: 'already_updated' })
          continue
        }

        await markRunCompleted(supabase, run.id, 'succeeded', output, null)
        updated++
        results.push({ runId: run.id, sessionId, sessionStatus: 'completed', action: 'marked_succeeded' })
      }

      if (session.status === 'failed' || session.status === 'expired') {
        const errorMsg = session.error?.message ?? `Session ${session.status}`
        await markRunCompleted(supabase, run.id, 'failed', null, errorMsg)
        updated++
        results.push({ runId: run.id, sessionId, sessionStatus: session.status, action: 'marked_failed' })
      }

    } catch (err) {
      console.error(`[check-sessions] Error checking session ${sessionId}:`, err)
      results.push({
        runId: run.id,
        sessionId,
        sessionStatus: 'check_error',
        action: 'skipped',
      })
    }
  }

  return NextResponse.json({
    checked: managedRuns.length,
    updated,
    results,
  })
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractSessionOutput(session: SessionStatus): Record<string, unknown> | null {
  try {
    // Try to extract text content from the session result
    const textBlocks = session.result?.content?.filter(b => b.type === 'text') ?? []
    if (textBlocks.length === 0) return null

    const fullText = textBlocks.map(b => b.text ?? '').join('\n')

    // Try to parse as JSON first
    const jsonMatch = fullText.match(/```json\n([\s\S]*?)\n```/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1])
      } catch { /* fall through */ }
    }

    // Extract status line
    const statusMatch = fullText.match(/STATUS:\s*(succeeded|failed|escalated)/i)
    const notesMatch = fullText.match(/NOTES:\s*(.+)/i)

    return {
      raw_output: fullText.slice(0, 10000),
      extracted_status: statusMatch?.[1]?.toLowerCase() ?? null,
      notes: notesMatch?.[1]?.trim() ?? null,
      source: 'session_completion_checker',
    }
  } catch {
    return null
  }
}

async function markRunCompleted(
  supabase: ReturnType<typeof createClient>,
  runId: string,
  status: 'succeeded' | 'failed',
  output: Record<string, unknown> | null,
  errorMessage: string | null,
) {
  const now = new Date().toISOString()

  // Get start time for duration calc
  const { data: run } = await supabase
    .from('bot_runs')
    .select('started_at, client_id, bot_type, task_id')
    .eq('id', runId)
    .single()

  const durationMs = run?.started_at
    ? Date.now() - new Date(run.started_at).getTime()
    : null

  // Update bot_run
  await supabase
    .from('bot_runs')
    .update({
      status,
      output: output ?? undefined,
      error_message: errorMessage,
      finished_at: now,
      duration_ms: durationMs,
    })
    .eq('id', runId)

  // Update task status
  if (run?.task_id) {
    await supabase
      .from('strategy_tasks')
      .update({
        status: status === 'succeeded' ? 'done' : 'todo',
        updated_at: now,
      })
      .eq('id', run.task_id)
  }

  // Reset bot_configs
  if (run?.client_id && run?.bot_type) {
    await supabase
      .from('bot_configs')
      .update({
        status: status === 'succeeded' ? 'idle' : 'error',
      })
      .eq('client_id', run.client_id)
      .eq('bot_type', run.bot_type)
  }

  // Insert activity log
  if (run?.client_id) {
    await supabase
      .from('activity_logs')
      .insert({
        client_id: run.client_id,
        bot_type: run.bot_type,
        event_type: `${run.bot_type}_${status}`,
        message: status === 'succeeded'
          ? `${run.bot_type} agent completed successfully (detected by session checker)`
          : `${run.bot_type} agent failed: ${errorMessage?.slice(0, 100) ?? 'unknown error'}`,
        status: status === 'succeeded' ? 'success' : 'error',
        metadata: {
          bot_run_id: runId,
          task_id: run.task_id,
          source: 'session_completion_checker',
        },
      })
  }
}
