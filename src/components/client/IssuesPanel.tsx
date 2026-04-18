'use client'

/**
 * IssuesPanel — the Issues tab on the client detail page.
 *
 * Visual language is a direct port of the Paperclip task-list look:
 *   • compact row cards with hover-lifted borders
 *   • left status dot, title, a row of uppercase rounded-pill chips
 *   • subtitle counts ("3 open · 2 in progress · 1 blocked · 5 resolved")
 *   • filter chip bar + search input toolbar
 *   • expand-in-place thread panel showing every run / deliverable /
 *     draft / outreach / approval tied to the issue, newest first
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Loader2,
  Search,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Zap,
  FileText,
  Pencil,
  Mail,
  CheckCircle2,
  XCircle,
  Clock,
  Send,
  CircleDot,
  CircleDashed,
  CircleCheck,
  Archive,
  AlertTriangle,
  User,
  Bot,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ───────────────────────── types (mirror API shapes) ─────────────────────

type IssueStatus   = 'open' | 'in_progress' | 'blocked' | 'resolved' | 'archived'
type IssuePriority = 'low' | 'normal' | 'high' | 'urgent'

interface IssueListItem {
  id: string
  title: string
  description: string | null
  status: IssueStatus
  priority: IssuePriority
  assignee_agent: string | null
  external_url: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
  last_activity_at: string
  counts: {
    agent_runs: number
    deliverables: number
    content_drafts: number
    outreach_threads: number
    approvals: number
    pending_review: number
    total: number
  }
}

interface IssuesResponse {
  issues: IssueListItem[]
  counts: {
    total: number
    open: number
    in_progress: number
    blocked: number
    resolved: number
    archived: number
  }
}

type ThreadEventKind =
  | 'agent_run'
  | 'deliverable'
  | 'content_draft'
  | 'outreach_thread'
  | 'approval'

interface ThreadEvent {
  kind: ThreadEventKind
  id: string
  timestamp: string
  title: string
  status: string | null
  actor: string | null
  preview: string | null
  meta: Record<string, unknown>
}

interface ThreadResponse {
  issue: {
    id: string
    title: string
    description: string | null
    status: IssueStatus
    priority: IssuePriority
    assignee_agent: string | null
    external_url: string | null
    resolved_at: string | null
    created_at: string
    updated_at: string
  }
  events: ThreadEvent[]
  counts: {
    agent_runs: number
    deliverables: number
    content_drafts: number
    outreach_threads: number
    approvals: number
    total: number
  }
}

type StatusFilter = 'all' | IssueStatus

interface Props {
  clientId: string
}

// ───────────────────────── visual helpers ─────────────────────────────────

const STATUS_META: Record<IssueStatus, { label: string; dot: string; pill: string; Icon: typeof CircleDot }> = {
  open:        { label: 'Open',        dot: 'bg-sky-400',    pill: 'text-sky-300 border-sky-400/40 bg-sky-400/10',       Icon: CircleDot },
  in_progress: { label: 'In Progress', dot: 'bg-indigo-400', pill: 'text-indigo-300 border-indigo-400/40 bg-indigo-400/10', Icon: CircleDashed },
  blocked:     { label: 'Blocked',     dot: 'bg-red-400',    pill: 'text-red-300 border-red-400/40 bg-red-400/10',       Icon: AlertTriangle },
  resolved:    { label: 'Resolved',    dot: 'bg-emerald-400',pill: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10', Icon: CircleCheck },
  archived:    { label: 'Archived',    dot: 'bg-white/20',   pill: 'text-white/40 border-white/10 bg-white/5',           Icon: Archive },
}

const PRIORITY_META: Record<IssuePriority, { label: string; cls: string }> = {
  urgent: { label: 'Urgent', cls: 'text-red-300 border-red-400/40 bg-red-400/10' },
  high:   { label: 'High',   cls: 'text-amber-300 border-amber-400/40 bg-amber-400/10' },
  normal: { label: 'Normal', cls: 'text-white/50 border-white/15 bg-white/5' },
  low:    { label: 'Low',    cls: 'text-white/35 border-white/10 bg-transparent' },
}

const EVENT_META: Record<ThreadEventKind, { label: string; Icon: typeof CircleDot; cls: string }> = {
  agent_run:       { label: 'Agent run',     Icon: Zap,      cls: 'text-indigo-300' },
  deliverable:     { label: 'Deliverable',   Icon: FileText, cls: 'text-emerald-300' },
  content_draft:   { label: 'Content draft', Icon: Pencil,   cls: 'text-sky-300' },
  outreach_thread: { label: 'Outreach',      Icon: Mail,     cls: 'text-amber-300' },
  approval:        { label: 'Approval',      Icon: CheckCircle2, cls: 'text-white/70' },
}

function relativeTime(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diff = Math.round((now - then) / 1000)
  if (diff < 60)       return 'just now'
  if (diff < 3600)     return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400)    return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400*7)  return `${Math.floor(diff / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ───────────────────────── component ──────────────────────────────────────

export function IssuesPanel({ clientId }: Props) {
  const [data, setData] = useState<IssuesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch]   = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/clients/${clientId}/issues`, { cache: 'no-store' })
        if (!res.ok) throw new Error(await res.text())
        const json = (await res.json()) as IssuesResponse
        if (alive) setData(json)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load issues')
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [clientId])

  const visible = useMemo(() => {
    if (!data) return []
    return data.issues.filter(i => {
      if (statusFilter !== 'all' && i.status !== statusFilter) return false
      if (search.trim()) {
        const needle = search.toLowerCase()
        const hay = `${i.id} ${i.title} ${i.description ?? ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [data, statusFilter, search])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-white/40 text-sm py-12 justify-center">
        <Loader2 size={14} className="animate-spin" />
        Loading issues…
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
        <CircleDashed size={28} className="text-white/20 mx-auto mb-3" />
        <p className="text-white/50 text-sm">No issues yet for this client.</p>
        <p className="text-white/30 text-xs mt-1.5">
          Issues are created automatically when an agent is dispatched against a problem.
        </p>
      </div>
    )
  }

  return (
    <div>
      {/* Subtitle counts row — Paperclip-style dot-separated status summary */}
      <div className="flex items-center gap-1.5 text-white/40 text-xs mb-4 flex-wrap">
        <span><span className="text-white/70 font-semibold">{data.counts.open}</span> open</span>
        <span>·</span>
        <span><span className="text-white/70 font-semibold">{data.counts.in_progress}</span> in progress</span>
        <span>·</span>
        <span><span className="text-white/70 font-semibold">{data.counts.blocked}</span> blocked</span>
        <span>·</span>
        <span><span className="text-white/70 font-semibold">{data.counts.resolved}</span> resolved</span>
        {data.counts.archived > 0 && (
          <>
            <span>·</span>
            <span><span className="text-white/50 font-semibold">{data.counts.archived}</span> archived</span>
          </>
        )}
      </div>

      {/* Toolbar: search + filter chips */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search issues…"
            className="bg-[#141414] border border-white/10 rounded-md pl-8 pr-3 py-1.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-indigo-400/50 transition-colors w-[220px]"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <FilterChip active={statusFilter === 'all'}         onClick={() => setStatusFilter('all')}         label="All"          count={data.counts.total} />
          <FilterChip active={statusFilter === 'open'}        onClick={() => setStatusFilter('open')}        label="Open"         count={data.counts.open} />
          <FilterChip active={statusFilter === 'in_progress'} onClick={() => setStatusFilter('in_progress')} label="In Progress"  count={data.counts.in_progress} />
          <FilterChip active={statusFilter === 'blocked'}     onClick={() => setStatusFilter('blocked')}     label="Blocked"      count={data.counts.blocked} />
          <FilterChip active={statusFilter === 'resolved'}    onClick={() => setStatusFilter('resolved')}    label="Resolved"     count={data.counts.resolved} />
          {data.counts.archived > 0 && (
            <FilterChip active={statusFilter === 'archived'} onClick={() => setStatusFilter('archived')}   label="Archived"     count={data.counts.archived} />
          )}
        </div>
      </div>

      {/* Issue list — Paperclip task-row pattern */}
      {visible.length === 0 ? (
        <div className="bg-[#141414] border border-white/8 rounded-lg p-10 text-center text-white/40 text-sm">
          No issues match these filters.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {visible.map(issue => (
            <IssueRow
              key={issue.id}
              issue={issue}
              expanded={expandedId === issue.id}
              onToggle={() => setExpandedId(expandedId === issue.id ? null : issue.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ───────────────────────── sub-components ─────────────────────────────────

function FilterChip({
  active, onClick, label, count,
}: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-2.5 py-1 rounded-full border text-[11px] font-medium uppercase tracking-wider transition-all whitespace-nowrap',
        active
          ? 'bg-indigo-500 border-indigo-500 text-white'
          : 'bg-transparent border-white/10 text-white/50 hover:border-white/25 hover:text-white/80'
      )}
    >
      {label}
      <span className={cn('ml-1.5', active ? 'text-white/80' : 'text-white/35')}>{count}</span>
    </button>
  )
}

function IssueRow({
  issue, expanded, onToggle,
}: { issue: IssueListItem; expanded: boolean; onToggle: () => void }) {
  const statusMeta = STATUS_META[issue.status]
  const priorityMeta = PRIORITY_META[issue.priority]

  const isTruIssue = /^[A-Z]+-\d+$/.test(issue.id)
  const idLabel = isTruIssue ? issue.id : null

  return (
    <div
      className={cn(
        'bg-[#141414] border border-white/8 rounded-md overflow-hidden transition-colors',
        expanded ? 'border-indigo-400/40' : 'hover:border-white/20'
      )}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-3 px-3.5 py-3 text-left"
      >
        {/* Status dot (Paperclip-style left indicator) */}
        <span className={cn('mt-1.5 w-2 h-2 rounded-full shrink-0', statusMeta.dot)} />

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            {idLabel && (
              <span className="text-[11px] font-mono font-semibold text-indigo-300/80 tracking-wider">{idLabel}</span>
            )}
            <span className="text-white text-sm font-medium truncate">{issue.title}</span>
          </div>

          {/* Chip row — uppercase rounded pills, Paperclip-style */}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <Pill className={statusMeta.pill} icon={<statusMeta.Icon size={10} />}>
              {statusMeta.label}
            </Pill>
            <Pill className={priorityMeta.cls}>
              {priorityMeta.label}
            </Pill>
            {issue.counts.pending_review > 0 && (
              <Pill className="text-amber-300 border-amber-400/40 bg-amber-400/10" icon={<Clock size={10} />}>
                {issue.counts.pending_review} pending
              </Pill>
            )}
            {issue.counts.agent_runs > 0 && (
              <MiniCounter icon={<Zap size={10} />}           count={issue.counts.agent_runs}       label="runs" />
            )}
            {issue.counts.deliverables > 0 && (
              <MiniCounter icon={<FileText size={10} />}      count={issue.counts.deliverables}     label="deliverables" />
            )}
            {issue.counts.content_drafts > 0 && (
              <MiniCounter icon={<Pencil size={10} />}        count={issue.counts.content_drafts}   label="drafts" />
            )}
            {issue.counts.outreach_threads > 0 && (
              <MiniCounter icon={<Mail size={10} />}          count={issue.counts.outreach_threads} label="emails" />
            )}
            {issue.assignee_agent && (
              <Pill className="text-white/50 border-white/10 bg-white/5" icon={<Bot size={10} />}>
                {issue.assignee_agent}
              </Pill>
            )}
          </div>
        </div>

        {/* Right-side meta */}
        <div className="flex items-center gap-3 shrink-0 pt-0.5">
          <span className="text-[11px] text-white/30 whitespace-nowrap">{relativeTime(issue.last_activity_at)}</span>
          {expanded
            ? <ChevronUp size={14} className="text-white/40" />
            : <ChevronDown size={14} className="text-white/40" />
          }
        </div>
      </button>

      {expanded && <IssueThread issueId={issue.id} description={issue.description} externalUrl={issue.external_url} />}
    </div>
  )
}

function Pill({ children, className, icon }: { children: React.ReactNode; className?: string; icon?: React.ReactNode }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-[3px] rounded-full border text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap',
      className,
    )}>
      {icon}
      {children}
    </span>
  )
}

function MiniCounter({ icon, count, label }: { icon: React.ReactNode; count: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-white/45">
      {icon}
      <span className="font-semibold text-white/75">{count}</span>
      <span>{label}</span>
    </span>
  )
}

// ───── Expanded thread ────────────────────────────────────────────────────

function IssueThread({
  issueId, description, externalUrl,
}: { issueId: string; description: string | null; externalUrl: string | null }) {
  const [thread, setThread] = useState<ThreadResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/issues/${encodeURIComponent(issueId)}`, { cache: 'no-store' })
        if (!res.ok) throw new Error(await res.text())
        const json = (await res.json()) as ThreadResponse
        if (alive) setThread(json)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load thread')
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [issueId])

  return (
    <div className="border-t border-white/8 bg-[#0f0f0f] px-4 py-4">
      {/* Issue description + link */}
      {(description || externalUrl) && (
        <div className="mb-4 pb-3 border-b border-white/5">
          {description && (
            <p className="text-white/60 text-sm leading-relaxed whitespace-pre-wrap">{description}</p>
          )}
          {externalUrl && (
            <a
              href={externalUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-200 text-xs mt-2"
            >
              <ExternalLink size={11} /> {externalUrl}
            </a>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-white/40 text-sm py-4 justify-center">
          <Loader2 size={12} className="animate-spin" /> Loading thread…
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-red-300 text-xs">{error}</div>
      )}

      {thread && thread.events.length === 0 && !loading && (
        <p className="text-white/40 text-xs text-center py-4">
          No activity recorded for this issue yet.
        </p>
      )}

      {thread && thread.events.length > 0 && (
        <div className="relative">
          {/* timeline spine */}
          <div className="absolute left-[9px] top-1 bottom-1 w-px bg-white/10" aria-hidden />
          <ol className="flex flex-col gap-3">
            {thread.events.map(ev => (
              <ThreadEventRow key={`${ev.kind}:${ev.id}`} event={ev} />
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

function EventStatusIcon({ kind, status }: { kind: ThreadEventKind; status: string }) {
  if (kind === 'approval') {
    if (status === 'approve')           return <CheckCircle2 size={10} />
    if (status === 'reject')            return <XCircle size={10} />
    if (status === 'send')              return <Send size={10} />
    if (status === 'submit_for_review') return <Clock size={10} />
  }
  if (status === 'approved')            return <CheckCircle2 size={10} />
  if (status === 'rejected')            return <XCircle size={10} />
  if (status === 'sent')                return <Send size={10} />
  if (status === 'pending_review')      return <Clock size={10} />
  return null
}

function ThreadEventRow({ event }: { event: ThreadEvent }) {
  const meta = EVENT_META[event.kind]

  return (
    <li className="relative pl-7">
      {/* timeline dot */}
      <span className={cn(
        'absolute left-0 top-1 w-[18px] h-[18px] rounded-full border border-white/15 bg-[#141414] flex items-center justify-center',
        meta.cls,
      )}>
        <meta.Icon size={10} />
      </span>

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-white/40">{meta.label}</span>
            <span className="text-white text-sm font-medium">{event.title}</span>
            {event.status && (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-white/50">
                <EventStatusIcon kind={event.kind} status={event.status} />
                {event.status.replace(/_/g, ' ')}
              </span>
            )}
          </div>
          {event.actor && (
            <div className="flex items-center gap-1 mt-0.5 text-[11px] text-white/40">
              {event.kind === 'approval' ? <User size={10} /> : <Bot size={10} />}
              {event.actor}
            </div>
          )}
          {event.preview && (
            <p className="text-white/60 text-xs mt-1.5 leading-relaxed line-clamp-3 whitespace-pre-wrap">{event.preview}</p>
          )}
        </div>
        <span className="text-[10px] text-white/30 whitespace-nowrap shrink-0">{relativeTime(event.timestamp)}</span>
      </div>
    </li>
  )
}
