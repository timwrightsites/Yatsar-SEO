'use client'

import { useEffect, useState } from 'react'
import { Loader2, AlertCircle, Monitor, Smartphone } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Scores {
  performance: number | null
  accessibility: number | null
  bestPractices: number | null
  seo: number | null
}

interface Vital {
  score: number | null
  displayValue?: string
}

interface PSResult {
  scores: Scores
  vitals: {
    lcp: Vital
    fid: Vital
    cls: Vital
    fcp: Vital
    ttfb: Vital
    tbt: Vital
  }
}

interface PSData {
  mobile: PSResult
  desktop: PSResult
}

function scoreColor(score: number | null) {
  if (score === null) return 'text-white/20'
  if (score >= 90) return 'text-[#22c55e]'
  if (score >= 50) return 'text-yellow-400'
  return 'text-red-400'
}

function ScoreRing({ score, label }: { score: number | null; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={cn('text-2xl font-bold', scoreColor(score))}>
        {score ?? '—'}
      </span>
      <span className="text-white/30 text-[10px]">{label}</span>
    </div>
  )
}

function VitalRow({ label, vital }: { label: string; vital: Vital }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/4 last:border-0">
      <span className="text-white/40 text-xs">{label}</span>
      <span className={cn('text-xs font-medium', scoreColor(vital.score))}>
        {vital.displayValue ?? '—'}
      </span>
    </div>
  )
}

export function PageSpeedPanel({ url }: { url: string }) {
  const [data, setData] = useState<PSData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'mobile' | 'desktop'>('mobile')

  useEffect(() => {
    fetch(`/api/pagespeed?url=${encodeURIComponent(url)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [url])

  if (loading) return (
    <div className="bg-[#141414] border border-white/8 rounded-lg p-5 flex items-center justify-center gap-2 text-white/30 text-sm">
      <Loader2 size={14} className="animate-spin" /> Running PageSpeed…
    </div>
  )

  if (error) return (
    <div className="bg-[#141414] border border-white/8 rounded-lg p-5 flex items-center gap-2 text-red-400 text-sm">
      <AlertCircle size={14} /> {error}
    </div>
  )

  if (!data) return null

  const result = data[tab]

  return (
    <div className="bg-[#141414] border border-white/8 rounded-lg p-5">
      {/* Header + tab toggle */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-white font-semibold text-sm">PageSpeed Insights</p>
        <div className="flex items-center bg-white/5 rounded-md p-0.5">
          <button
            onClick={() => setTab('mobile')}
            className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-all',
              tab === 'mobile' ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/60')}
          >
            <Smartphone size={11} /> Mobile
          </button>
          <button
            onClick={() => setTab('desktop')}
            className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-all',
              tab === 'desktop' ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/60')}
          >
            <Monitor size={11} /> Desktop
          </button>
        </div>
      </div>

      {/* Score grid */}
      <div className="grid grid-cols-4 gap-2 mb-5 pb-4 border-b border-white/5">
        <ScoreRing score={result.scores.performance}    label="Performance" />
        <ScoreRing score={result.scores.accessibility}  label="Accessibility" />
        <ScoreRing score={result.scores.bestPractices}  label="Best Practices" />
        <ScoreRing score={result.scores.seo}            label="SEO" />
      </div>

      {/* Core Web Vitals */}
      <p className="text-white/40 text-xs mb-2">Core Web Vitals</p>
      <div>
        <VitalRow label="Largest Contentful Paint" vital={result.vitals.lcp} />
        <VitalRow label="Total Blocking Time"       vital={result.vitals.tbt} />
        <VitalRow label="Cumulative Layout Shift"   vital={result.vitals.cls} />
        <VitalRow label="First Contentful Paint"    vital={result.vitals.fcp} />
        <VitalRow label="Time to First Byte"        vital={result.vitals.ttfb} />
      </div>
    </div>
  )
}
