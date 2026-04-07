/**
 * POST /api/bots/dispatch
 *
 * Body: { taskId: string, triggerSource?: 'task_created' | 'cron' | 'manual' }
 *
 * Used by:
 *   - The agent route's strategy parser (fire-and-forget after each task insert)
 *   - Future cron jobs (Vercel Cron → POST here with triggerSource='cron')
 *   - Manual dashboard "force run" (if we ever add it back)
 *
 * Auth: protected by an internal shared secret (BOTS_DISPATCH_SECRET) so
 * only our own server-side callers can fire it. Vercel Cron requests pass
 * the secret in the Authorization header — see Vercel cron docs.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { dispatchBotForTask } from '@/lib/bots/dispatch'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(req: Request) {
  // ── Auth: shared secret ─────────────────────────────────────
  const secret = process.env.BOTS_DISPATCH_SECRET
  const auth   = req.headers.get('authorization') ?? ''
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // ── Body ────────────────────────────────────────────────────
  let body: { taskId?: string; triggerSource?: string }
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

  // ── Run dispatcher ──────────────────────────────────────────
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  try {
    const result = await dispatchBotForTask({
      supabase,
      taskId: body.taskId,
      triggerSource,
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'dispatch failed' },
      { status: 500 },
    )
  }
}
