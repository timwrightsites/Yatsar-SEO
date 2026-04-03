'use client'

import { useEffect, useState } from 'react'
import { TrendingUp, MousePointerClick, Eye, Hash, Loader2, AlertCircle, FileText, Search } from 'lucide-react'

interface GSCOverview {
  clicks: number
  impressions: number
  ctr: number
  position: number
}

interface GSCRow {
  clicks: number
  impressions: number
  ctr: number
  position: number
}

interface GSCQuery extends GSCRow { query: string }
interface GSCPage  extends GSCRow { page: string }

interface GSCData {
  overview: GSCOverview
  topQueries: GSCQuery[]
  topPages: GSCPage[]
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

function RowItem({ label, clicks, position, ctr }: { label: string; clicks: number; position: number; ctr: number }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/4 last:border-0">
      <span className="text-white/70 text-xs truncate max-w-[55%]" title={label}>{label}</span>
      <div className="flex items-center gap-4 text-[11px] text-white/40 shrink-0">
        <span><span className="text-white/60">{clicks.toLocaleString()}</span> clicks</span>
        <span><span className="text-white/60">{ctr}%</span> CTR</span>
        <span>pos <span className="text-white/60">{position}</span></span>
      </div>
    </div>
  )
}

export function GSCPanel({ property }: { property: string }) {
  const [data, setData]     = useState<GSCData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)
  const [tab, setTab]       = useState<'queries' | 'pages'>('queries')

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

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-white font-semibold text-sm">Search Console</p>
        <span className="text-white/25 text-[11px]">Last 90 days</span>
      </div>

      {/* Overview stats */}
      <div className="grid grid-cols-4 gap-4 mb-5 pb-5 border-b border-white/5">
        <StatPill label="Clicks"       value={data.overview.clicks.toLocaleString()} icon={MousePointerClick} />
        <StatPill label="Impressions"  value={data.overview.impressions >= 1000
          ? `${(data.overview.impressions / 1000).toFixed(1)}K`
          : data.overview.impressions.toLocaleString()} icon={Eye} />
        <StatPill label="CTR"          value={`${data.overview.ctr}%`} icon={TrendingUp} />
        <StatPill label="Avg Position" value={data.overview.position}  icon={Hash} />
      </div>

      {/* Tab toggle */}
      <div className="flex items-center gap-1 mb-4">
        <button
          onClick={() => setTab('queries')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            tab === 'queries' ? 'bg-white/8 text-white' : 'text-white/30 hover:text-white/60'
          }`}
        >
          <Search size={11} /> Top Queries
        </button>
        <button
          onClick={() => setTab('pages')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            tab === 'pages' ? 'bg-white/8 text-white' : 'text-white/30 hover:text-white/60'
          }`}
        >
          <FileText size={11} /> Top Pages
        </button>
      </div>

      {/* Rows */}
      <div className="flex flex-col">
        {tab === 'queries'
          ? data.topQueries.slice(0, 10).map((q, i) => (
              <RowItem key={i} label={q.query} clicks={q.clicks} position={q.position} ctr={q.ctr} />
            ))
          : data.topPages.slice(0, 10).map((p, i) => {
              // Strip protocol + domain, show just the path
              let label = p.page
              try { label = new URL(p.page).pathname || '/' } catch { /* keep full url */ }
              return <RowItem key={i} label={label} clicks={p.clicks} position={p.position} ctr={p.ctr} />
            })
        }
      </div>
    </div>
  )
}
