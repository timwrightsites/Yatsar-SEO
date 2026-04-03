'use client'

import { useEffect, useState } from 'react'
import { TrendingUp, MousePointerClick, Eye, Hash, Loader2, AlertCircle } from 'lucide-react'

interface GSCOverview {
  clicks: number
  impressions: number
  ctr: number
  position: number
}

interface GSCQuery {
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

interface GSCData {
  overview: GSCOverview
  topQueries: GSCQuery[]
}

function StatPill({ label, value, icon: Icon }: { label: string; value: string | number; icon: React.ElementType }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-white/30 text-[11px]">
        <Icon size={11} />
        {label}
      </div>
      <span className="text-white font-bold text-xl">{value}</span>
    </div>
  )
}

export function GSCPanel({ property }: { property: string }) {
  const [data, setData] = useState<GSCData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/gsc?property=${encodeURIComponent(property)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [property])

  if (loading) return (
    <div className="bg-[#141414] border border-white/8 rounded-lg p-5 flex items-center justify-center gap-2 text-white/30 text-sm">
      <Loader2 size={14} className="animate-spin" /> Loading GSC data…
    </div>
  )

  if (error) return (
    <div className="bg-[#141414] border border-white/8 rounded-lg p-5 flex items-center gap-2 text-red-400 text-sm">
      <AlertCircle size={14} /> {error}
    </div>
  )

  if (!data) return null

  return (
    <div className="bg-[#141414] border border-white/8 rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-white font-semibold text-sm">Search Console</p>
        <span className="text-white/25 text-[11px]">Last 90 days</span>
      </div>

      {/* Overview stats */}
      <div className="grid grid-cols-4 gap-4 mb-5 pb-5 border-b border-white/5">
        <StatPill label="Clicks" value={data.overview.clicks.toLocaleString()} icon={MousePointerClick} />
        <StatPill label="Impressions" value={data.overview.impressions >= 1000
          ? `${(data.overview.impressions / 1000).toFixed(1)}K`
          : data.overview.impressions.toLocaleString()} icon={Eye} />
        <StatPill label="CTR" value={`${data.overview.ctr}%`} icon={TrendingUp} />
        <StatPill label="Avg Position" value={data.overview.position} icon={Hash} />
      </div>

      {/* Top queries */}
      <p className="text-white/40 text-xs mb-3">Top Queries</p>
      <div className="flex flex-col gap-0">
        {data.topQueries.slice(0, 8).map((q, i) => (
          <div key={i} className="flex items-center justify-between py-2 border-b border-white/4 last:border-0">
            <span className="text-white/70 text-xs truncate max-w-[55%]">{q.query}</span>
            <div className="flex items-center gap-4 text-[11px] text-white/40 shrink-0">
              <span><span className="text-white/60">{q.clicks}</span> clicks</span>
              <span>pos <span className="text-white/60">{q.position}</span></span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
