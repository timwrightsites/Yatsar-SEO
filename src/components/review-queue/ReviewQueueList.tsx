'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  CheckCircle2,
  XCircle,
  FileText,
  Mail,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Loader2,
  Inbox,
  ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type SourceType = 'deliverable' | 'content_draft' | 'outreach_thread'

interface ReviewItem {
  source_type: SourceType
  source_id: string
  title: string
  type_label: string
  preview: string
  submitted_at: string | null
  created_at: string
  author_agent: string | null
  client: { id: string; name: string | null; domain: string | null } | null
  issue: { id: string; title: string | null } | null
  payload: {
    content_md?: string | null
    body_html?: string | null
    body_md?: string | null
    external_url?: string | null
    target_url?: string | null
    target_keyword?: string | null
    to_email?: string | null
    from_email?: string | null
    type?: string | null
  }
}

interface ReviewQueuePayload {
  items: ReviewItem[]
  counts: {
    total: number
    deliverables: number
    content_drafts: number
    outreach_threads: number
  }
}

type FilterKey = 'all' | 'deliverable' | 'content_draft' | 'outreach_thread'

export function ReviewQueueList() {
  const [data, setData] = useState<ReviewQueuePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/review-queue', { cache: 'no-store' })
      if (!res.ok) throw new Error(await res.text())
      const payload = (await res.json()) as ReviewQueuePayload
      setData(payload)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load review queue')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const visible = useMemo(() => {
    if (!data) return []
    if (filter === 'all') return data.items
    return data.items.filter(i => i.source_type === filter)
  }, [data, filter])

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 text-white/40 text-sm py-12 justify-center">
        <Loader2 size={14} className="animate-spin" />
        Loading review queue…
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
        <p className="text-white/60 font-medium">All clear</p>
        <p className="text-white/30 text-sm mt-1">
          No items waiting for review. Agents will drop drafts here as they need your sign-off.
        </p>
      </div>
    )
  }

  return (
    <div>
      {/* Filter chips */}
      <div className="flex items-center gap-2 mb-6">
        <FilterChip active={filter === 'all'}             onClick={() => setFilter('all')}             label="All"           count={data.counts.total} />
        <FilterChip active={filter === 'content_draft'}   onClick={() => setFilter('content_draft')}   label="Content"       count={data.counts.content_drafts} />
        <FilterChip active={filter === 'outreach_thread'} onClick={() => setFilter('outreach_thread')} label="Outreach"      count={data.counts.outreach_threads} />
        <FilterChip active={filter === 'deliverable'}     onClick={() => setFilter('deliverable')}     label="Deliverables"  count={data.counts.deliverables} />
      </div>

      {/* Items */}
      <div className="space-y-2">
        {visible.map(item => (
          <ReviewCard
            key={`${item.source_type}:${item.source_id}`}
            item={item}
            expanded={expandedId === `${item.source_type}:${item.source_id}`}
            onToggle={() =>
              setExpandedId(prev =>
                prev === `${item.source_type}:${item.source_id}`
                  ? null
                  : `${item.source_type}:${item.source_id}`,
              )
            }
            onAfterAction={() => {
              setExpandedId(null)
              load()
            }}
          />
        ))}
        {visible.length === 0 && (
          <div className="text-white/30 text-sm py-8 text-center">
            Nothing in this filter.
          </div>
        )}
      </div>
    </div>
  )
}

// ── Filter chip ─────────────────────────────────────────────────────────────

function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border transition-all',
        active
          ? 'bg-white/10 border-white/20 text-white'
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

// ── Review card ─────────────────────────────────────────────────────────────

function ReviewCard({
  item,
  expanded,
  onToggle,
  onAfterAction,
}: {
  item: ReviewItem
  expanded: boolean
  onToggle: () => void
  onAfterAction: () => void
}) {
  const Icon = iconFor(item.source_type)
  const accent = accentFor(item.source_type)

  const [editedBody, setEditedBody] = useState<string>(() => initialBody(item))
  const [rejectNotes, setRejectNotes] = useState('')
  const [mode, setMode] = useState<'idle' | 'rejecting' | 'working'>('idle')
  const [err, setErr] = useState<string | null>(null)

  async function approve() {
    setMode('working')
    setErr(null)
    try {
      const res = await fetch('/api/review-queue/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type: item.source_type,
          source_id: item.source_id,
          edited_body: editedBody !== initialBody(item) ? editedBody : undefined,
        }),
      })
      if (!res.ok) throw new Error(await extractError(res))
      onAfterAction()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to approve')
      setMode('idle')
    }
  }

  async function reject() {
    if (!rejectNotes.trim()) {
      setErr('Reviewer notes are required when rejecting.')
      return
    }
    setMode('working')
    setErr(null)
    try {
      const res = await fetch('/api/review-queue/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type: item.source_type,
          source_id: item.source_id,
          notes: rejectNotes.trim(),
        }),
      })
      if (!res.ok) throw new Error(await extractError(res))
      onAfterAction()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to reject')
      setMode('idle')
    }
  }

  return (
    <div className={cn(
      'bg-[#141414] border rounded-lg overflow-hidden transition-colors',
      expanded ? 'border-white/20' : 'border-white/8 hover:border-white/15',
    )}>
      {/* Header row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-4 py-3 text-left"
      >
        <div className={cn('w-8 h-8 rounded-md flex items-center justify-center shrink-0 border', accent.bg, accent.border)}>
          <Icon size={14} className={accent.text} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-white font-medium text-sm truncate">
              {item.title}
            </span>
            <span className={cn('text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded', accent.chipBg, accent.chipText)}>
              {item.type_label}
            </span>
            {item.issue && (
              <span className="text-[11px] text-white/40 font-mono shrink-0">
                {item.issue.id}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-white/40">
            {item.client && (
              <Link
                href={`/clients/${item.client.id}`}
                onClick={e => e.stopPropagation()}
                className="hover:text-white/70 transition-colors"
              >
                {item.client.name ?? item.client.domain ?? 'Unknown client'}
              </Link>
            )}
            {item.author_agent && <><span>·</span><span className="capitalize">{item.author_agent}</span></>}
            <span>·</span>
            <span>{formatRelative(item.submitted_at ?? item.created_at)}</span>
          </div>
        </div>

        {expanded
          ? <ChevronUp   size={16} className="text-white/30 shrink-0" />
          : <ChevronDown size={16} className="text-white/30 shrink-0" />}
      </button>

      {/* Collapsed preview */}
      {!expanded && item.preview && (
        <div className="px-4 pb-3 text-xs text-white/40 line-clamp-1">
          {item.preview}
        </div>
      )}

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-white/5 pt-4 space-y-4">
          {/* Source-specific metadata */}
          <SourceMeta item={item} />

          {/* Editable body */}
          <div>
            <label className="text-white/50 text-xs font-medium mb-1.5 block">
              {bodyLabel(item.source_type)}
            </label>
            <textarea
              value={editedBody}
              onChange={e => setEditedBody(e.target.value)}
              rows={12}
              className="w-full bg-[#0d0d0d] border border-white/10 rounded-md px-3 py-2 text-sm text-white/90 font-mono leading-relaxed focus:outline-none focus:border-white/30 resize-y"
              spellCheck={false}
            />
            {item.source_type === 'content_draft' && (
              <p className="text-[11px] text-white/30 mt-1">
                Editing raw HTML. A rich editor is coming — for now, tweak copy in place and approve.
              </p>
            )}
          </div>

          {/* Reject mode */}
          {mode === 'rejecting' && (
            <div>
              <label className="text-white/50 text-xs font-medium mb-1.5 block">
                Reviewer notes (required)
              </label>
              <textarea
                value={rejectNotes}
                onChange={e => setRejectNotes(e.target.value)}
                rows={3}
                placeholder="Tell the agent what to fix so the next version is better."
                className="w-full bg-[#0d0d0d] border border-white/10 rounded-md px-3 py-2 text-sm text-white/90 focus:outline-none focus:border-white/30"
              />
            </div>
          )}

          {err && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2 text-xs text-red-300">
              {err}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2 text-xs text-white/30">
              {item.payload.external_url && (
                <a
                  href={item.payload.external_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-white/70"
                >
                  <ExternalLink size={11} /> Open source
                </a>
              )}
            </div>
            <div className="flex items-center gap-2">
              {mode === 'rejecting' ? (
                <>
                  <button
                    onClick={() => { setMode('idle'); setErr(null); setRejectNotes('') }}
                    className="px-3 py-1.5 rounded-md text-xs font-medium text-white/60 hover:text-white/90 hover:bg-white/5"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={reject}
                    disabled={mode !== 'rejecting'}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-red-500/15 border border-red-500/30 text-red-300 hover:bg-red-500/25"
                  >
                    <XCircle size={13} /> Confirm reject
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setMode('rejecting')}
                    disabled={mode === 'working'}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white/60 hover:text-white hover:bg-white/5 disabled:opacity-40"
                  >
                    <XCircle size={13} /> Reject
                  </button>
                  <button
                    onClick={approve}
                    disabled={mode === 'working'}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#22c55e]/15 border border-[#22c55e]/30 text-[#4ade80] hover:bg-[#22c55e]/25 disabled:opacity-40"
                  >
                    {mode === 'working'
                      ? <Loader2 size={13} className="animate-spin" />
                      : <CheckCircle2 size={13} />}
                    Approve
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Source-specific metadata strip ──────────────────────────────────────────

function SourceMeta({ item }: { item: ReviewItem }) {
  if (item.source_type === 'outreach_thread') {
    return (
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
        <MetaRow label="To"   value={item.payload.to_email   ?? '—'} />
        <MetaRow label="From" value={item.payload.from_email ?? '—'} />
      </div>
    )
  }
  if (item.source_type === 'content_draft') {
    return (
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
        <MetaRow label="Target URL"     value={item.payload.target_url     ?? '—'} />
        <MetaRow label="Target keyword" value={item.payload.target_keyword ?? '—'} />
      </div>
    )
  }
  return null
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-white/30 shrink-0">{label}:</span>
      <span className="text-white/70 truncate">{value}</span>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function initialBody(item: ReviewItem): string {
  if (item.source_type === 'deliverable')     return item.payload.content_md ?? ''
  if (item.source_type === 'content_draft')   return item.payload.body_html  ?? ''
  if (item.source_type === 'outreach_thread') return item.payload.body_md    ?? ''
  return ''
}

function bodyLabel(t: SourceType): string {
  if (t === 'deliverable')     return 'Content (markdown)'
  if (t === 'content_draft')   return 'Body (HTML)'
  if (t === 'outreach_thread') return 'Email body (markdown)'
  return 'Body'
}

function iconFor(t: SourceType) {
  if (t === 'content_draft')   return FileText
  if (t === 'outreach_thread') return Mail
  return ClipboardList
}

function accentFor(t: SourceType) {
  if (t === 'content_draft') {
    return {
      bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-300',
      chipBg: 'bg-blue-500/10', chipText: 'text-blue-300',
    }
  }
  if (t === 'outreach_thread') {
    return {
      bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-300',
      chipBg: 'bg-purple-500/10', chipText: 'text-purple-300',
    }
  }
  return {
    bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-300',
    chipBg: 'bg-amber-500/10', chipText: 'text-amber-300',
  }
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

async function extractError(res: Response): Promise<string> {
  try {
    const j = await res.json()
    if (typeof j?.error === 'string') return j.error
  } catch {}
  return `HTTP ${res.status}`
}
