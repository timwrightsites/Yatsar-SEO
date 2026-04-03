'use client'

import { useEffect, useState } from 'react'
import {
  TrendingUp, MousePointerClick, Eye, Hash, Loader2, AlertCircle,
  FileText, Search, Zap, ArrowUpDown, Smartphone, ChevronDown, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Overview     { clicks: number; impressions: number; ctr: number; position: number }
interface QueryRow     { query: string; clicks: number; impressions: number; ctr: number; position: number }
interface PageRow      { page: string;  clicks: number; impressions: number; ctr: number; position: number }
interface DeviceRow    { device: string; clicks: number; impressions: number; ctr: number; position: number }
interface ChangeRow    { query: string; currentPosition: number; prevPosition: number; change: number; clicks: number; impressions: number }
interface KeywordsByPage { page: string; keywords: QueryRow[] }

interface GSCData {
  overview:        Overview
  topQueries:      QueryRow[]
  topPages:        PageRow[]
  devices:         DeviceRow[]
  highImpLowCTR:   QueryRow[]
  highCTRLowImp:   QueryRow[]
  positionChanges: ChangeRow[]
  keywordsByPage:  KeywordsByPage[]
}

// ── Small shared components ───────────────────────────────────────────────────

function StatPill({ label, value, icon: Icon }: { label: string; value: string | number; icon: React.ElementType }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-white/30 text-[11px]"><Icon size={11} />{label}</div>
      <span className="text-white font-bold text-xl">{value}</span>
    </div>
  )
}

function TableHeader({ cols }: { cols: string[] }) {
  return (
    <div className={`grid gap-4 pb-2 border-b border-white/5 text-[10px] text-white/25 uppercase tracking-wide`}
      style={{ gridTemplateColumns: `1fr ${cols.slice(1).map(() => 'auto').join(' ')}` }}>
      {cols.map(c => <span key={c} className={c !== cols[0] ? 'text-right' : ''}>{c}</span>)}
    </div>
  )
}

function QueryTableRow({ label, cols }: { label: string; cols: (string | number)[] }) {
  return (
    <div className={`grid gap-4 py-2 border-b border-white/4 last:border-0 items-center text-xs`}
      style={{ gridTemplateColumns: `1fr ${cols.map(() => 'auto').join(' ')}` }}>
      <span className="text-white/70 truncate" title={label}>{label}</span>
      {cols.map((v, i) => <span key={i} className="text-white/50 text-right tabular-nums">{v}</span>)}
    </div>
  )
}

// ── Tab definitions ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'queries',   label: 'Queries',      icon: Search      },
  { id: 'pages',     label: 'Pages',        icon: FileText    },
  { id: 'bypage',    label: 'By Page',      icon: FileText    },
  { id: 'opps',      label: 'Opportunities',icon: Zap         },
  { id: 'changes',   label: 'Changes',      icon: ArrowUpDown },
  { id: 'devices',   label: 'Devices',      icon: Smartphone  },
] as const
type TabId = typeof TABS[number]['id']

function pathOf(url: string) {
  try { return new URL(url).pathname || '/' } catch { return url }
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function GSCPanel({ property }: { property: string }) {
  const [data, setData]     = useState<GSCData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)
  const [tab, setTab]       = useState<TabId>('queries')
  const [expandedPage, setExpandedPage] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/gsc?property=${encodeURIComponent(property)}`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d) })
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

  const mobile  = data.devices.find(d => d.device.toLowerCase() === 'mobile')
  const desktop = data.devices.find(d => d.device.toLowerCase() === 'desktop')
  const ctrGap  = mobile && desktop ? Number((desktop.ctr - mobile.ctr).toFixed(1)) : null

  return (
    <div className="bg-[#141414] border border-white/8 rounded-lg p-5">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-white font-semibold text-sm">Search Console</p>
        <span className="text-white/25 text-[11px]">Last 90 days</span>
      </div>

      {/* Overview stats */}
      <div className="grid grid-cols-4 gap-4 mb-5 pb-5 border-b border-white/5">
        <StatPill label="Clicks"       value={data.overview.clicks.toLocaleString()}                                                             icon={MousePointerClick} />
        <StatPill label="Impressions"  value={data.overview.impressions >= 1000 ? `${(data.overview.impressions/1000).toFixed(1)}K` : data.overview.impressions.toLocaleString()} icon={Eye} />
        <StatPill label="CTR"          value={`${data.overview.ctr}%`}                                                                           icon={TrendingUp} />
        <StatPill label="Avg Position" value={data.overview.position}                                                                            icon={Hash} />
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-0.5 flex-wrap mb-4">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
              tab === id ? 'bg-white/8 text-white' : 'text-white/30 hover:text-white/60'
            )}>
            <Icon size={11} />{label}
          </button>
        ))}
      </div>

      {/* ── Queries tab ── */}
      {tab === 'queries' && (
        <>
          <TableHeader cols={['Query', 'Clicks', 'Impr', 'CTR', 'Pos']} />
          {data.topQueries.slice(0, 15).map((q, i) => (
            <QueryTableRow key={i} label={q.query}
              cols={[q.clicks.toLocaleString(), q.impressions.toLocaleString(), `${q.ctr}%`, q.position]} />
          ))}
        </>
      )}

      {/* ── Pages tab ── */}
      {tab === 'pages' && (
        <>
          <TableHeader cols={['Page', 'Clicks', 'Impr', 'CTR', 'Pos']} />
          {data.topPages.slice(0, 15).map((p, i) => (
            <QueryTableRow key={i} label={pathOf(p.page)}
              cols={[p.clicks.toLocaleString(), p.impressions.toLocaleString(), `${p.ctr}%`, p.position]} />
          ))}
        </>
      )}

      {/* ── By Page tab ── */}
      {tab === 'bypage' && (
        <div className="flex flex-col gap-1">
          {data.keywordsByPage.map((pg, i) => {
            const path      = pathOf(pg.page)
            const isOpen    = expandedPage === pg.page
            const pageClicks = pg.keywords.reduce((s, k) => s + k.clicks, 0)
            return (
              <div key={i} className="border border-white/6 rounded-lg overflow-hidden">
                <button onClick={() => setExpandedPage(isOpen ? null : pg.page)}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/3 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    {isOpen ? <ChevronDown size={12} className="text-white/40 shrink-0" /> : <ChevronRight size={12} className="text-white/40 shrink-0" />}
                    <span className="text-white/70 text-xs truncate" title={path}>{path}</span>
                  </div>
                  <span className="text-white/40 text-[11px] shrink-0 ml-4">{pageClicks.toLocaleString()} clicks</span>
                </button>
                {isOpen && (
                  <div className="px-4 pb-3 border-t border-white/5">
                    <TableHeader cols={['Keyword', 'Clicks', 'CTR', 'Pos']} />
                    {pg.keywords.slice(0, 10).map((k, j) => (
                      <QueryTableRow key={j} label={k.query}
                        cols={[k.clicks.toLocaleString(), `${k.ctr}%`, k.position]} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {data.keywordsByPage.length === 0 && (
            <p className="text-white/25 text-xs py-4 text-center">No data available</p>
          )}
        </div>
      )}

      {/* ── Opportunities tab ── */}
      {tab === 'opps' && (
        <div className="flex flex-col gap-6">
          {/* High impression / low CTR */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-yellow-400 shrink-0" />
              <p className="text-white/70 text-xs font-medium">High Impressions, Low CTR</p>
              <span className="text-white/25 text-[11px]">— ranking well, title/meta needs work</span>
            </div>
            {data.highImpLowCTR.length > 0 ? (
              <>
                <TableHeader cols={['Query', 'Impr', 'CTR', 'Pos']} />
                {data.highImpLowCTR.map((q, i) => (
                  <QueryTableRow key={i} label={q.query}
                    cols={[q.impressions.toLocaleString(), `${q.ctr}%`, q.position]} />
                ))}
              </>
            ) : (
              <p className="text-white/25 text-xs py-2">No keywords match this pattern yet</p>
            )}
          </div>

          {/* High CTR / low impressions */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
              <p className="text-white/70 text-xs font-medium">High CTR, Low Impressions</p>
              <span className="text-white/25 text-[11px]">— great content, needs more reach</span>
            </div>
            {data.highCTRLowImp.length > 0 ? (
              <>
                <TableHeader cols={['Query', 'CTR', 'Impr', 'Pos']} />
                {data.highCTRLowImp.map((q, i) => (
                  <QueryTableRow key={i} label={q.query}
                    cols={[`${q.ctr}%`, q.impressions.toLocaleString(), q.position]} />
                ))}
              </>
            ) : (
              <p className="text-white/25 text-xs py-2">No keywords match this pattern yet</p>
            )}
          </div>
        </div>
      )}

      {/* ── Position Changes tab ── */}
      {tab === 'changes' && (
        <>
          <p className="text-white/25 text-[11px] mb-3">Compared to previous 90-day period. Positive = ranking improved.</p>
          {data.positionChanges.length > 0 ? (
            <>
              <TableHeader cols={['Query', 'Now', 'Prev', 'Change']} />
              {data.positionChanges.map((r, i) => (
                <div key={i}
                  className="grid gap-4 py-2 border-b border-white/4 last:border-0 items-center text-xs"
                  style={{ gridTemplateColumns: '1fr auto auto auto' }}>
                  <span className="text-white/70 truncate" title={r.query}>{r.query}</span>
                  <span className="text-white/50 text-right tabular-nums">{r.currentPosition}</span>
                  <span className="text-white/30 text-right tabular-nums">{r.prevPosition}</span>
                  <span className={cn('text-right tabular-nums font-semibold',
                    r.change > 0 ? 'text-[#22c55e]' : r.change < 0 ? 'text-red-400' : 'text-white/30')}>
                    {r.change > 0 ? `+${r.change}` : r.change}
                  </span>
                </div>
              ))}
            </>
          ) : (
            <p className="text-white/25 text-xs py-4 text-center">Not enough historical data yet — check back next period</p>
          )}
        </>
      )}

      {/* ── Devices tab ── */}
      {tab === 'devices' && (
        <div className="flex flex-col gap-4">
          {/* CTR gap callout */}
          {ctrGap !== null && (
            <div className={cn(
              'rounded-lg px-4 py-3 text-xs',
              Math.abs(ctrGap) > 2
                ? 'bg-yellow-400/5 border border-yellow-400/15 text-yellow-400/80'
                : 'bg-[#22c55e]/5 border border-[#22c55e]/15 text-[#22c55e]/80'
            )}>
              {Math.abs(ctrGap) > 2
                ? `⚠ ${Math.abs(ctrGap)}% CTR gap between desktop and mobile — likely a mobile UX or page speed issue`
                : `✓ Mobile and desktop CTR are closely aligned (${Math.abs(ctrGap)}% gap)`}
            </div>
          )}

          {/* Device table */}
          <div>
            <TableHeader cols={['Device', 'Clicks', 'Impressions', 'CTR', 'Avg Pos']} />
            {data.devices.map((d, i) => (
              <div key={i}
                className="grid gap-4 py-2 border-b border-white/4 last:border-0 items-center text-xs"
                style={{ gridTemplateColumns: '1fr auto auto auto auto' }}>
                <span className="text-white/70 capitalize">{d.device}</span>
                <span className="text-white/50 text-right tabular-nums">{d.clicks.toLocaleString()}</span>
                <span className="text-white/50 text-right tabular-nums">{d.impressions.toLocaleString()}</span>
                <span className="text-white/50 text-right tabular-nums">{d.ctr}%</span>
                <span className="text-white/50 text-right tabular-nums">{d.position}</span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
