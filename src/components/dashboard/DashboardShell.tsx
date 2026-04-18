'use client'

import { useState } from 'react'
import { ClientCard } from '@/components/dashboard/ClientCard'
import { BotActivity } from '@/components/dashboard/BotActivity'
import { AddClientModal } from '@/components/dashboard/AddClientModal'
import { cn } from '@/lib/utils'
import type { Client, ActivityLog } from '@/types/database'

interface Props {
  clients: Client[]
  logs: ActivityLog[]
  mrrDisplay: string
}

type Tab = 'active' | 'archived'

export function DashboardShell({ clients, logs, mrrDisplay }: Props) {
  const [showAdd, setShowAdd] = useState(false)
  const [tab, setTab] = useState<Tab>('active')

  const activeClients   = clients.filter(c => c.status !== 'inactive')
  const archivedClients = clients.filter(c => c.status === 'inactive')
  const visibleClients  = tab === 'active' ? activeClients : archivedClients

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

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-white/8">
        {(['active', 'archived'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium capitalize transition-all border-b-2 -mb-px',
              tab === t
                ? 'text-white border-white'
                : 'text-white/30 border-transparent hover:text-white/60'
            )}
          >
            {t}
            <span className={cn(
              'ml-2 text-xs px-1.5 py-0.5 rounded-full',
              tab === t ? 'bg-white/10 text-white/60' : 'bg-white/5 text-white/20'
            )}>
              {t === 'active' ? activeClients.length : archivedClients.length}
            </span>
          </button>
        ))}
      </div>

      {visibleClients.length > 0 ? (
        <div className="grid grid-cols-4 gap-4 mb-10">
          {visibleClients.map((client) => {
            const lastLog = logs
              .filter(l => l.client_id === client.id)
              .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())[0]
            return (
              <ClientCard
                key={client.id}
                client={client}
                lastActivity={lastLog?.created_at ?? null}
                lastActivityStatus={lastLog?.status ?? null}
              />
            )
          })}
        </div>
      ) : (
        <div className="flex items-center justify-center py-20 mb-10">
          <p className="text-white/20 text-sm">
            {tab === 'active' ? 'No active clients yet.' : 'No archived clients.'}
          </p>
        </div>
      )}

      {tab === 'active' && <BotActivity logs={logs} />}

      {showAdd && <AddClientModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}
