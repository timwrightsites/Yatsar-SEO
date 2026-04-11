'use client'

import { useEffect, useState, useCallback } from 'react'
import { Loader2, AlertCircle, Plus, ChevronDown, ChevronRight, ExternalLink, Flag, Calendar, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AgentTriggerModal } from './AgentTriggerModal'

// ── Types ─────────────────────────────────────────────────────────────────────

type TaskStatus   = 'todo' | 'in_progress' | 'needs_approval' | 'approved' | 'live'
type TaskType     = 'content' | 'technical' | 'link' | 'keyword' | 'meta' | 'analytics' | 'audit' | 'geo' | 'optimizer' | 'alerter' | 'reporter' | 'other'
type TaskPriority = 'high' | 'medium' | 'low'

interface Task {
  id:             string
  strategy_id:    string
  client_id:      string
  title:          string
  description:    string | null
  type:           TaskType
  status:         TaskStatus
  priority:       TaskPriority
  due_date:       string | null
  assigned_agent: string | null
  output_ref:     string | null
  notes:          string | null
  created_at:     string
  // Joined from parent — so we can show which strategy a task belongs to
  _strategy_name?: string
}

interface Strategy {
  id:             string
  client_id:      string
  name:           string
  description:    string | null
  status:         'active' | 'paused' | 'completed'
  created_at:     string
  strategy_tasks: Task[]
}

// ── Config ────────────────────────────────────────────────────────────────────

const COLUMNS: { id: TaskStatus; label: string; color: string; dot: string }[] = [
  { id: 'todo',             label: 'To Do',           color: 'text-white/40',   dot: 'bg-white/20'      },
  { id: 'in_progress',      label: 'In Progress',     color: 'text-blue-400',   dot: 'bg-blue-400'      },
  { id: 'needs_approval',   label: 'Needs Approval',  color: 'text-yellow-400', dot: 'bg-yellow-400'    },
  { id: 'approved',         label: 'Approved',        color: 'text-purple-400', dot: 'bg-purple-400'    },
  { id: 'live',             label: 'Live',            color: 'text-[#22c55e]',  dot: 'bg-[#22c55e]'     },
]

const TYPE_LABELS: Record<TaskType, string> = {
  content: 'Content', technical: 'Technical', link: 'Link',
  keyword: 'Keyword', meta: 'Meta', analytics: 'Analytics',
  audit: 'Audit', geo: 'GEO', optimizer: 'Optimizer',
  alerter: 'Alerter', reporter: 'Reporter', other: 'Other',
}

const TYPE_COLORS: Record<string, string> = {
  content: 'bg-yellow-500/10 text-yellow-300/80',
  technical: 'bg-green-500/10 text-green-300/80',
  link: 'bg-blue-500/10 text-blue-300/80',
  keyword: 'bg-orange-500/10 text-orange-300/80',
  analytics: 'bg-cyan-500/10 text-cyan-300/80',
  audit: 'bg-rose-500/10 text-rose-300/80',
  geo: 'bg-purple-500/10 text-purple-300/80',
  optimizer: 'bg-emerald-500/10 text-emerald-300/80',
  alerter: 'bg-red-500/10 text-red-300/80',
  reporter: 'bg-indigo-500/10 text-indigo-300/80',
  meta: 'bg-white/5 text-white/40',
  other: 'bg-white/5 text-white/40',
}

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  high: 'text-red-400', medium: 'text-yellow-400/70', low: 'text-white/25',
}

// ── Task card ─────────────────────────────────────────────────────────────────

function TaskCard({ task, onStatusChange, onRunAgent }: {
  task: Task
  onStatusChange: (id: string, status: TaskStatus) => void
  onRunAgent: (task: Task) => void
}) {
  const [open, setOpen] = useState(false)
  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'live'

  const nextStatus: Partial<Record<TaskStatus, TaskStatus>> = {
    todo: 'in_progress', in_progress: 'needs_approval',
    needs_approval: 'approved', approved: 'live',
  }

  return (
    <div className={cn(
      'bg-[#0d0d0d] border rounded-lg overflow-hidden transition-all',
      task.status === 'needs_approval' ? 'border-yellow-400/25' : 'border-white/6',
    )}>
      {/* Card header */}
      <div className="px-3 py-2.5">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <p className="text-white/80 text-xs font-medium leading-snug flex-1">{task.title}</p>
          <button onClick={() => setOpen(!open)} className="text-white/20 hover:text-white/50 shrink-0 mt-0.5">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        </div>

        {/* Tags row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded', TYPE_COLORS[task.type] ?? TYPE_COLORS.other)}>
            {TYPE_LABELS[task.type] ?? task.type}
          </span>
          <span className={cn('flex items-center gap-0.5 text-[10px]', PRIORITY_COLORS[task.priority])}>
            <Flag size={8} />{task.priority}
          </span>
          {task.due_date && (
            <span className={cn('flex items-center gap-0.5 text-[10px]', isOverdue ? 'text-red-400' : 'text-white/25')}>
              <Calendar size={8} />{new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {open && (
        <div className="px-3 pb-3 pt-0 border-t border-white/5 space-y-2 mt-0">
          {task._strategy_name && (
            <p className="text-white/20 text-[10px] pt-2">Strategy: {task._strategy_name}</p>
          )}
          {task.description && (
            <p className="text-white/40 text-[11px] leading-relaxed">{task.description}</p>
          )}
          {task.notes && (
            <p className="text-white/30 text-[11px] italic">{task.notes}</p>
          )}
          {task.assigned_agent && (
            <p className="text-white/20 text-[10px]">Agent: {task.assigned_agent}</p>
          )}
          {task.output_ref && (
            <a href={task.output_ref} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-blue-400/70 hover:text-blue-400">
              <ExternalLink size={10} /> View output
            </a>
          )}
          {/* Run agent button */}
          {(task.status === 'todo' || task.status === 'in_progress') && (
            <button
              onClick={() => onRunAgent(task)}
              className="w-full mt-1 py-1.5 text-[10px] text-white/60 border border-white/8 rounded hover:bg-[#22c55e]/10 hover:border-[#22c55e]/20 hover:text-[#22c55e] transition-all flex items-center justify-center gap-1.5">
              <Zap size={9} /> Run Agent
            </button>
          )}
          {/* Move forward button */}
          {nextStatus[task.status] && (
            <button
              onClick={() => onStatusChange(task.id, nextStatus[task.status]!)}
              className="w-full mt-1 py-1 text-[10px] text-white/40 border border-white/8 rounded hover:bg-white/4 hover:text-white/70 transition-all">
              Move to {COLUMNS.find(c => c.id === nextStatus[task.status])?.label} →
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function StrategyPanel({ clientId }: { clientId: string }) {
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [agentModalTask, setAgentModalTask] = useState<Task | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/strategies?clientId=${clientId}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setStrategies(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load strategies')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  // Re-fetch when the agent saves a new strategy (fires from AgentPanel)
  useEffect(() => {
    const onStrategyUpdated = () => {
      setTimeout(() => load(), 1500)
    }
    window.addEventListener('strategy-updated', onStrategyUpdated)
    return () => window.removeEventListener('strategy-updated', onStrategyUpdated)
  }, [load])

  // Flatten ALL tasks from ALL strategies into one pool, sorted by priority then date
  const allTasks: Task[] = strategies.flatMap(s =>
    s.strategy_tasks.map(t => ({ ...t, _strategy_name: s.name }))
  ).sort((a, b) => {
    const pOrder = { high: 0, medium: 1, low: 2 }
    const pDiff = (pOrder[a.priority] ?? 1) - (pOrder[b.priority] ?? 1)
    if (pDiff !== 0) return pDiff
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  const updateTaskStatus = async (taskId: string, status: TaskStatus) => {
    const res = await fetch(`/api/strategies/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      setStrategies(prev => prev.map(s => ({
        ...s,
        strategy_tasks: s.strategy_tasks.map(t => t.id === taskId ? { ...t, status } : t),
      })))
    }
  }

  if (loading) return (
    <div className="bg-[#141414] border border-white/8 rounded-lg p-5 flex items-center gap-2 text-white/30 text-sm">
      <Loader2 size={14} className="animate-spin" /> Loading tasks…
    </div>
  )

  if (error) return (
    <div className="bg-[#141414] border border-white/8 rounded-lg p-5 flex items-center gap-2 text-red-400 text-sm">
      <AlertCircle size={14} /> {error}
    </div>
  )

  const approvalCount = allTasks.filter(t => t.status === 'needs_approval').length

  if (allTasks.length === 0) return (
    <div className="bg-[#141414] border border-white/8 rounded-lg p-5">
      <div className="flex items-center justify-between mb-1">
        <p className="text-white font-semibold text-sm">Strategy</p>
      </div>
      <p className="text-white/25 text-xs mt-3">
        No tasks yet. Start a conversation with the SEO Co-Strategist in the AI Chat tab — when you agree on a strategy, tasks will appear here as a kanban board.
      </p>
    </div>
  )

  return (
    <div className="bg-[#141414] border border-white/8 rounded-lg p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <p className="text-white font-semibold text-sm">All Tasks</p>
          {approvalCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] bg-yellow-400/10 border border-yellow-400/20 text-yellow-400 px-2 py-0.5 rounded-full">
              {approvalCount} need{approvalCount === 1 ? 's' : ''} approval
            </span>
          )}
        </div>
        <span className="text-white/20 text-[11px]">{allTasks.length} tasks across {strategies.length} {strategies.length === 1 ? 'strategy' : 'strategies'}</span>
      </div>

      {/* Kanban board */}
      <div className="grid grid-cols-5 gap-3">
        {COLUMNS.map(col => {
          const colTasks = allTasks.filter(t => t.status === col.id)
          return (
            <div key={col.id} className="flex flex-col gap-2">
              {/* Column header */}
              <div className="flex items-center gap-1.5 mb-1">
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', col.dot)} />
                <span className={cn('text-[10px] font-medium uppercase tracking-wide', col.color)}>
                  {col.label}
                </span>
                <span className="text-[10px] text-white/20 ml-auto">{colTasks.length}</span>
              </div>

              {/* Tasks */}
              {colTasks.map(task => (
                <TaskCard key={task.id} task={task} onStatusChange={updateTaskStatus} onRunAgent={setAgentModalTask} />
              ))}

              {colTasks.length === 0 && (
                <div className="border border-dashed border-white/6 rounded-lg h-16 flex items-center justify-center">
                  <span className="text-white/10 text-[10px]">empty</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Task summary bar */}
      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-white/5">
        {COLUMNS.map(col => {
          const count = allTasks.filter(t => t.status === col.id).length
          return count > 0 ? (
            <span key={col.id} className={cn('text-[11px]', col.color)}>
              {count} {col.label.toLowerCase()}
            </span>
          ) : null
        })}
        <span className="text-white/20 text-[11px] ml-auto">{allTasks.length} total</span>
      </div>

      {/* Agent trigger modal */}
      {agentModalTask && (
        <AgentTriggerModal
          taskId={agentModalTask.id}
          taskTitle={agentModalTask.title}
          taskType={agentModalTask.type}
          clientId={clientId}
          onClose={() => setAgentModalTask(null)}
          onSuccess={({ runId, sessionId }) => {
            // Update the task status optimistically to in_progress
            setStrategies(prev => prev.map(s => ({
              ...s,
              strategy_tasks: s.strategy_tasks.map(t =>
                t.id === agentModalTask.id ? { ...t, status: 'in_progress' as TaskStatus } : t
              ),
            })))
            setAgentModalTask(null)
            // Emit event so other panels (BotActivity, ActivityFeed) can refresh
            window.dispatchEvent(new CustomEvent('agent-dispatched', {
              detail: { runId, sessionId, taskId: agentModalTask.id },
            }))
          }}
        />
      )}
    </div>
  )
}
