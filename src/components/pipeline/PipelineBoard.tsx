'use client'

/**
 * PipelineBoard — agency-wide kanban of strategy_tasks grouped by status.
 *
 * Columns (left-to-right): To do → In progress → Needs approval →
 *                          Blocked → Done
 *
 * Interaction:
 *   • HTML5 native drag-and-drop (no extra dependency).
 *   • Drop a card into a different column → status change is applied
 *     optimistically, PATCH /api/tasks/[id] is fired, rolled back on
 *     error (with a toast-less inline error bar at the top of the
 *     board).
 *   • If the drop target equals the card's current column, nothing
 *     happens.
 *
 * Filters (toolbar):
 *   • Search (title fuzzy)
 *   • Client selector (dropdown, populated from /api/clients)
 *   • Priority selector (all / urgent / high / normal / low)
 *
 * Within-column ordering (stable, client-side):
 *   1. priority desc (urgent > high > normal > low)
 *   2. scheduled_for asc (nulls last)
 *   3. created_at desc
 *
 * Cards deep-link to the per-client Tasks tab on click (drag cancels
 * the navigation via a small `didDrag` ref).
 */

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2,
  Search,
  AlertTriangle,
  CalendarDays,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────

type TaskStatus   = 'todo' | 'in_progress' | 'needs_approval' | 'done' | 'blocked'
type TaskPriority = 'urgent' | 'high' | 'normal' | 'low'

interface TaskItem {
  id:            string
  client_id:     string
  client_name:   string | null
  title:         string
  description:   string | null
  type:          string | null
  status:        TaskStatus
  priority:      TaskPriority
  scheduled_for: string | null
  completed_at:  string | null
  notes:         string | null
  created_at:    string
  updated_at:    string
}

interface ClientOption { id: string; name: string }

// ── Columns ────────────────────────────────────────────────────────────

const COLUMNS: { key: TaskStatus; label: string; dot: string; accent: string }[] = [
  { key: 'todo',           label: 'To do',          dot: 'bg-white/40',    accent: 'border-white/10'          },
  { key: 'in_progress',    label: 'In progress',    dot: 'bg-indigo-400',  accent: 'border-indigo-400/30'     },
  { key: 'needs_approval', label: 'Needs approval', dot: 'bg-amber-400',   accent: 'border-amber-400/30'      },
  { key: 'blocked',        label: 'Blocked',        dot: 'bg-rose-400',    accent: 'border-rose-400/30'       },
  { key: 'done',           label: 'Done',           dot: 'bg-emerald-400', accent: 'border-emerald-400/30'    },
]

const PRIORITY_META: Record<TaskPriority, { label: string; pill: string; rank: number }> = {
  urgent: { label: 'Urgent', pill: 'bg-rose-500/15  text-rose-200  border-rose-400/30',  rank: 4 },
  high:   { label: 'High',   pill: 'bg-amber-500/15 text-amber-200 border-amber-400/30', rank: 3 },
  normal: { label: 'Normal', pill: 'bg-white/5      text-white/55  border-white/10',     rank: 2 },
  low:    { label: 'Low',    pill: 'bg-white/5      text-white/40  border-white/10',     rank: 1 },
}

// ── Helpers ────────────────────────────────────────────────────────────

function formatDue(iso: string | null): { label: string; overdue: boolean } | null {
  if (!iso) return null
  const d       = new Date(iso)
  const today   = new Date()
  const diffMs  = d.getTime() - today.getTime()
  const overdue = diffMs < 0
  const days    = Math.round(Math.abs(diffMs) / 86_400_000)
  let label: string
  if (overdue && days === 0) label = 'due today'
  else if (overdue)          label = `${days}d overdue`
  else if (days === 0)       label = 'due today'
  else if (days === 1)       label = 'due tomorrow'
  else if (days < 7)         label = `in ${days}d`
  else                       label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return { label, overdue }
}

function comparePipeline(a: TaskItem, b: TaskItem): number {
  const pa = PRIORITY_META[a.priority]?.rank ?? 0
  const pb = PRIORITY_META[b.priority]?.rank ?? 0
  if (pa !== pb) return pb - pa
  const sa = a.scheduled_for ? new Date(a.scheduled_for).getTime() : Infinity
  const sb = b.scheduled_for ? new Date(b.scheduled_for).getTime() : Infinity
  if (sa !== sb) return sa - sb
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
}

// ── Main board ─────────────────────────────────────────────────────────

export function PipelineBoard() {
  const [tasks,      setTasks]      = useState<TaskItem[]>([])
  const [clients,    setClients]    = useState<ClientOption[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)

  // Filters
  const [search,     setSearch]     = useState('')
  const [clientId,   setClientId]   = useState<'all' | string>('all')
  const [priority,   setPriority]   = useState<'all' | TaskPriority>('all')

  // Drag state
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null)

  // Load clients (for filter dropdown).
  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/clients')
        if (!res.ok) return
        const data = await res.json() as { clients?: ClientOption[] } | ClientOption[]
        const list = Array.isArray(data) ? data : (data.clients ?? [])
        setClients(list.map(c => ({ id: c.id, name: c.name })))
      } catch { /* non-fatal; dropdown just stays empty */ }
    })()
  }, [])

  // Load tasks (re-fires when the client filter changes; status /
  // priority / search are all applied client-side since we already
  // have the full list).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const qs = new URLSearchParams({ limit: '500' })
        if (clientId !== 'all') qs.set('client_id', clientId)
        const res = await fetch(`/api/tasks?${qs.toString()}`, { cache: 'no-store' })
        if (!res.ok) throw new Error(`Failed to load tasks (${res.status})`)
        const data = await res.json() as { tasks: TaskItem[] }
        if (!cancelled) setTasks(data.tasks ?? [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load tasks')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [clientId])

  // Apply search + priority filters + group by column.
  const columns = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = tasks.filter(t => {
      if (priority !== 'all' && t.priority !== priority) return false
      if (q && !t.title.toLowerCase().includes(q))       return false
      return true
    })
    const grouped: Record<TaskStatus, TaskItem[]> = {
      todo: [], in_progress: [], needs_approval: [], blocked: [], done: [],
    }
    for (const t of filtered) grouped[t.status]?.push(t)
    for (const k of Object.keys(grouped) as TaskStatus[]) grouped[k].sort(comparePipeline)
    return grouped
  }, [tasks, search, priority])

  // ── Drag handlers ─────────────────────────────────────────────────────

  function handleDragStart(e: React.DragEvent<HTMLDivElement>, taskId: string) {
    setDraggingId(taskId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', taskId)
  }

  function handleDragEnd() {
    setDraggingId(null)
    setDropTarget(null)
  }

  function handleColumnDragOver(e: React.DragEvent<HTMLDivElement>, col: TaskStatus) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dropTarget !== col) setDropTarget(col)
  }

  async function handleColumnDrop(
    e: React.DragEvent<HTMLDivElement>,
    targetStatus: TaskStatus,
  ) {
    e.preventDefault()
    const taskId = e.dataTransfer.getData('text/plain') || draggingId
    setDraggingId(null)
    setDropTarget(null)
    if (!taskId) return
    await moveTask(taskId, targetStatus)
  }

  async function moveTask(taskId: string, targetStatus: TaskStatus) {
    const before = tasks
    const moved  = before.find(t => t.id === taskId)
    if (!moved || moved.status === targetStatus) return

    // Optimistic update.
    setTasks(ts => ts.map(t => t.id === taskId ? { ...t, status: targetStatus } : t))

    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: targetStatus }),
      })
      if (!res.ok) throw new Error(`PATCH failed (${res.status})`)
    } catch (e) {
      // Rollback.
      setTasks(before)
      setError(e instanceof Error ? e.message : 'Failed to move card')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  const totalVisible = Object.values(columns).reduce((n, arr) => n + arr.length, 0)

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="w-full bg-[#141414] border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-indigo-400/40"
          />
        </div>

        <select
          value={clientId}
          onChange={e => setClientId(e.target.value)}
          className="bg-[#141414] border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-indigo-400/40"
        >
          <option value="all">All clients</option>
          {clients.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <select
          value={priority}
          onChange={e => setPriority(e.target.value as 'all' | TaskPriority)}
          className="bg-[#141414] border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-indigo-400/40"
        >
          <option value="all">All priorities</option>
          {(Object.keys(PRIORITY_META) as TaskPriority[]).map(p => (
            <option key={p} value={p}>{PRIORITY_META[p].label}</option>
          ))}
        </select>

        <div className="ml-auto text-white/35 text-xs tabular-nums">
          {loading ? 'Loading…' : `${totalVisible} task${totalVisible === 1 ? '' : 's'}`}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-3 flex items-center gap-2 text-rose-200 bg-rose-500/10 border border-rose-400/30 rounded-lg px-3 py-2 text-sm">
          <AlertTriangle size={14} />
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-rose-200/60 hover:text-rose-200 text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Board */}
      {loading && tasks.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-white/30 text-sm">
          <Loader2 size={16} className="animate-spin mr-2" /> Loading pipeline…
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {COLUMNS.map(col => {
            const items    = columns[col.key]
            const isTarget = dropTarget === col.key
            return (
              <div
                key={col.key}
                onDragOver={e => handleColumnDragOver(e, col.key)}
                onDrop={e => handleColumnDrop(e, col.key)}
                onDragLeave={() => { if (dropTarget === col.key) setDropTarget(null) }}
                className={cn(
                  'flex flex-col bg-[#0f0f0f] border rounded-xl min-h-[280px] transition-colors',
                  isTarget ? col.accent : 'border-white/6',
                )}
              >
                {/* Column header */}
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/5">
                  <span className={cn('w-1.5 h-1.5 rounded-full', col.dot)} />
                  <span className="text-white/70 text-xs font-semibold uppercase tracking-wider">
                    {col.label}
                  </span>
                  <span className="ml-auto text-white/30 text-xs tabular-nums">{items.length}</span>
                </div>

                {/* Cards */}
                <div className="flex-1 flex flex-col gap-2 p-2">
                  {items.map(task => (
                    <PipelineCard
                      key={task.id}
                      task={task}
                      isDragging={draggingId === task.id}
                      onDragStart={e => handleDragStart(e, task.id)}
                      onDragEnd={handleDragEnd}
                    />
                  ))}
                  {items.length === 0 && (
                    <div className="text-white/15 text-xs text-center py-6">
                      {isTarget ? 'Drop here…' : '—'}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Pipeline card ──────────────────────────────────────────────────────

interface CardProps {
  task:         TaskItem
  isDragging:   boolean
  onDragStart:  (e: React.DragEvent<HTMLDivElement>) => void
  onDragEnd:    () => void
}

function PipelineCard({ task, isDragging, onDragStart, onDragEnd }: CardProps) {
  // Track whether a drag actually happened so we can suppress the
  // click navigation when the user lets go after a drag.
  const didDrag = useRef(false)
  const due     = formatDue(task.scheduled_for)

  return (
    <div
      draggable
      onDragStart={e => { didDrag.current = true; onDragStart(e) }}
      onDragEnd={() => { onDragEnd(); setTimeout(() => { didDrag.current = false }, 50) }}
      className={cn(
        'group bg-[#141414] border border-white/8 rounded-lg p-2.5 cursor-grab active:cursor-grabbing',
        'hover:border-white/15 transition-colors',
        isDragging && 'opacity-40',
      )}
    >
      <Link
        href={`/clients/${task.client_id}?tab=tasks`}
        onClick={e => { if (didDrag.current) e.preventDefault() }}
        className="block"
      >
        <div className="text-white text-[13px] leading-snug font-medium line-clamp-2">
          {task.title}
        </div>

        {task.client_name && (
          <div className="mt-2 text-[10.5px] uppercase tracking-wider text-white/35 truncate">
            {task.client_name}
          </div>
        )}

        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {task.priority !== 'normal' && (
            <span className={cn(
              'inline-flex items-center text-[10px] leading-none px-1.5 py-1 rounded border font-medium',
              PRIORITY_META[task.priority].pill,
            )}>
              {PRIORITY_META[task.priority].label}
            </span>
          )}

          {due && (
            <span className={cn(
              'inline-flex items-center gap-1 text-[10px] leading-none px-1.5 py-1 rounded border',
              due.overdue
                ? 'bg-rose-500/10 border-rose-400/30 text-rose-200'
                : 'bg-white/[0.03] border-white/8 text-white/55',
            )}>
              <CalendarDays size={10} />
              {due.label}
            </span>
          )}
        </div>
      </Link>
    </div>
  )
}
