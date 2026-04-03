import { createClient } from '@/lib/supabase-server'
import { ClientCard } from '@/components/dashboard/ClientCard'
import { BotActivity } from '@/components/dashboard/BotActivity'
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
    <div className="min-h-screen bg-[#0d0d0d] px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-baseline gap-3">
          <h1 className="text-white font-bold text-4xl">Agency View</h1>
          <span className="text-[#22c55e] font-semibold text-base">{mrrDisplay}</span>
        </div>
        <button className="flex items-center gap-2 bg-white text-black font-semibold text-sm px-4 py-2 rounded-lg hover:bg-white/90 transition-all">
          Add Client <span className="text-lg leading-none">+</span>
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-10">
        {(clients ?? []).map((client: Client) => (
          <ClientCard key={client.id} client={client} />
        ))}
      </div>

      <BotActivity logs={(logs ?? []) as ActivityLog[]} />
    </div>
  )
}
