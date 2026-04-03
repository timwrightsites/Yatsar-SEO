import { ClientCard } from '@/components/dashboard/ClientCard'
import { BotActivity } from '@/components/dashboard/BotActivity'
import { mockClients, mockActivityLogs } from '@/lib/mock-data'

export default function DashboardPage() {
  const totalMRR = mockClients
    .filter((c) => c.status === 'active')
    .reduce((sum, c) => sum + (c.monthly_retainer ?? 0), 0)

  const mrrDisplay = totalMRR >= 1000
    ? `$${(totalMRR / 1000).toFixed(1)}K MRR`
    : `$${totalMRR} MRR`

  return (
    <div className="min-h-screen bg-[#0d0d0d] px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-baseline gap-3">
          <h1 className="text-white font-bold text-4xl">Agency View</h1>
          <span className="text-[#22c55e] font-semibold text-base">{mrrDisplay}</span>
        </div>
        <button className="flex items-center gap-2 bg-white text-black font-semibold text-sm px-4 py-2 rounded-lg hover:bg-white/90 transition-all">
          Add Client
          <span className="text-lg leading-none">+</span>
        </button>
      </div>

      {/* Client grid — 4 columns */}
      <div className="grid grid-cols-4 gap-4 mb-10">
        {mockClients.map((client, i) => (
          <ClientCard
            key={client.id}
            client={client}
            stage="Audit Site"
            trafficChange={12}
            lastUpdate="2h ago"
          />
        ))}
      </div>

      {/* Bot Activity */}
      <BotActivity logs={mockActivityLogs} />
    </div>
  )
}
