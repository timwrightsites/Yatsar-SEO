import { createClient } from '@/lib/supabase-server'
import { DashboardShell } from '@/components/dashboard/DashboardShell'
import type { Client, ActivityLog } from '@/types/database'

export default async function DashboardPage() {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const [{ data: clients }, { data: logs }] = await Promise.all([
    db.from('clients').select('*').order('created_at') as Promise<{ data: Client[] | null }>,
    db.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(20) as Promise<{ data: ActivityLog[] | null }>,
  ])

  const activeClients = (clients ?? []).filter((c: Client) => c.status === 'active')
  const totalMRR = activeClients.reduce((sum: number, c: Client) => sum + (c.monthly_retainer ?? 0), 0)
  const mrrDisplay = totalMRR >= 1000
    ? `$${(totalMRR / 1000).toFixed(1)}K MRR`
    : `$${totalMRR} MRR`

  return (
    <DashboardShell
      clients={clients ?? []}
      logs={(logs ?? []) as ActivityLog[]}
      mrrDisplay={mrrDisplay}
    />
  )
}
