'use client'

import Link from 'next/link'
import { Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Client } from '@/types'

interface ClientCardProps {
  client: Client
  lastActivity: string | null
  lastActivityStatus: string | null
}

function formatTimeAgo(dateStr: string): string {
  const diff  = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

function formatMRR(retainer: number | null): string {
  if (!retainer) return '—'
  if (retainer >= 1000) return `$${(retainer / 1000).toFixed(retainer % 1000 === 0 ? 0 : 1)}K/mo`
  return `$${retainer.toLocaleString()}/mo`
}

const activityDot: Record<string, string> = {
  success: 'bg-[#22c55e]',
  info:    'bg-blue-400',
  warning: 'bg-yellow-400',
  error:   'bg-red-500',
}

const statusBadge: Record<string, { label: string; className: string }> = {
  active:   { label: 'Active',   className: 'border-[#22c55e]/30 text-[#22c55e]/70' },
  paused:   { label: 'Paused',   className: 'border-yellow-500/30 text-yellow-400/70' },
  inactive: { label: 'Archived', className: 'border-white/10 text-white/25' },
}

export function ClientCard({ client, lastActivity, lastActivityStatus }: ClientCardProps) {
  const badge = statusBadge[client.status] ?? statusBadge.active

  return (
    <div className="bg-[#141414] border border-white/8 rounded-lg p-4 flex flex-col gap-4">

      {/* Name + MRR */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-white font-semibold text-base leading-tight">{client.name}</span>
        <span className="text-[#22c55e] font-semibold text-sm shrink-0">{formatMRR(client.monthly_retainer)}</span>
      </div>

      {/* Domain + industry */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 text-white/40 text-xs">
          <Globe size={11} />
          <span className="truncate">{client.domain}</span>
        </div>
        {client.industry && (
          <span className="text-white/25 text-xs">{client.industry}</span>
        )}
      </div>

      {/* Status + last activity */}
      <div className="flex items-center justify-between">
        <span className={cn('text-[10px] border px-2 py-0.5 rounded font-medium', badge.className)}>
          {badge.label}
        </span>
        {lastActivity ? (
          <div className="flex items-center gap-1.5">
            <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', activityDot[lastActivityStatus ?? 'info'] ?? 'bg-white/20')} />
            <span className="text-white/30 text-xs">{formatTimeAgo(lastActivity)}</span>
          </div>
        ) : (
          <span className="text-white/20 text-xs">No activity yet</span>
        )}
      </div>

      {/* CTA */}
      <Link
        href={`/clients/${client.id}`}
        className="w-full text-center py-2 text-sm text-white/60 border border-white/10 rounded-md hover:bg-white/5 hover:text-white transition-all"
      >
        View Sub Account
      </Link>
    </div>
  )
}
