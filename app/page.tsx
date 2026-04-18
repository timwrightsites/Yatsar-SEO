import { createClient } from '@/lib/supabase-server'
import { ProjectsShell } from '@/components/projects/ProjectsShell'
import { buildProjectsRollup } from '@/lib/projects'
import type { Client, ActivityLog } from '@/types/database'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const [{ data: clients }, { data: logs }] = await Promise.all([
    db.from('clients').select('*').order('created_at') as Promise<{ data: Client[] | null }>,
    db.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(20) as Promise<{ data: ActivityLog[] | null }>,
  ])

  const allClients = (clients ?? [])

  // Header MRR sums across _active_ clients only — archived shouldn't
  // inflate monthly numbers.
  const activeClients = allClients.filter((c: Client) => c.status === 'active')
  const totalMRR = activeClients.reduce((sum: number, c: Client) => sum + (c.monthly_retainer ?? 0), 0)
  const mrrDisplay = totalMRR >= 1000
    ? `$${(totalMRR / 1000).toFixed(1)}K MRR`
    : `$${totalMRR} MRR`

  // Roll up project-level stats (task counts, review queue, last activity)
  // once on the server so the grid doesn't have to re-aggregate per tile.
  const projects = await buildProjectsRollup(db, allClients)

  return (
    <ProjectsShell
      projects={projects}
      logs={(logs ?? []) as ActivityLog[]}
      mrrDisplay={mrrDisplay}
    />
  )
}
