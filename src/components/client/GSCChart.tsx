'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'

interface DateRow {
  date: string
  clicks: number
  impressions: number
}

interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{ value: number; dataKey: string }>
  label?: string
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-2 text-xs">
      <p className="text-white/40 mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} className="text-white font-semibold">
          {p.dataKey === 'clicks' ? 'Clicks' : 'Impressions'}: {p.value.toLocaleString()}
        </p>
      ))}
    </div>
  )
}

export function GSCChart({ property }: { property: string }) {
  const [data, setData] = useState<DateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [metric, setMetric] = useState<'clicks' | 'impressions'>('clicks')

  useEffect(() => {
    fetch(`/api/gsc?property=${encodeURIComponent(property)}`)
      .then(r => r.json())
      .then(d => { if (!d.error && d.dateRows) setData(d.dateRows) })
      .finally(() => setLoading(false))
  }, [property])

  // Format date label: "Jan 5"
  function formatDate(dateStr: string) {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  // Downsample to ~20 points for readability
  const sampled = data.length > 20
    ? data.filter((_, i) => i % Math.floor(data.length / 20) === 0)
    : data

  const chartData = sampled.map(r => ({
    ...r,
    label: formatDate(r.date),
  }))

  return (
    <div className="bg-[#141414] border border-white/8 rounded-lg p-5 mb-6">
      <div className="flex items-center justify-between mb-1">
        <div>
          <p className="text-white/40 text-xs">Search Performance</p>
          <p className="text-white font-semibold text-sm mt-0.5">Last 90 Days</p>
        </div>
        <div className="flex items-center bg-white/5 rounded-md p-0.5">
          <button
            onClick={() => setMetric('clicks')}
            className={`px-3 py-1 rounded text-xs transition-all ${metric === 'clicks' ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/60'}`}
          >
            Clicks
          </button>
          <button
            onClick={() => setMetric('impressions')}
            className={`px-3 py-1 rounded text-xs transition-all ${metric === 'impressions' ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/60'}`}
          >
            Impressions
          </button>
        </div>
      </div>

      {loading ? (
        <div className="h-48 flex items-center justify-center gap-2 text-white/30 text-sm">
          <Loader2 size={14} className="animate-spin" /> Loading chart…
        </div>
      ) : chartData.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-white/20 text-sm">
          No data available for this period
        </div>
      ) : (
        <div className="mt-4 h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gscGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0}   />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                dataKey="label"
                tick={{ fill: 'rgba(255,255,255,0.25)', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: 'rgba(255,255,255,0.25)', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey={metric}
                stroke="#22c55e"
                strokeWidth={2}
                fill="url(#gscGrad)"
                dot={false}
                activeDot={{ r: 4, fill: '#22c55e' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
