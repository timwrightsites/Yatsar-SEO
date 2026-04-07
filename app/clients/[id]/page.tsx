import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Play, RefreshCw, Globe, Settings2 } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { TrafficChart } from '@/components/charts/TrafficChart'
import { BotActivity } from '@/components/dashboard/BotActivity'
import { GSCPanel } from '@/components/client/GSCPanel'
import { GSCChart } from '@/components/client/GSCChart'
import { GSCMetricCards } from '@/components/client/GSCMetricCards'
import { PageSpeedPanel } from '@/components/client/PageSpeedPanel'
import { IndexationPanel } from '@/components/client/IndexationPanel'
import { StrategyPanel } from '@/components/client/StrategyPanel'
import { AhrefsPanel } from '@/components/client/AhrefsPanel'
import { ClientConfigPanel } from '@/components/client/ClientConfigPanel'
import { ArchiveButton } from '@/components/client/ArchiveButton'
import { ContentSection } from '@/components/client/ContentSection'
import AgentPanel from '@/components/client/AgentPanel'
import { cn } from '@/lib/utils'
import type { Client, BotConfig, Metric, ActivityLog } from '@/types/database'

interface Props {
  params: Promise<{ id: string }>
  searchParams?: unknown
}

const botMeta: Record<string, { label: string; desc: string; dot: string }> = {
  content:   { label: 'Content Bot',   desc: 'Keyword research, article drafts, content gaps',     dot: 'bg-yellow-400' },
  link:      { label: 'Link Bot',      desc: 'Outreach, guest posts, backlink opportunities',       dot: 'bg-blue-400'   },
  technical: { label: 'Technical Bot', desc: 'Site audits, speed, crawl issues',                   dot: 'bg-green-400'  },
  geo:       { label: 'GEO Bot',       desc: 'Local listings, Google Business Profile, citations', dot: 'bg-green-500'  },
}

const statusBadge: Record<string, { label: string; className: string }> = {
  running: { label: 'Running', className: 'border-blue-500  text-blue-400'   },
  idle:    { label: 'Idle',    className: 'border-white/15  text-white/40'   },
  paused:  { label: 'Paused', className: 'border-yellow-500 text-yellow-400' },
  error:   { label: 'Error',  className: 'border-red-500   text-red-400'    },
}

export default async function ClientPage({ params, searchParams }: Props) {
  const { id } = await params
  const sp = await (searchParams as unknown as Promise<Record<string, string>>)
  const highlightContentId = sp?.content ?? null

  const supabase = await createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const [
    { data: client },
    { data: bots },
    { data: logs },
    { data: metrics },
    { data: drafts },
  ] = await Promise.all([
    db.from('clients').select('*').eq('id', id).single() as Promise<{ data: Client & { gsc_property: string | null; pagespeed_url: string | null } | null }>,
    db.from('bot_configs').select('*').eq('client_id', id) as Promise<{ data: BotConfig[] | null }>,
    db.from('activity_logs').select('*').eq('client_id', id).order('created_at', { ascending: false }).limit(20) as Promise<{ data: ActivityLog[] | null }>,
    db.from('metrics').select('*').eq('client_id', id).order('month') as Promise<{ data: Metric[] | null }>,
    db.from('content_drafts').select('*').eq('client_id', id).order('created_at', { ascending: false }) as Promise<{ data: unknown[] | null }>,
  ])

  if (!client) notFound()

  const safeMetrics = (metrics ?? []) as Metric[]
  const latest = safeMetrics[safeMetrics.length - 1]
  const prev   = safeMetrics[safeMetrics.length - 2]

  const trafficChange = prev && latest && prev.organic_traffic && latest.organic_traffic
    ? Math.round(((latest.organic_traffic - prev.organic_traffic) / prev.organic_traffic) * 100)
    : 0

  return (
    <div className="min-h-screen bg-[#0d0d0d] px-8 py-8">

      {/* Back */}
      <Link href="/" className="inline-flex items-center gap-1.5 text-white/30 text-sm hover:text-white/70 transition-all mb-6">
        <ArrowLeft size={14} /> Agency View
      </Link>

      {/* Header */}
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
            {client.industry && <><span>·</span><span>{client.industry}</span></>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn(
            'text-xs border px-3 py-1 rounded-md font-medium capitalize',
            client.status === 'active'   ? 'border-[#22c55e]/40 text-[#22c55e]' :
            client.status === 'paused'   ? 'border-yellow-500/40 text-yellow-400' :
            client.status === 'inactive' ? 'border-white/10 text-white/25' :
                                           'border-red-500/40 text-red-400'
          )}>
            {client.status === 'inactive' ? 'Archived' : client.status}
          </span>
          <ArchiveButton
            clientId={client.id}
            clientName={client.name}
            currentStatus={client.status}
          />
        </div>
      </div>

      {/* Metric cards — use GSC live data when no stored metrics exist */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {safeMetrics.length > 0 ? (
          <>
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
          </>
        ) : client.gsc_property ? (
          <GSCMetricCards property={client.gsc_property} />
        ) : (
          <>
            {['Organic Traffic', 'Keywords Ranked', 'Backlinks', 'Domain Rating'].map(label => (
              <div key={label} className="bg-[#141414] border border-white/8 rounded-lg p-4">
                <p className="text-white/40 text-xs mb-2">{label}</p>
                <span className="text-white/20 font-bold text-2xl">—</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Chart — GSC live data preferred, falls back to stored metrics */}
      {client.gsc_property ? (
        <GSCChart property={client.gsc_property} />
      ) : safeMetrics.length > 0 ? (
        <div className="bg-[#141414] border border-white/8 rounded-lg p-5 mb-6">
          <p className="text-white/40 text-xs mb-1">Organic Traffic</p>
          <p className="text-white font-semibold text-sm mb-4">Last 6 Months</p>
          <TrafficChart metrics={safeMetrics} />
        </div>
      ) : null}

      {/* GSC + PageSpeed — only shown when configured */}
      {client.gsc_property ? (
        <div className="mb-6">
          <GSCPanel property={client.gsc_property} />
        </div>
      ) : null}

      {/* Indexation panel — sitemap vs GSC comparison + index button */}
      {client.gsc_property && client.domain ? (
        <div className="mb-6">
          <IndexationPanel
            property={client.gsc_property}
            domain={client.domain}
          />
        </div>
      ) : null}

      {client.pagespeed_url ? (
        <div className="mb-6">
          <PageSpeedPanel url={client.pagespeed_url} />
        </div>
      ) : null}

      {/* Ahrefs panel — live via /api/ahrefs/*, falls back to mock when AHREFS_API_KEY missing */}
      {client.domain ? (
        <div className="mb-6">
          <AhrefsPanel clientId={client.id} domain={client.domain} />
        </div>
      ) : null}

      {/* Config panel — set GSC property + PageSpeed URL */}
      <div className="mb-6">
        <details className="group">
          <summary className="flex items-center gap-2 text-white/30 text-sm cursor-pointer hover:text-white/60 transition-colors list-none">
            <Settings2 size={14} />
            {client.gsc_property ? 'Edit integrations' : 'Connect GSC & PageSpeed'}
          </summary>
          <div className="mt-3">
            <ClientConfigPanel clientId={client.id} gscProperty={client.gsc_property ?? ''} pagespeedUrl={client.pagespeed_url ?? ''} />
          </div>
        </details>
      </div>

      {/* Bots */}
      <div className="mb-6">
        <h2 className="text-white font-bold text-xl mb-4">Bots</h2>
        <div className="grid grid-cols-4 gap-4">
          {(['content', 'link', 'technical', 'geo'] as const).map((type) => {
            const bot    = (bots ?? []).find((b) => b.bot_type === type)
            const meta   = botMeta[type]
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
                    : <><Play size={11} /> Run Now</>}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      <BotActivity logs={(logs ?? []) as ActivityLog[]} />

      {/* Content drafts */}
      <div className="mt-6 mb-6">
        <ContentSection
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          initialDrafts={(drafts ?? []) as any[]}
          highlightId={highlightContentId}
        />
      </div>

      {/* Strategy kanban */}
      <div className="mt-6 mb-6">
        <StrategyPanel clientId={client.id} />
      </div>

      {/* Agent Chat */}
      <div className="mt-6">
        <h2 className="text-white font-bold text-xl mb-4">AI Agents</h2>
        <AgentPanel clientId={client.id} />
      </div>
    </div>
  )
}
