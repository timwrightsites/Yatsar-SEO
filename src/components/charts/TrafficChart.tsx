'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { Metric } from '@/types'

interface TrafficChartProps {
  metrics: Metric[]
}

function formatMonth(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short' })
}

export function TrafficChart({ metrics }: TrafficChartProps) {
  const data = metrics.map((m) => ({
    month: formatMonth(m.month),
    traffic: m.organic_traffic ?? 0,
    clicks: m.clicks ?? 0,
  }))

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="trafficGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ background: '#13151c', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: '#94a3b8' }}
          itemStyle={{ color: '#a78bfa' }}
        />
        <Area
          type="monotone"
          dataKey="traffic"
          stroke="#7c3aed"
          strokeWidth={2}
          fill="url(#trafficGrad)"
          name="Organic Traffic"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
