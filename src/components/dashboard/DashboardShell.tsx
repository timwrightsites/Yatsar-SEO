'use client'

import { useState } from 'react'
import { ClientCard } from '@/components/dashboard/ClientCard'
import { BotActivity } from '@/components/dashboard/BotActivity'
import { AddClientModal } from '@/components/dashboard/AddClientModal'
import type { Client, ActivityLog } from '@/types/database'

interface Props {
  clients: Client[]
  logs: ActivityLog[]
  mrrDisplay: string
}

export function DashboardShell({ clients, logs, mrrDisplay }: Props) {
  const [showAdd, setShowAdd] = useState(false)

  return (
    <div className="min-h-screen bg-[#0d0d0d] px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-baseline gap-3">
          <h1 className="text-white font-bold text-4xl">Agency View</h1>
          <span className="text-[#22c55e] font-semibold text-base">{mrrDisplay}</span>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-white text-black font-semibold text-sm px-4 py-2 rounded-lg hover:bg-white/90 transition-all"
        >
          Add Client <span className="text-lg leading-none">+</span>
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-10">
        {clients.map((client) => (
          <ClientCard key={client.id} client={client} />
        ))}
      </div>

      <BotActivity logs={logs} />

      {showAdd && <AddClientModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}
