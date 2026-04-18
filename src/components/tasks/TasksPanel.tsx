'use client'

/**
 * TasksPanel — shared UI for the Paperclip-style task list.
 *
 * Two modes:
 *   • Top-level inbox at /tasks                — no clientId prop; shows a
 *     client chip on every row and lets Tim filter across the whole
 *     agency.
 *   • Per-client tab on /clients/[id]?tab=tasks — clientId prop scopes the
 *     list; client chips are suppressed and the client selector in the
 *     add-task form is locked to the current client.
 *
 * Visual language is a direct port of Paperclip's Tasks.jsx:
 *   compact row + left checkbox + title + chip row + status select +
 *   delete icon, expand-in-place for description/notes. Priority
 *   colours and overdue highlight match the original palette.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Loader2,
  Search,
  Plus,
  Trash2,
  Check,
  Calendar as CalendarIcon,
  AlertTriangle,
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

interface TasksResponse {
  tasks: TaskItem[]
  counts: {
    total:          number
    todo:           number
    in_progress:    number
    needs_approval: number
    done:           number
    blocked:        number
    overdue:        number
  }
}

interface ClientOption { id: string; name: string }

// ── Presentation metadata ──────────────────────────────────────────────

const STATUS_META: Record<TaskStatus, { label: string; dot: string; pill: string }> = {
  todo:           { label: 'To do',          dot: 'bg-white/25',             pill: 'bg-white/5 text-white/55 border-white/10' },
  in_progress:    { label: 'In progress',    dot: 'bg-indigo-400',           pill: 'bg-indigo-500/15 text-indigo-200 border-indigo-400/30' },
  needs_approval: { label: 'Needs approval', dot: 'bg-amber-400',            pill: 'bg-amber-500/15 text-amber-200 border-amber-400/30' },
  done:           { label: 'Done',           dot: 'bg-emerald-400',          pill: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30' },
  blocked:        { label: 'Blocked',        dot: 'bg-rose-400',             pill: 'bg-rose-500/15 text-rose-200 border-rose-400/30' },
}

const PRIORITY_META: Record<TaskPriority, { label: string; pill: string }> = {
  urgent: { label: 'Urgent', pill: 'bg-rose-500/15  text-rose-200  border-rose-400/30'  },
  high:   { label: 'High',   pill: 'bg-amber-500/15 text-amber-200 border-amber-400/30' },
  normal: { label: 'Normal', pill: 'bg-white/5      text-white/50  border-white/10'     },
  low:    { label: 'Low',    pill: 'bg-white/5      text-white/35  border-white/10'     },
}

const STATUS_ORDER: TaskStatus[]   = ['todo', 'in_progress', 'needs_approval', 'blocked', 'done']
const PRIORITY_ORDER: TaskPriority[] = ['urgent', 'high', 'normal', 'low']

// ── Helpers ────────────────────────────────────────────────────────────

function dueChip(iso: string | null, status: TaskStatus): { label: string; overdue: boolean } | null {
  if (!iso) return null
  const d = new Date(iso)
  const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const overdue = status !== 'done' && d.getTime() < Date.now()
  return { label, overdue }
}

function humanStatus(s: TaskStatus): string { return STATUS_META[s]?.label ?? s }

// ── Main component ─────────────────────────────────────────────────────

interface Props {
  /** If provided, the list is scoped to this client and the add form is locked. */
  clientId?: string
  /** Display heading text. Defaults adjust based on scope. */
  heading?:  string
}

export function TasksPanel({ clientId, heading }: Props) {
  const [tasks,    setTasks]    = useState<TaskItem[]>([])
  const [counts,   setCounts]   = useState<TasksResponse['counts'] | null>(null)
  const [clients,  setClients]  = useState<ClientOption[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  const [filterStatus,   setFilterStatus]   = useState<'all' | TaskStatus>('all')
  const [filterPriority, setFilterPriority] = useState<'all' | TaskPriority>('all')
  const [filterClient,   setFilterClient]   = useState<'all' | string>('all')
  const [search,         setSearch]         = useState('')

  const [addOpen, setAddOpen] = useState(false)

  // ── Initial load ─────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const url = clientId ? `/api/tasks?client_id=${encodeURIComponent(clientId)}` : '/api/tasks'
        const res = await fetch(url)
        if (!res.ok) throw new Error(`tasks fetch failed (${res.status})`)
        const data = (await res.json()) as TasksResponse
        if (!cancelled) {
          setTasks(data.tasks)
          setCounts(data.counts)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load tasks')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [clientId])

  // ── Client list for the filter + add form ────────────────────────────
  // Only the top-level view needs a cross-client dropdown; when scoped
  // to a single client we still fetch the list so the form can show the
  // client name, but it's cheap (name-only).

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/clients')
        if (!res.ok) return
        const data = await res.json() as { clients?: ClientOption[] } | ClientOption[]
        const list = Array.isArray(data) ? data : (data.clients ?? [])
        if (!cancelled) setClients(list.map(c => ({ id: c.id, name: c.name })))
      } catch {
        /* non-fatal */
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  // ── Filter + search ──────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasks.filter(t => {
      if (filterStatus   !== 'all' && t.status   !== filterStatus)   return false
      if (filterPriority !== 'all' && t.priority !== filterPriority) return false
      if (filterClient   !== 'all' && t.client_id !== filterClient)  return false
      if (q && !t.title.toLowerCase().includes(q))                   return false
      return true
    })
  }, [tasks, filterStatus, filterPriority, filterClient, search])

  // ── Mutations ────────────────────────────────────────────────────────

  async function updateTask(id: string, patch: Partial<Pick<TaskItem, 'status' | 'priority' | 'title' | 'description' | 'notes' | 'scheduled_for'>>) {
    // Optimistic — roll back on error.
    const prev = tasks
    setTasks(t => t.map(x => x.id === id ? { ...x, ...patch } as TaskItem : x))
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(`update failed (${res.status})`)
      const data = await res.json() as { task: TaskItem }
      setTasks(t => t.map(x => x.id === id ? data.task : x))
    } catch (err) {
      setTasks(prev)
      setError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  async function deleteTask(id: string) {
    if (!confirm('Delete this task? This cannot be undone.')) return
    const prev = tasks
    setTasks(t => t.filter(x => x.id !== id))
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`delete failed (${res.status})`)
    } catch (err) {
      setTasks(prev)
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  async function createTask(payload: NewTaskPayload) {
    const res = await fetch('/api/tasks', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `create failed (${res.status})`)
    }
    const data = await res.json() as { task: TaskItem }
    setTasks(t => [data.task, ...t])
    setAddOpen(false)
  }

  // ── Render ───────────────────────────────────────────────────────────

  const subtitle = counts
    ? [
        `${counts.total} total`,
        counts.todo           ? `${counts.todo} to do`                : null,
        counts.in_progress    ? `${counts.in_progress} in progress`   : null,
        counts.needs_approval ? `${counts.needs_approval} needs approval` : null,
        counts.blocked        ? `${counts.blocked} blocked`           : null,
        counts.done           ? `${counts.done} done`                 : null,
        counts.overdue        ? `${counts.overdue} overdue`           : null,
      ].filter(Boolean).join(' · ')
    : ''

  return (
    <div className="w-full">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-white font-semibold text-xl">{heading ?? (clientId ? 'Tasks' : 'All Tasks')}</h2>
          {subtitle && (
            <p className="text-white/40 text-xs mt-1">{subtitle}</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => setAddOpen(v => !v)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium transition-colors"
        >
          <Plus size={14} />
          New task
        </button>
      </div>

      {addOpen && (
        <AddTaskForm
          clients={clients}
          lockedClientId={clientId}
          onCancel={() => setAddOpen(false)}
          onCreate={createTask}
        />
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="w-full bg-[#141414] border border-white/10 rounded-md py-1.5 pl-9 pr-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/25"
          />
        </div>

        <FilterChip label="All" active={filterStatus === 'all'} onClick={() => setFilterStatus('all')} />
        {STATUS_ORDER.map(s => (
          <FilterChip
            key={s}
            label={humanStatus(s)}
            active={filterStatus === s}
            onClick={() => setFilterStatus(s)}
            dot={STATUS_META[s].dot}
          />
        ))}

        <span className="w-px h-5 bg-white/10 mx-1" />

        <select
          value={filterPriority}
          onChange={e => setFilterPriority(e.target.value as 'all' | TaskPriority)}
          className="bg-[#141414] border border-white/10 rounded-md py-1.5 px-2 text-xs text-white/70 focus:outline-none focus:border-white/25"
        >
          <option value="all">All priorities</option>
          {PRIORITY_ORDER.map(p => (
            <option key={p} value={p}>{PRIORITY_META[p].label}</option>
          ))}
        </select>

        {!clientId && (
          <select
            value={filterClient}
            onChange={e => setFilterClient(e.target.value)}
            className="bg-[#141414] border border-white/10 rounded-md py-1.5 px-2 text-xs text-white/70 focus:outline-none focus:border-white/25"
          >
            <option value="all">All clients</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* List */}
      {error && (
        <div className="mb-3 flex items-center gap-2 bg-rose-500/10 border border-rose-400/30 rounded-md px-3 py-2 text-xs text-rose-200">
          <AlertTriangle size={14} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-rose-200/70 hover:text-rose-200">dismiss</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-white/40 text-sm py-10 justify-center">
          <Loader2 size={14} className="animate-spin" />
          Loading tasks…
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-white/35 text-sm border border-dashed border-white/10 rounded-md">
          {tasks.length === 0
            ? 'No tasks yet. Click New task to add one.'
            : 'No tasks match your filters.'}
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              showClient={!clientId}
              onUpdate={patch => updateTask(task.id, patch)}
              onDelete={() => deleteTask(task.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── TaskRow ────────────────────────────────────────────────────────────

interface RowProps {
  task:       TaskItem
  showClient: boolean
  onUpdate:   (patch: Partial<Pick<TaskItem, 'status' | 'priority' | 'title' | 'description' | 'notes' | 'scheduled_for'>>) => void
  onDelete:   () => void
}

function TaskRow({ task, showClient, onUpdate, onDelete }: RowProps) {
  const [expanded, setExpanded] = useState(false)
  const due  = dueChip(task.scheduled_for, task.status)
  const done = task.status === 'done'

  return (
    <div
      className={cn(
        'bg-[#141414] border rounded-md transition-all',
        expanded ? 'border-indigo-400/40' : 'border-white/8 hover:border-white/20',
      )}
    >
      <div
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer"
        onClick={() => setExpanded(v => !v)}
      >
        {/* Check / done toggle */}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onUpdate({ status: done ? 'todo' : 'done' }) }}
          className={cn(
            'w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors',
            done ? 'bg-emerald-500 border-emerald-500' : 'border-white/25 hover:border-white/50',
          )}
          title={done ? 'Reopen' : 'Mark done'}
        >
          {done && <Check size={10} className="text-[#141414]" strokeWidth={3} />}
        </button>

        {/* Status dot */}
        {!done && (
          <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', STATUS_META[task.status].dot)} />
        )}

        {/* Title + chips */}
        <div className="flex-1 min-w-0">
          <div className={cn('text-sm truncate', done ? 'text-white/40 line-through' : 'text-white')}>
            {task.title}
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {showClient && task.client_name && (
              <Pill label={task.client_name} cls="bg-white/5 text-white/55 border-white/10" />
            )}
            <Pill label={PRIORITY_META[task.priority].label} cls={PRIORITY_META[task.priority].pill} />
            {due && (
              <Pill
                label={due.label}
                cls={due.overdue
                  ? 'bg-rose-500/15 text-rose-200 border-rose-400/30'
                  : 'bg-white/5 text-white/55 border-white/10'}
                icon={<CalendarIcon size={10} />}
              />
            )}
            {task.type && (
              <Pill label={task.type} cls="bg-white/5 text-white/40 border-white/10" />
            )}
          </div>
        </div>

        {/* Status selector */}
        <select
          value={task.status}
          onClick={e => e.stopPropagation()}
          onChange={e => onUpdate({ status: e.target.value as TaskStatus })}
          className="bg-[#1a1a1a] border border-white/10 rounded-md py-1 px-2 text-xs text-white/70 focus:outline-none focus:border-white/25 shrink-0"
        >
          {STATUS_ORDER.map(s => (
            <option key={s} value={s}>{STATUS_META[s].label}</option>
          ))}
        </select>

        {/* Delete */}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="text-white/25 hover:text-rose-300 transition-colors shrink-0"
          title="Delete task"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-3 pt-1 border-t border-white/5 text-sm text-white/70 space-y-2">
          {task.description && (
            <div className="whitespace-pre-wrap">{task.description}</div>
          )}
          {task.notes && (
            <div className="bg-white/[0.02] border border-white/5 rounded-md px-3 py-2 text-xs text-white/55 whitespace-pre-wrap">
              <div className="text-white/35 mb-1 uppercase tracking-wide text-[10px]">Notes</div>
              {task.notes}
            </div>
          )}
          {!task.description && !task.notes && (
            <div className="text-white/30 text-xs italic">
              No description or notes yet.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── FilterChip ─────────────────────────────────────────────────────────

interface FilterChipProps {
  label:   string
  active:  boolean
  onClick: () => void
  dot?:    string
}

function FilterChip({ label, active, onClick, dot }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs transition-colors',
        active
          ? 'bg-white/10 border-white/25 text-white'
          : 'bg-[#141414] border-white/8 text-white/50 hover:text-white/80 hover:border-white/15',
      )}
    >
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', dot)} />}
      {label}
    </button>
  )
}

// ── Pill ───────────────────────────────────────────────────────────────

interface PillProps {
  label: string
  cls:   string
  icon?: React.ReactNode
}

function Pill({ label, cls, icon }: PillProps) {
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] uppercase tracking-wide', cls)}>
      {icon}
      {label}
    </span>
  )
}

// ── AddTaskForm ────────────────────────────────────────────────────────

interface NewTaskPayload {
  client_id:     string
  title:         string
  description?:  string
  priority?:     TaskPriority
  scheduled_for?: string | null
  status?:       TaskStatus
  type?:         string | null
}

interface AddProps {
  clients:        ClientOption[]
  lockedClientId?: string
  onCancel:       () => void
  onCreate:       (payload: NewTaskPayload) => Promise<void>
}

function AddTaskForm({ clients, lockedClientId, onCancel, onCreate }: AddProps) {
  const [title,       setTitle]       = useState('')
  const [description, setDescription] = useState('')
  const [clientId,    setClientId]    = useState(lockedClientId ?? clients[0]?.id ?? '')
  const [priority,    setPriority]    = useState<TaskPriority>('normal')
  const [due,         setDue]         = useState('')
  const [saving,      setSaving]      = useState(false)
  const [formError,   setFormError]   = useState<string | null>(null)

  useEffect(() => {
    if (!clientId && clients.length > 0 && !lockedClientId) setClientId(clients[0].id)
  }, [clients, clientId, lockedClientId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!clientId) { setFormError('Pick a client.'); return }
    if (!title.trim()) { setFormError('Title is required.'); return }
    setSaving(true)
    setFormError(null)
    try {
      await onCreate({
        client_id:     clientId,
        title:         title.trim(),
        description:   description.trim() || undefined,
        priority,
        scheduled_for: due ? new Date(due).toISOString() : null,
      })
      setTitle('')
      setDescription('')
      setDue('')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create task')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-4 bg-[#141414] border border-white/10 rounded-md p-4 space-y-3"
    >
      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-white/35 mb-1">Task title</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus
            required
            className="w-full bg-[#0f0f0f] border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-white/25"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-white/35 mb-1">Client</label>
          <select
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            disabled={!!lockedClientId}
            className="w-full bg-[#0f0f0f] border border-white/10 rounded-md px-3 py-2 text-sm text-white disabled:opacity-60 focus:outline-none focus:border-white/25"
          >
            {clients.length === 0 && <option value="">No clients</option>}
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-white/35 mb-1">Priority</label>
          <select
            value={priority}
            onChange={e => setPriority(e.target.value as TaskPriority)}
            className="w-full bg-[#0f0f0f] border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-white/25"
          >
            {PRIORITY_ORDER.map(p => (
              <option key={p} value={p}>{PRIORITY_META[p].label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-white/35 mb-1">Due date</label>
          <input
            type="date"
            value={due}
            onChange={e => setDue(e.target.value)}
            className="w-full bg-[#0f0f0f] border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-white/25"
          />
        </div>
      </div>

      <div>
        <label className="block text-[10px] uppercase tracking-wide text-white/35 mb-1">Description (optional)</label>
        <textarea
          rows={2}
          value={description}
          onChange={e => setDescription(e.target.value)}
          className="w-full bg-[#0f0f0f] border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-white/25"
        />
      </div>

      {formError && (
        <div className="text-xs text-rose-300">{formError}</div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-md text-xs text-white/60 hover:text-white hover:bg-white/5"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white text-xs font-medium"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          Create task
        </button>
      </div>
    </form>
  )
}
