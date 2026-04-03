'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface GSCOverview {
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export function GSCMetricCards({ property }: { property: string }) {
  const [data, setData] = useState<GSCOverview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/gsc?property=${encodeURIComponent(property)}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setData(d.overview) })
      .finally(() => setLoading(false))
  }, [property])

  const cards = [
    { label: 'Clicks (90d)',      value: data ? data.clicks.toLocaleString() : '—' },
    { label: 'Impressions (90d)', value: data ? (data.impressions >= 1000 ? `${(data.impressions/1000).toFixed(1)}K` : data.impressions.toLocaleString()) : '—' },
    { label: 'Avg CTR',           value: data ? `${data.ctr}%` : '—' },
    { label: 'Avg Position',      value: data ? String(data.position) : '—' },
  ]

  return (
    <>
      {cards.map(({ label, value }) => (
        <div key={label} className="bg-[#141414] border border-white/8 rounded-lg p-4">
          <p className="text-white/40 text-xs mb-2">{label}</p>
          <div className="flex items-end gap-2">
            <span className={cn('text-white font-bold text-2xl', loading && 'opacity-30 animate-pulse')}>
              {loading ? '…' : value}
            </span>
          </div>
        </div>
      ))}
    </>
  )
}
