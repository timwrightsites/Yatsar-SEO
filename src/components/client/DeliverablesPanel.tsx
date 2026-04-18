'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  FileText,
  Link2,
  Search,
  Lightbulb,
  Target,
  Map,
  BarChart3,
  Sparkles,
  FileSearch,
  Clock,
  CheckCircle2,
  XCircle,
  Send,
  Pencil,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  Inbox,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type DeliverableStatus =
  | 'draft' | 'pending_review' | 'approved' | 'rejected' | 'sent' | 'archived'

interface Deliverable {
  id: string
  issue_id: string | null
  issue_title: string | null
  type: string
  title: string
  content_md: string | null
  external_url: string | null
  status: DeliverableStatus
  author_agent: string | null
  reviewer_notes: string | null
  submitted_for_review_at: string | null
  approved_at: string | null
  rejected_at: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
}

interface DeliverablesResponse {
  deliverables: Deliverable[]
  counts: {
    total: number
    pending_review: number
    approved: number
    sent: number
    rejected: number
    draft: number
  }
}

type StatusFilter = 'all' | DeliverableStatus

interface Props {
  clientId: string
}

export function DeliverablesPanel({ clientId }: Props) {
  const [data, setData] = useState<DeliverablesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/clients/${clientId}/deliverables`, { cache: 'no-store' })
        if (!res.ok) throw new Error(await res.text())
        const json = (await res.json()) as DeliverablesResponse
        if (alive) setData(json)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load deliverables')
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [clientId])

  const visible = useMemo(() => {
    if (!data) return []
    if (statusFilter === 'all') return data.deliverables
    return data.deliverables.filter(d => d.status === statusFilter)
  }, [data, statusFilter])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-white/40 text-sm py-12 justify-center">
        <Loader2 size={14} className="animate-spin" />
        Loading deliverables…
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-300 text-sm">
        {error}
      </div>
    )
  }

  if (!data || data.counts.total === 0) {
    return (
      <div className="bg-[#141414] border border-white/8 rounded-lg p-12 text-center">
        <Inbox size={28} className="mx-auto text-white/20 mb-3" />
        <p className="text-white/60 font-medium">No deliverables yet</p>
        <p className="text-white/30 text-sm mt-1">
          Strategic plans, audit reports, briefs and recap docs will appear here as agents produce them.
        </p>
      </div>
    )
  }

  return (
    <div>
      {/* Status filters */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <FilterChip active={statusFilter === 'all'}            onClick={() => setStatusFilter('all')}            label="All"      count={data.counts.total} />
        <FilterChip active={statusFilter === 'pending_review'} onClick={() => setStatusFilter('pending_review')} label="Pending"  count={data.counts.pending_review} tone="amber" />
        <FilterChip active={statusFilter === 'approved'}       onClick={() => setStatusFilter('approved')}       label="Approved" count={data.counts.approved}       tone="green" />
        <FilterChip active={statusFilter === 'sent'}           onClick={() => setStatusFilter('sent')}           label="Sent"     count={data.counts.sent}           tone="blue"  />
        <FilterChip active={statusFilter === 'rejected'}       onClick={() => setStatusFilter('rejected')}       label="Rejected" count={data.counts.rejected}       tone="red"   />
        <FilterChip active={statusFilter === 'draft'}          onClick={() => setStatusFilter('draft')}          label="Draft"    count={data.counts.draft} />
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {visible.map(d => (
          <DeliverableCard
            key={d.id}
            deliverable={d}
            expanded={expandedId === d.id}
            onToggle={() => setExpandedId(prev => prev === d.id ? null : d.id)}
          />
        ))}
        {visible.length === 0 && (
          <div className="text-white/30 text-sm py-8 text-center">
            No deliverables match this filter.
          </div>
        )}
      </div>
    </div>
  )
}

// ── Filter chip ─────────────────────────────────────────────────────────────

type Tone = 'default' | 'amber' | 'green' | 'blue' | 'red'

function FilterChip({
  active,
  onClick,
  label,
  count,
  tone = 'default',
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
  tone?: Tone
}) {
  const toneRing = {
    default: 'border-white/20',
    amber  : 'border-amber-500/40',
    green  : 'border-[#22c55e]/40',
    blue   : 'border-blue-500/40',
    red    : 'border-red-500/40',
  }[tone]

  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border transition-all',
        active
          ? cn('bg-white/10 text-white', toneRing)
          : 'bg-[#141414] border-white/8 text-white/50 hover:text-white/80 hover:border-white/15',
      )}
    >
      {label}
      <span className={cn('text-[11px]', active ? 'text-white/60' : 'text-white/30')}>
        {count}
      </span>
    </button>
  )
}

// ── Deliverable card ────────────────────────────────────────────────────────

function DeliverableCard({
  deliverable: d,
  expanded,
  onToggle,
}: {
  deliverable: Deliverable
  expanded: boolean
  onToggle: () => void
}) {
  const Icon = iconForType(d.type)

  return (
    <div className={cn(
      'bg-[#141414] border rounded-lg overflow-hidden transition-colors',
      expanded ? 'border-white/20' : 'border-white/8 hover:border-white/15',
    )}>
      <button onClick={onToggle} className="w-full flex items-center gap-4 px-4 py-3 text-left">
        <div className="w-8 h-8 rounded-md flex items-center justify-center shrink-0 bg-white/5 border border-white/10">
          <Icon size={14} className="text-white/70" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-medium text-sm truncate">
              {d.title}
            </span>
            <StatusPill status={d.status} />
            {d.issue_id && (
              <span className="text-[11px] text-white/40 font-mono">
                {d.issue_id}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-white/40 flex-wrap">
            <span>{humanizeType(d.type)}</span>
            {d.author_agent && <><span>·</span><span className="capitalize">{d.author_agent}</span></>}
            <span>·</span>
            <span>{formatRelative(mostRecentDate(d))}</span>
          </div>
        </div>

        {expanded
          ? <ChevronUp   size={16} className="text-white/30 shrink-0" />
          : <ChevronDown size={16} className="text-white/30 shrink-0" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-white/5 pt-4 space-y-4">
          {d.reviewer_notes && (
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-md px-3 py-2">
              <p className="text-amber-300/80 text-[11px] font-semibold uppercase tracking-wide mb-1">
                Reviewer notes
              </p>
              <p className="text-amber-100/90 text-sm whitespace-pre-wrap">{d.reviewer_notes}</p>
            </div>
          )}

          {d.content_md ? (
            <div>
              <p className="text-white/50 text-xs font-medium mb-1.5">Content</p>
              <pre className="bg-[#0d0d0d] border border-white/10 rounded-md px-3 py-2 text-sm text-white/90 font-mono leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
                {d.content_md}
              </pre>
            </div>
          ) : (
            <p className="text-white/30 text-xs italic">
              No inline content — open the external source below.
            </p>
          )}

          <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
            <div className="flex items-center gap-3 text-xs text-white/30 flex-wrap">
              <span>Created {new Date(d.created_at).toLocaleDateString()}</span>
              {d.approved_at && <span>· Approved {new Date(d.approved_at).toLocaleDateString()}</span>}
              {d.sent_at     && <span>· Sent {new Date(d.sent_at).toLocaleDateString()}</span>}
            </div>
            <div className="flex items-center gap-2">
              {d.external_url && (
                <a
                  href={d.external_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white/60 hover:text-white hover:bg-white/5"
                >
                  <ExternalLink size={12} /> Open source
                </a>
              )}
              {d.status === 'pending_review' && (
                <Link
                  href="/review-queue"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25"
                >
                  <Pencil size={12} /> Review
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Status pill ─────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: DeliverableStatus }) {
  const config = {
    draft          : { label: 'Draft',    cls: 'bg-white/5 text-white/50 border-white/10',          icon: Pencil      },
    pending_review : { label: 'Pending',  cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30',  icon: Clock       },
    approved       : { label: 'Approved', cls: 'bg-[#22c55e]/10 text-[#4ade80] border-[#22c55e]/30', icon: CheckCircle2 },
    rejected       : { label: 'Rejected', cls: 'bg-red-500/10 text-red-300 border-red-500/30',        icon: XCircle     },
    sent           : { label: 'Sent',     cls: 'bg-blue-500/10 text-blue-300 border-blue-500/30',     icon: Send        },
    archived       : { label: 'Archived', cls: 'bg-white/5 text-white/30 border-white/10',            icon: Inbox       },
  }[status]
  const Icon = config.icon
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border',
      config.cls,
    )}>
      <Icon size={9} />
      {config.label}
    </span>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function iconForType(type: string) {
  switch (type) {
    case 'backlink_plan'    : return Link2
    case 'acquisition_plan' : return Target
    case 'audit_report'     : return FileSearch
    case 'content_brief'    : return FileText
    case 'strategy_doc'     : return Lightbulb
    case 'keyword_research' : return Search
    case 'competitor_brief' : return BarChart3
    case 'geo_plan'         : return Map
    case 'recap_report'     : return BarChart3
    default                 : return Sparkles
  }
}

function humanizeType(t: string): string {
  switch (t) {
    case 'backlink_plan'    : return 'Backlink plan'
    case 'acquisition_plan' : return 'Acquisition plan'
    case 'audit_report'     : return 'Audit report'
    case 'content_brief'    : return 'Content brief'
    case 'strategy_doc'     : return 'Strategy doc'
    case 'keyword_research' : return 'Keyword research'
    case 'competitor_brief' : return 'Competitor brief'
    case 'geo_plan'         : return 'GEO plan'
    case 'recap_report'     : return 'Recap report'
    default                 : return 'Deliverable'
  }
}

function mostRecentDate(d: Deliverable): string {
  return d.sent_at ?? d.approved_at ?? d.rejected_at ?? d.submitted_for_review_at ?? d.updated_at ?? d.created_at
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60)    return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60)    return `${min}m ago`
  const hr  = Math.floor(min / 60)
  if (hr < 24)     return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7)     return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}
