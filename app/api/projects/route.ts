/**
 * /api/projects
 *
 *   GET — return the Paperclip-style projects rollup (one entry per
 *         client), including task-status counts, review-queue depth,
 *         and last-activity micro-feed.
 *
 * Query params:
 *   include_archived=1   — include clients with status='inactive'
 *                          (default: skip archived)
 *
 * Shape: { projects: ProjectRollup[] } — see src/lib/projects.ts.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildProjectsRollup, type ProjectRollup } from '@/lib/projects'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface ProjectsListResponse { projects: ProjectRollup[] }

export async function GET(req: Request) {
  const url = new URL(req.url)
  const includeArchived = url.searchParams.get('include_archived') === '1'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  let query = db
    .from('clients')
    .select('id, name, domain, status, industry, monthly_retainer')
    .order('created_at', { ascending: true })

  if (!includeArchived) query = query.neq('status', 'inactive')

  const { data: clients, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const projects = await buildProjectsRollup(db, clients ?? [])
  return NextResponse.json({ projects } satisfies ProjectsListResponse)
}
