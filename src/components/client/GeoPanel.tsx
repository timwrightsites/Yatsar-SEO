'use client'

/**
 * GeoPanel — Generative Engine Optimization (AI Search) visibility panel.
 *
 * Pulls /api/ahrefs/geo which calls Ahrefs API v3 organic-keywords with the
 * `serp_features` selector and aggregates AI Overview / featured snippet /
 * knowledge panel presence across the client's top traffic-driving keywords.
 *
 * The "GEO score" is a simple proxy: % of sampled top keywords where the
 * client appears in (or could appear in) an AI Overview block. It's not a
 * perfect signal — Ahrefs only knows whether the SERP HAS an AI Overview,
 * not whether the client's URL is cited inside it — but it's directionally
 * useful as a baseline that improves week-over-week as you optimize.
 */

import { useEffect, useState, useCallback } from 'react'
import {
  Sparkles, AlertCircle, RefreshCw, Loader2, ExternalLink,
  TrendingUp, Bot, MessageSquareQuote, BookOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  clientId: string
  domain:   string
}

interface GeoKeyword {
  keyword:              string
  volume:               number
  difficulty:           number
  traffic:              number
  position:             number
  url:                  string | null
  serp_features:        string[]
  has_ai_overview:      boolean
  has_featured_snippet: boolean
  has_knowledge_panel:  boolean
  is_branded:           boolean
}

interface GeoReport {
  target:                 string
  country:                string
  fetched_at:             string
  total_keywords_sampled: number
  ai_overview_count:      number
  ai_overview_rate:       number
  ai_overview_traffic:    number
  featured_snippet_count: number
  knowledge_panel_count:  number
  branded_ai_count:       number
  keywords:               GeoKeyword[]
}

type LoadState = 'idle' | 'loading' | 'ok' | 'error' | 'no-key'

export function GeoPanel({ clientId, domain }: Props) {
  const [data,    setData]    = useState<GeoReport | null>(null)
  const [state,   setState]   = useState<LoadState>('idle')
  const [error,   setError]   = useState<string | null>(null)
  const [country, setCountry] = useState('us')
  const [filter,  setFilter]  = useState<'all' | 'ai_overview' | 'featured_snippet' | 'knowledge_panel'>('all')

  const load = useCallback(async (fresh = false) => {
    setState('loading')
    setError(null)
    try {
      const qs = new URLSearchParams({
        clientId,
        target: domain,
        country,
        limit: '50',
      })
      if (fresh) qs.set('fresh', '1')

      const res = await fetch(`/api/ahrefs/geo?${qs.toString()}`)
      if (res.status === 503) {
        setState('no-key')
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || `HTTP ${res.status}`)
        setState('error')
        return
      }
      const json = (await res.json()) as GeoReport
      setData(json)
      setState('ok')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setState('error')
    }
  }, [clientId, domain, country])

  useEffect(() => { void load(false) }, [load])

  const filteredKeywords = (data?.keywords ?? []).filter(k => {
    if (filter === 'all')              return true
    if (filter === 'ai_overview')      return k.has_ai_overview
    if (filter === 'featured_snippet') return k.has_featured_snippet
    if (filter === 'knowledge_panel')  return k.has_knowledge_panel
    return true
  })

  const aiRatePct = data ? Math.round(data.ai_overview_rate * 100) : 0

  return (
    <div className="bg-[#141414] border border-white/8 rounded-lg p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-purple-500/15 border border-purple-500/30 flex items-center justify-center">
            <Sparkles size={14} className="text-purple-300" />
          </div>
          <div>
            <h2 className="text-white font-bold text-base">GEO Visibility</h2>
            <p className="text-white/35 text-[11px]">Generative engine presence · AI Overviews · Featured snippets</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="bg-[#0d0d0d] border border-white/10 text-white/70 text-xs rounded-md px-2 py-1.5 hover:border-white/25 transition-colors"
          >
            <option value="us">United States</option>
            <option value="gb">United Kingdom</option>
            <option value="ca">Canada</option>
            <option value="au">Australia</option>
            <option value="de">Germany</option>
          </select>
          <button
            onClick={() => load(true)}
            disabled={state === 'loading'}
            className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white border border-white/10 hover:border-white/25 px-3 py-1.5 rounded-md transition-colors disabled:opacity-40"
          >
            {state === 'loading'
              ? <Loader2 size={12} className="animate-spin" />
              : <RefreshCw size={12} />}
            Refresh
          </button>
        </div>
      </div>

      {/* States */}
      {state === 'loading' && !data && (
        <div className="flex items-center justify-center py-12 text-white/40 text-sm">
          <Loader2 size={14} className="animate-spin mr-2" /> Pulling Ahrefs SERP features…
        </div>
      )}

      {state === 'no-key' && (
        <div className="flex items-start gap-3 bg-yellow-500/5 border border-yellow-500/20 rounded-md p-4">
          <AlertCircle size={16} className="text-yellow-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-yellow-300 text-sm font-semibold">Ahrefs API key not configured</p>
            <p className="text-yellow-200/70 text-xs mt-1">
              Set <code className="bg-black/30 px-1 py-0.5 rounded">AHREFS_API_KEY</code> in your environment to load live GEO visibility data.
            </p>
          </div>
        </div>
      )}

      {state === 'error' && (
        <div className="flex items-start gap-3 bg-red-500/5 border border-red-500/20 rounded-md p-4">
          <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-red-300 text-sm font-semibold">Failed to load GEO data</p>
            <p className="text-red-200/70 text-xs mt-1">{error}</p>
          </div>
        </div>
      )}

      {state === 'ok' && data && (
        <>
          {/* GEO Score hero */}
          <div className="grid grid-cols-12 gap-4 mb-5">
            <div className="col-span-5 bg-gradient-to-br from-purple-500/10 to-transparent border border-purple-500/20 rounded-lg p-5">
              <div className="flex items-center gap-2 text-purple-200/70 text-[11px] uppercase tracking-wider mb-2">
                <Bot size={11} /> AI Overview Presence
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-white font-bold text-5xl tabular-nums">{aiRatePct}</span>
                <span className="text-white/40 text-xl font-semibold">%</span>
              </div>
              <p className="text-white/40 text-xs mt-2">
                {data.ai_overview_count} of {data.total_keywords_sampled} top keywords trigger an AI Overview
              </p>
              {data.branded_ai_count > 0 && (
                <p className="text-purple-300/80 text-[11px] mt-1">
                  {data.branded_ai_count} branded · the rest are open opportunities
                </p>
              )}
            </div>

            {/* Side metrics */}
            <div className="col-span-7 grid grid-cols-3 gap-3">
              <MetricCard
                icon={TrendingUp}
                label="AI Traffic"
                value={data.ai_overview_traffic.toLocaleString()}
                hint="Traffic from AI-Overview keywords"
                tone="purple"
              />
              <MetricCard
                icon={MessageSquareQuote}
                label="Featured Snippets"
                value={data.featured_snippet_count.toString()}
                hint="Direct-answer SERP features"
                tone="blue"
              />
              <MetricCard
                icon={BookOpen}
                label="Knowledge Panels"
                value={data.knowledge_panel_count.toString()}
                hint="Entity recognition signals"
                tone="green"
              />
            </div>
          </div>

          {/* Filter chips */}
          <div className="flex items-center gap-2 mb-3">
            {[
              { key: 'all',              label: `All (${data.keywords.length})` },
              { key: 'ai_overview',      label: `AI Overview (${data.ai_overview_count})` },
              { key: 'featured_snippet', label: `Featured (${data.featured_snippet_count})` },
              { key: 'knowledge_panel',  label: `Knowledge (${data.knowledge_panel_count})` },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key as typeof filter)}
                className={cn(
                  'text-[11px] px-2.5 py-1 rounded border transition-colors',
                  filter === key
                    ? 'bg-white text-black border-white'
                    : 'border-white/10 text-white/50 hover:border-white/25 hover:text-white/80',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Keyword table */}
          <div className="border border-white/8 rounded-md overflow-hidden">
            <div className="grid grid-cols-12 gap-3 px-3 py-2 bg-white/[0.02] text-white/40 text-[10px] uppercase tracking-wider font-semibold">
              <div className="col-span-5">Keyword</div>
              <div className="col-span-1 text-right">Pos</div>
              <div className="col-span-2 text-right">Volume</div>
              <div className="col-span-1 text-right">Traffic</div>
              <div className="col-span-3">SERP Features</div>
            </div>
            <div className="divide-y divide-white/5 max-h-[500px] overflow-y-auto">
              {filteredKeywords.length === 0 && (
                <div className="px-3 py-8 text-center text-white/30 text-xs">
                  No keywords match this filter.
                </div>
              )}
              {filteredKeywords.map((kw, i) => (
                <div key={i} className="grid grid-cols-12 gap-3 px-3 py-2.5 text-xs hover:bg-white/[0.02] transition-colors">
                  <div className="col-span-5 flex items-center gap-2 min-w-0">
                    <span className="text-white truncate">{kw.keyword}</span>
                    {kw.is_branded && (
                      <span className="text-[9px] text-blue-300/70 border border-blue-300/20 px-1 rounded shrink-0">brand</span>
                    )}
                  </div>
                  <div className="col-span-1 text-right text-white/70 tabular-nums">{kw.position || '—'}</div>
                  <div className="col-span-2 text-right text-white/60 tabular-nums">{kw.volume.toLocaleString()}</div>
                  <div className="col-span-1 text-right text-white/60 tabular-nums">{kw.traffic.toLocaleString()}</div>
                  <div className="col-span-3 flex items-center gap-1 flex-wrap">
                    {kw.has_ai_overview && (
                      <span className="text-[9px] bg-purple-500/15 text-purple-300 border border-purple-500/25 px-1.5 py-0.5 rounded">AI Overview</span>
                    )}
                    {kw.has_featured_snippet && (
                      <span className="text-[9px] bg-blue-500/15 text-blue-300 border border-blue-500/25 px-1.5 py-0.5 rounded">Snippet</span>
                    )}
                    {kw.has_knowledge_panel && (
                      <span className="text-[9px] bg-green-500/15 text-green-300 border border-green-500/25 px-1.5 py-0.5 rounded">Knowledge</span>
                    )}
                    {kw.url && (
                      <a href={kw.url} target="_blank" rel="noreferrer" className="ml-auto text-white/30 hover:text-white/70">
                        <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-white/25 text-[10px] mt-3">
            Sampled top {data.total_keywords_sampled} traffic-driving keywords for {data.target} · {data.country.toUpperCase()} · cached weekly · last fetched {new Date(data.fetched_at).toLocaleString()}
          </p>
        </>
      )}
    </div>
  )
}

// ── Metric card subcomponent ──────────────────────────────────────────────
interface MetricCardProps {
  icon:  React.ComponentType<{ size?: number; className?: string }>
  label: string
  value: string
  hint:  string
  tone:  'purple' | 'blue' | 'green'
}

function MetricCard({ icon: Icon, label, value, hint, tone }: MetricCardProps) {
  const toneClass = {
    purple: 'text-purple-300',
    blue:   'text-blue-300',
    green:  'text-green-300',
  }[tone]
  return (
    <div className="bg-[#0d0d0d] border border-white/8 rounded-lg p-3.5 flex flex-col">
      <div className={cn('flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold mb-1.5', toneClass)}>
        <Icon size={10} /> {label}
      </div>
      <div className="text-white font-bold text-2xl tabular-nums leading-none">{value}</div>
      <div className="text-white/30 text-[10px] mt-auto pt-2">{hint}</div>
    </div>
  )
}
