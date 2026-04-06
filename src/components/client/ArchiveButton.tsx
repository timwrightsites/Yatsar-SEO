'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, RotateCcw, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  clientId: string
  clientName: string
  currentStatus: string
}

export function ArchiveButton({ clientId, clientName, currentStatus }: Props) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)

  const isArchived = currentStatus === 'inactive'

  async function handleAction() {
    setLoading(true)
    const newStatus = isArchived ? 'active' : 'inactive'

    const res = await fetch(`/api/clients/${clientId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })

    if (res.ok) {
      router.push('/')
      router.refresh()
    } else {
      setLoading(false)
      setConfirming(false)
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-white/40 text-xs">
          {isArchived ? `Restore ${clientName}?` : `Archive ${clientName}?`}
        </span>
        <button
          onClick={() => setConfirming(false)}
          className="text-xs text-white/30 hover:text-white/60 transition-colors px-2 py-1"
        >
          Cancel
        </button>
        <button
          onClick={handleAction}
          disabled={loading}
          className={cn(
            'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-all',
            isArchived
              ? 'bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20'
              : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
          )}
        >
          {loading
            ? <Loader2 size={12} className="animate-spin" />
            : isArchived
              ? <RotateCcw size={12} />
              : <Archive size={12} />
          }
          {isArchived ? 'Restore' : 'Archive'}
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className={cn(
        'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all',
        isArchived
          ? 'border-[#22c55e]/20 text-[#22c55e]/60 hover:border-[#22c55e]/40 hover:text-[#22c55e]'
          : 'border-white/10 text-white/30 hover:border-red-500/30 hover:text-red-400'
      )}
    >
      {isArchived ? <RotateCcw size={12} /> : <Archive size={12} />}
      {isArchived ? 'Restore Client' : 'Archive Client'}
    </button>
  )
}
