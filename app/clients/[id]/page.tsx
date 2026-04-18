import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Globe, Settings2 } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { BotActivity } from '@/components/dashboard/BotActivity'
import { GSCPanel } from '@/components/client/GSCPanel'
import { GSCChart } from '@/components/client/GSCChart'
import { GSCMetricCards } from '@/components/client/GSCMetricCards'
import { PageSpeedPanel } from '@/components/client/PageSpeedPanel'
import { IndexationPanel } from '@/components/client/IndexationPanel'
import { AISummary } from '@/components/client/AISummary'
import { AhrefsPanel } from '@/components/client/AhrefsPanel'
import { CompetitorPanel } from '@/components/client/CompetitorPanel'
import { GeoPanel } from '@/components/client/GeoPanel'
import { ClientConfigPanel } from '@/components/client/ClientConfigPanel'
import { ArchiveButton } from '@/components/client/ArchiveButton'
import { ClientTabs, isTabKey, type TabKey } from '@/components/client/ClientTabs'
import AgentPanel from '@/components/client/AgentPanel'
import { BotRunsPanel } from '@/components/client/BotRunsPanel'
import { DeliverablesPanel } from '@/components/client/DeliverablesPanel'
import { IssuesPanel } from '@/components/client/IssuesPanel'
import { TasksPanel } from '@/components/tasks/TasksPanel'
import { cn } from '@/lib/utils'
import type { Client, ActivityLog } from '@/types/database'

interface Props {
  params: Promise<{ id: string }>
  searchParams?: unknown
}

export default async function ClientPage({ params, searchParams }: Props) {
  const { id } = await params
  const sp = await (searchParams as unknown as Promise<Record<string, string>>)
  const activeTab: TabKey = isTabKey(sp?.tab) ? sp.tab : 'overview'

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const [{ data: client }, { data: logs }] = await Promise.all([
    db.from('clients').select('*').eq('id', id).single() as Promise<{ data: Client & { gsc_property: string | null; pagespeed_url: string | null } | null }>,
    db.from('activity_logs').select('*').eq('client_id', id).order('created_at', { ascending: false }).limit(20) as Promise<{ data: ActivityLog[] | null }>,
  ])

  if (!client) notFound()

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
            {client.monthly_retainer != null && (
              <span className="text-[#22c55e] font-semibold text-base">
                ${client.monthly_retainer.toLocaleString()}/mo
              </span>
            )}
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
            currentStatus={client.status ?? 'active'}
          />
        </div>
      </div>

      {/* Tab navigation */}
      <ClientTabs clientId={client.id} active={activeTab} />

      {/* ─── OVERVIEW TAB ─────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <>
          {/* AI Status Briefing */}
          <AISummary clientId={client.id} />

          {/* Metric cards — GSC live data when property is connected */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            {client.gsc_property ? (
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

          {/* Chart */}
          {client.gsc_property && <GSCChart property={client.gsc_property} />}

          {/* Recent agent activity */}
          <BotActivity logs={(logs ?? []) as ActivityLog[]} />
        </>
      )}

      {/* ─── TASKS TAB ────────────────────────────────────────────── */}
      {activeTab === 'tasks' && (
        <div className="mb-6">
          <TasksPanel clientId={client.id} heading="Tasks" />
        </div>
      )}

      {/* ─── SEO DATA TAB ─────────────────────────────────────────── */}
      {activeTab === 'seo' && (
        <>
          {client.gsc_property && (
            <div className="mb-6">
              <GSCPanel property={client.gsc_property} />
            </div>
          )}

          {client.gsc_property && client.domain && (
            <div className="mb-6">
              <IndexationPanel property={client.gsc_property} domain={client.domain} />
            </div>
          )}

          {client.pagespeed_url && (
            <div className="mb-6">
              <PageSpeedPanel url={client.pagespeed_url} />
            </div>
          )}

          {client.domain && (
            <div className="mb-6">
              <AhrefsPanel clientId={client.id} domain={client.domain} />
            </div>
          )}

          <div className="mb-6">
            <CompetitorPanel clientId={client.id} />
          </div>

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
        </>
      )}

      {/* ─── GEO TAB ──────────────────────────────────────────────── */}
      {activeTab === 'geo' && (
        <div className="mb-6">
          {client.domain ? (
            <GeoPanel clientId={client.id} domain={client.domain} />
          ) : (
            <div className="bg-[#141414] border border-white/8 rounded-lg p-8 text-center text-white/40 text-sm">
              Add a domain to this client to load GEO visibility data.
            </div>
          )}
        </div>
      )}

      {/* ─── ISSUES TAB ───────────────────────────────────────────── */}
      {activeTab === 'issues' && (
        <div className="mb-6">
          <IssuesPanel clientId={client.id} />
        </div>
      )}

      {/* ─── DELIVERABLES TAB ─────────────────────────────────────── */}
      {activeTab === 'deliverables' && (
        <div className="mb-6">
          <DeliverablesPanel clientId={client.id} />
        </div>
      )}

      {/* ─── BOT RUNS TAB ─────────────────────────────────────────── */}
      {activeTab === 'runs' && (
        <div className="mb-6">
          <BotRunsPanel clientId={client.id} />
        </div>
      )}

      {/* ─── CHAT TAB ─────────────────────────────────────────────── */}
      {activeTab === 'chat' && (
        <div>
          <h2 className="text-white font-bold text-xl mb-4">AI Agents</h2>
          <AgentPanel clientId={client.id} />
        </div>
      )}
    </div>
  )
}
