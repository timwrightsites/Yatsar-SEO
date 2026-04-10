'use client'

import { useEffect, useState } from 'react'
import { Loader2, AlertTriangle, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SummaryData {
  headline: string
  mood: 'good' | 'attention' | 'urgent'
  lines: string[]
  stats: {
    totalTasks: number
    overdue: number
    inProgress: number
    pendingReview: number
    newProspects: number
    recentBotRuns: number
    failedRuns: number
  }
  generatedAt: string
}

const MOOD_CONFIG = {
  good: {
    icon: CheckCircle2,
    border: 'border-[#22c55e]/20',
    bg: 'bg-[#22c55e]/5',
    iconColor: 'text-[#22c55e]',
    headlineColor: 'text-[#22c55e]',
    label: 'All Clear',
  },
  attention: {
    icon: AlertCircle,
    border: 'border-yellow-500/20',
    bg: 'bg-yellow-500/5',
    iconColor: 'text-yellow-400',
    headlineColor: 'text-yellow-400',
    label: 'Needs Attention',
  },
  urgent: {
    icon: AlertTriangle,
    border: 'border-red-500/20',
    bg: 'bg-red-500/5',
    iconColor: 'text-red-400',
    headlineColor: 'text-red-400',
    label: 'Action Required',
  },
}

interface Props {
  clientId: string
}

export function AISummary({ clientId }: Props) {
  const [data, setData]       = useState<SummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const fetchSummary = () => {
    setLoading(true)
    setError(null)
    fetch(`/api/clients/${clientId}/summary`)
      .then(r => {
        if (!r.ok) throw new Error('Failed to load summary')
        return r.json()
      })
      .then(d => setData(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchSummary() }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="bg-[#141414] border border-white/8 rounded-xl p-5 mb-6">
        <div className="flex items-center gap-2 text-white/30 text-sm">
          <Loader2 size={14} className="animate-spin" />
          <span>Generating summary…</span>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="bg-[#141414] border border-white/8 rounded-xl p-5 mb-6">
        <div className="flex items-center gap-2 text-white/30 text-sm">
          <AlertCircle size={14} />
          <span>Couldn&apos;t load summary</span>
          <button onClick={fetchSummary} className="text-white/40 hover:text-white/70 ml-2 transition-colors">
            <RefreshCw size={12} />
          </button>
        </div>
      </div>
    )
  }

  const mood = MOOD_CONFIG[data.mood]
  const Icon = mood.icon

  return (
    <div className={cn('rounded-xl p-5 mb-6 border', mood.border, mood.bg, 'bg-[#141414]')}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className={cn('p-1.5 rounded-lg', mood.bg)}>
            <Icon size={18} className={mood.iconColor} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-white font-semibold text-sm">Status Briefing</h3>
              <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', mood.bg, mood.headlineColor)}>
                {mood.label}
              </span>
            </div>
            <p className={cn('text-xs font-medium mt-0.5', mood.headlineColor)}>
              {data.headline}
            </p>
          </div>
        </div>
        <button
          onClick={fetchSummary}
          className="text-white/20 hover:text-white/50 transition-colors p-1"
          title="Refresh summary"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Summary lines */}
      <div className="space-y-1.5 ml-[38px]">
        {data.lines.map((line, i) => (
          <p key={i} className="text-white/50 text-xs leading-relaxed">
            {line}
          </p>
        ))}
      </div>

      {/* Quick stats row */}
      <div className="flex items-center gap-4 mt-4 ml-[38px] pt-3 border-t border-white/5">
        {data.stats.totalTasks > 0 && (
          <Stat label="Active Tasks" value={data.stats.totalTasks} />
        )}
        {data.stats.overdue > 0 && (
          <Stat label="Overdue" value={data.stats.overdue} color="text-red-400" />
        )}
        {data.stats.inProgress > 0 && (
          <Stat label="In Progress" value={data.stats.inProgress} color="text-blue-400" />
        )}
        {data.stats.pendingReview > 0 && (
          <Stat label="Pending Review" value={data.stats.pendingReview} color="text-yellow-400" />
        )}
        {data.stats.newProspects > 0 && (
          <Stat label="New Prospects" value={data.stats.newProspects} color="text-cyan-400" />
        )}
        {data.stats.failedRuns > 0 && (
          <Stat label="Failed Runs" value={data.stats.failedRuns} color="text-red-400" />
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn('text-sm font-bold', color || 'text-white/70')}>{value}</span>
      <span className="text-[10px] text-white/25">{label}</span>
    </div>
  )
}
