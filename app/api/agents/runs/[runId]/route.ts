/**
 * GET /api/agents/runs/[runId]
 *
 * Returns the full bot_run record including output JSON.
 * Used when expanding a row in the Bot Runs table.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

interface RouteParams {
  params: Promise<{ runId: string }>
}

export async function GET(req: Request, { params }: RouteParams) {
  const { runId } = await params

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: run, error } = await supabase
    .from('bot_runs')
    .select('*')
    .eq('id', runId)
    .single()

  if (error || !run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }

  // Pull the Paperclip agent_run narrative (if linked)
  let agentRun: {
    id: string
    agent: string | null
    issue_id: string | null
    output_summary: string | null
    output: string | null
  } | null = null

  if (run.agent_run_id) {
    const { data } = await supabase
      .from('agent_runs')
      .select('id, agent, issue_id, output_summary, output')
      .eq('id', run.agent_run_id)
      .single()
    agentRun = data ?? null
  }

  return NextResponse.json({ ...run, agent_run: agentRun })
}
