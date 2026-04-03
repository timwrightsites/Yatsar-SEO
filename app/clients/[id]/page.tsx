import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Play, RefreshCw, Globe } from 'lucide-react'
import { TrafficChart } from '@/components/charts/TrafficChart'
import { BotActivity } from '@/components/dashboard/BotActivity'
import { mockClients, mockBotConfigs, mockActivityLogs, mockMetrics } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

interface Props {
  params: Promise<{ id: string }>
}

const botMeta: Record<string, { label: string; desc: string; dot: string }> = {
  content:   { label: 'Content Bot',   desc: 'Keyword research, article drafts, content gaps',       dot: 'bg-yellow-400' },
  link:      { label: 'Link Bot',      desc: 'Outreach, guest posts, backlink opportunities',         dot: 'bg-blue-400'   },
  technical: { label: 'Technical Bot', desc: 'Site audits, speed, crawl issues',                     dot: 'bg-green-400'  },
  geo:       { label: 'GEO Bot',       desc: 'Local listings, Google Business Profile, citations',   dot: 'bg-green-500'  },
}

const statusBadge: Record<string, { label: string; className: string }> = {
  running: { label: 'Running',  className: 'border-blue-500  text-blue-400'  },
  idle:    { label: 'Idle',     className: 'border-white/15  text-white/40'  },
  paused:  { label: 'Paused',   className: 'border-yellow-500 text-yellow-400' },
  error:   { label: 'Error',    className: 'border-red-500   text-red-400'   },
}

const speedColor = (score: number) =>
  score >= 80 ? 'text-[#22c55e]' : score >= 60 ? 'text-yellow-400' : 'text-red-400'

export default async function ClientPage({ params }: Props) {
  const { id } = await params
  const client = mockClients.find((c) => c.id === id)
  if (!client) notFound()

  const bots    = mockBotConfigs.filter((b) => b.client_id === id)
  const activity = mockActivityLogs.filter((a) => a.client_id === id)
  const metrics  = mockMetrics.filter((m) => m.client_id === id)
  const latest   = metrics[metrics.length - 1]
  const prev     = metrics[metrics.length - 2]

  const trafficChange = prev && latest
    ? Math.round(((latest.organic_traffic! - prev.organic_traffic!) / prev.organic_traffic!) * 100)
    : 0

  return (
    <div className="min-h-screen bg-[#0d0d0d] px-8 py-8">

      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-white/30 text-sm hover:text-white/70 transition-all mb-6"
      >
        <ArrowLeft size={14} />
        Agency View
      </Link>

      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-baseline gap-3">
            <h1 className="text-white font-bold text-4xl">{client.name}</h1>
            <span className="text-[#22c55e] font-semibold text-base">
              ${client.monthly_retainer?.toLocaleString()}/mo
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1.5 text-white/30 text-sm">
            <Globe size={13} />
            <span>{client.domain}</span>
            {client.industry && (
              <>
                <span>·</span>
                <span>{client.industry}</span>
              </>
            )}
          </div>
        </div>
        <span className={cn(
          'text-xs border px-3 py-1 rounded-md font-medium capitalize',
          client.status === 'active'  ? 'border-[#22c55e]/40 text-[#22c55e]' :
          client.status === 'paused'  ? 'border-yellow-500/40 text-yellow-400' :
                                        'border-red-500/40 text-red-400'
        )}>
          {client.status}
        </span>
      </div>

      {/* ── Metric cards row ── */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Organic Traffic', value: latest?.organic_traffic?.toLocaleString() ?? '—', change: trafficChange },
          { label: 'Keywords Ranked', value: latest?.keywords_ranked?.toLocaleString() ?? '—' },
          { label: 'Backlinks',       value: latest?.backlinks?.toLocaleString() ?? '—' },
          { label: 'Domain Rating',   value: latest?.domain_rating ?? '—' },
        ].map(({ label, value, change }) => (
          <div key={label} className="bg-[#141414] border border-white/8 rounded-lg p-4">
            <p className="text-white/40 text-xs mb-2">{label}</p>
            <div className="flex items-end gap-2">
              <span className="text-white font-bold text-2xl">{value}</span>
              {change !== undefined && (
                <span className={cn('text-sm font-semibold pb-0.5', change >= 0 ? 'text-[#22c55e]' : 'text-red-400')}>
                  {change >= 0 ? '+' : ''}{change}%
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Chart + PageSpeed row ── */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {/* Traffic chart */}
        <div className="col-span-2 bg-[#141414] border border-white/8 rounded-lg p-5">
          <p className="text-white/40 text-xs mb-1">Organic Traffic</p>
          <p className="text-white font-semibold text-sm mb-4">Last 6 Months</p>
          <TrafficChart metrics={metrics} />
        </div>

        {/* PageSpeed + Search Console */}
        <div className="flex flex-col gap-4">
          <div className="bg-[#141414] border border-white/8 rounded-lg p-4 flex-1">
            <p className="text-white/40 text-xs mb-3">PageSpeed Score</p>
            <div className="flex gap-6">
              <div>
                <p className="text-white/30 text-[11px] mb-1">Mobile</p>
                <div className="flex items-end gap-1">
                  <span className={cn('text-3xl font-bold', speedColor(latest?.page_speed_mobile ?? 0))}>
                    {latest?.page_speed_mobile ?? '—'}
                  </span>
                  <span className="text-white/20 text-xs pb-1">/100</span>
                </div>
              </div>
              <div>
                <p className="text-white/30 text-[11px] mb-1">Desktop</p>
                <div className="flex items-end gap-1">
                  <span className={cn('text-3xl font-bold', speedColor(latest?.page_speed_desktop ?? 0))}>
                    {latest?.page_speed_desktop ?? '—'}
                  </span>
                  <span className="text-white/20 text-xs pb-1">/100</span>
                </div>
              </div>
            </div>
          </div>
          <div className="bg-[#141414] border border-white/8 rounded-lg p-4 flex-1">
            <p className="text-white/40 text-xs mb-3">Search Console</p>
            <div className="flex gap-6">
              <div>
                <p className="text-white/30 text-[11px] mb-1">Impressions</p>
                <span className="text-white font-bold text-2xl">
                  {latest?.impressions ? `${(latest.impressions / 1000).toFixed(0)}K` : '—'}
                </span>
              </div>
              <div>
                <p className="text-white/30 text-[11px] mb-1">Clicks</p>
                <span className="text-white font-bold text-2xl">
                  {latest?.clicks ? `${(latest.clicks / 1000).toFixed(1)}K` : '—'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bots row ── */}
      <div className="mb-6">
        <h2 className="text-white font-bold text-xl mb-4">Bots</h2>
        <div className="grid grid-cols-4 gap-4">
          {(['content', 'link', 'technical', 'geo'] as const).map((type) => {
            const bot  = bots.find((b) => b.bot_type === type)
            const meta = botMeta[type]
            const status = bot?.status ?? 'idle'
            const badge  = statusBadge[status]

            return (
              <div key={type} className="bg-[#141414] border border-white/8 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={cn('w-2 h-2 rounded-full shrink-0', meta.dot)} />
                    <span className="text-white font-semibold text-sm">{meta.label}</span>
                  </div>
                  <span className={cn('text-[10px] border px-2 py-0.5 rounded font-medium', badge.className)}>
                    {badge.label}
                  </span>
                </div>
                <p className="text-white/30 text-xs leading-relaxed mb-4">{meta.desc}</p>
                {bot?.last_run_at && (
                  <p className="text-white/20 text-[11px] mb-3">
                    Last run: {new Date(bot.last_run_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
                <button className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-white/60 border border-white/10 rounded-md hover:bg-white/5 hover:text-white transition-all">
                  {status === 'running'
                    ? <><RefreshCw size={11} className="animate-spin" /> Running...</>
                    : <><Play size={11} /> Run Now</>
                  }
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Bot Activity ── */}
      <BotActivity logs={activity} />
    </div>
  )
}
