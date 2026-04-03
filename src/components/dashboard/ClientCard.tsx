'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { Client } from '@/types'

interface ClientCardProps {
  client: Client
  stage?: string
  trafficChange?: number
  lastUpdate?: string
}

export function ClientCard({
  client,
  stage = 'Audit Site',
  trafficChange = 12,
  lastUpdate = '2h ago',
}: ClientCardProps) {
  const monthlyDisplay = client.monthly_retainer
    ? `$${(client.monthly_retainer / 1000).toFixed(0)}${client.monthly_retainer >= 1000 ? 'K' : ''}/M`
    : '—'

  return (
    <div className="bg-[#141414] border border-white/8 rounded-lg p-4 flex flex-col gap-4">
      {/* Top row: name + MRR */}
      <div className="flex items-start justify-between">
        <span className="text-white font-semibold text-base leading-tight">{client.name}</span>
        <span className="text-[#22c55e] font-semibold text-sm">{monthlyDisplay}</span>
      </div>

      {/* Middle: stage + change */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-white/40 text-xs mb-0.5">Current Stage</p>
          <p className="text-white font-semibold text-sm">{stage}</p>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-1 justify-end">
            <span className={cn('text-sm font-semibold', trafficChange >= 0 ? 'text-[#22c55e]' : 'text-red-400')}>
              {trafficChange >= 0 ? '+' : ''}{trafficChange}%
            </span>
            <span className="text-white/40 text-xs">vs last month</span>
          </div>
          <div className="flex items-center gap-1 justify-end mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
            <span className="text-white/40 text-xs">Last update: {lastUpdate}</span>
          </div>
        </div>
      </div>

      {/* View Sub Account button */}
      <Link
        href={`/clients/${client.id}`}
        className="w-full text-center py-2 text-sm text-white/80 border border-white/10 rounded-md hover:bg-white/5 hover:text-white transition-all"
      >
        View Sub Account
      </Link>
    </div>
  )
}
