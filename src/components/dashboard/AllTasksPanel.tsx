'use client'

import { useEffect, useState } from 'react'
import { Loader2, ExternalLink, Flag, Calendar, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type TaskStatus   = 'todo' | 'in_progress' | 'needs_approval' | 'approved' | 'live'
type TaskPriority = 'high' | 'medium' | 'low'
type TaskType     = 'content' | 'technical' | 'link' | 'keyword' | 'meta' | 'other'

interface Task {
  id:             string
  title:          string
  description:    string | null
  type:           TaskType
  status:         TaskStatus
  priority:       TaskPriority
  due_date:       string | null
  assigned_agent: string | null
  output_ref:     string | null
  client_id:      string
  clients:        { name: string; domain: string } | null
  strategies:     { name: string } | null
}

// ── Config ─────────────────────────────────────────────────────────────────────

const STATUS_META: Record<TaskStatus, { label: string; dot: string; text: string }> = {
  todo:           { label: 'To Do',          dot: 'bg-white/20',    text: 'text-white/40'   },
  in_progress:    { label: 'In Progress',    dot: 'bg-blue-400',    text: 'text-blue-400'   },
  needs_approval: { label: 'Needs Approval', dot: 'bg-yellow-400',  text: 'text-yellow-400' },
  approved:       { label: 'Approved',       dot: 'bg-purple-400',  text: 'text-purple-400' },
  live:           { label: 'Live',           dot: 'bg-[#22c55e]',   text: 'text-[#22c55e]'  },
}

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  high: 'text-red-400', medium: 'text-yellow-400/60', low: 'text-white/20',
}

const STATUS_ORDER: TaskStatus[] = ['needs_approval', 'in_progress', 'todo', 'approved', 'live']

// ── Main ──────────────────────────────────────────────────────────────────────

export function AllTasksPanel() {
  const [tasks, setTasks]     = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<TaskStatus | 'all'>('all')

  useEffect(() => {
    fetch('/api/strategies/tasks?allActive=true')
      .then(r => r.json())
      .then(d => { if (!d.error) setTasks(d) })
      .finally(() => setLoading(false))
  }, [])

  const updateStatus = async (id: string, status: TaskStatus) => {
    const res = await fetch(`/api/strategies/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t))
  }

  // Sort by status priority then due date
  const sorted = [...tasks].sort((a, b) => {
    const si = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
    if (si !== 0) return si
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
    if (a.due_date) return -1
    if (b.due_date) return 1
    return 0
  })

  const visible = filter === 'all' ? sorted : sorted.filter(t => t.status === filter)

  const counts: Partial<Record<TaskStatus, number>> = {}
  for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1

  const approvalCount = counts['needs_approval'] ?? 0

  return (
    <div className="bg-[#141414] border border-white/8 rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-white font-bold text-lg">All Tasks</h2>
          {approvalCount > 0 && (
            <span className="text-[10px] bg-yellow-400/10 border border-yellow-400/20 text-yellow-400 px-2 py-0.5 rounded-full font-medium">
              {approvalCount} need{approvalCount === 1 ? 's' : ''} approval
            </span>
          )}
        </div>
        <span className="text-white/25 text-xs">{tasks.length} total across all clients</span>
      </div>

      {/* Status filter tabs */}
      <div className="flex items-center gap-0.5 flex-wrap mb-4">
        <button onClick={() => setFilter('all')}
          className={cn('px-3 py-1 rounded text-xs font-medium transition-all',
            filter === 'all' ? 'bg-white/8 text-white' : 'text-white/30 hover:text-white/50')}>
          All ({tasks.length})
        </button>
        {STATUS_ORDER.map(s => {
          const count = counts[s] ?? 0
          if (count === 0) return null
          const meta = STATUS_META[s]
          return (
            <button key={s} onClick={() => setFilter(s)}
              className={cn('flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all',
                filter === s ? 'bg-white/8 text-white' : 'text-white/30 hover:text-white/50')}>
              <span className={cn('w-1.5 h-1.5 rounded-full', meta.dot)} />
              {meta.label} ({count})
            </button>
          )
        })}
      </div>

      {/* Task list */}
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-white/30 text-sm">
          <Loader2 size={14} className="animate-spin" /> Loading tasks…
        </div>
      ) : visible.length === 0 ? (
        <p className="text-white/20 text-sm py-6 text-center">
          {filter === 'all' ? 'No tasks yet. Start a strategy conversation with the SEO Co-Strategist on any client.' : `No ${STATUS_META[filter as TaskStatus]?.label.toLowerCase()} tasks.`}
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-white/5">
          {visible.map(task => {
            const meta    = STATUS_META[task.status]
            const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'live'
            return (
              <div key={task.id} className="py-3 flex items-center gap-4">
                {/* Status dot */}
                <span className={cn('w-2 h-2 rounded-full shrink-0', meta.dot)} />

                {/* Main content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-white/80 text-xs font-medium truncate">{task.title}</p>
                    {task.output_ref && (
                      <a href={task.output_ref} target="_blank" rel="noopener noreferrer"
                        className="text-white/20 hover:text-white/50 shrink-0">
                        <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Client label */}
                    {task.clients && (
                      <Link href={`/clients/${task.client_id}`}
                        className="flex items-center gap-0.5 text-[10px] text-white/30 hover:text-white/60 transition-colors">
                        {task.clients.name} <ChevronRight size={9} />
                      </Link>
                    )}
                    {/* Strategy label */}
                    {task.strategies && (
                      <span className="text-[10px] text-white/20">{task.strategies.name}</span>
                    )}
                    {/* Type */}
                    <span className="text-[10px] text-white/20 bg-white/4 px-1.5 py-0.5 rounded capitalize">{task.type}</span>
                    {/* Priority */}
                    <span className={cn('flex items-center gap-0.5 text-[10px]', PRIORITY_COLORS[task.priority])}>
                      <Flag size={8} />{task.priority}
                    </span>
                    {/* Due date */}
                    {task.due_date && (
                      <span className={cn('flex items-center gap-0.5 text-[10px]', isOverdue ? 'text-red-400' : 'text-white/25')}>
                        <Calendar size={8} />
                        {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {isOverdue && ' · overdue'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Status badge + quick actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn('text-[10px] font-medium', meta.text)}>{meta.label}</span>
                  {task.status === 'needs_approval' && (
                    <button onClick={() => updateStatus(task.id, 'approved')}
                      className="text-[10px] px-2 py-1 bg-[#22c55e]/10 border border-[#22c55e]/20 text-[#22c55e] rounded hover:bg-[#22c55e]/15 transition-all">
                      Approve
                    </button>
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
