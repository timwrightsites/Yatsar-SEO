'use client'

import { useEffect, useState, useMemo } from 'react'
import { Loader2, Flag } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────────

type TaskStatus   = 'todo' | 'in_progress' | 'needs_approval' | 'approved' | 'live'
type TaskPriority = 'high' | 'medium' | 'low'
type TaskType     = 'content' | 'technical' | 'link' | 'keyword' | 'meta' | 'analytics' | 'audit' | 'geo' | 'optimizer' | 'alerter' | 'reporter' | 'other'

interface Task {
  id:             string
  title:          string
  type:           TaskType
  status:         TaskStatus
  priority:       TaskPriority
  due_date:       string | null
  created_at:     string
  client_id:      string
  clients:        { name: string; domain: string } | null
  strategies:     { name: string } | null
}

// ── Config ───────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  content:   'bg-purple-500/70',
  technical: 'bg-blue-500/70',
  link:      'bg-cyan-500/70',
  keyword:   'bg-amber-500/70',
  meta:      'bg-pink-500/70',
  analytics: 'bg-teal-500/70',
  audit:     'bg-orange-500/70',
  geo:       'bg-lime-500/70',
  optimizer: 'bg-indigo-500/70',
  alerter:   'bg-red-500/70',
  reporter:  'bg-emerald-500/70',
  other:     'bg-white/20',
}

const STATUS_DOT: Record<TaskStatus, string> = {
  todo:           'bg-white/20',
  in_progress:    'bg-blue-400',
  needs_approval: 'bg-yellow-400',
  approved:       'bg-purple-400',
  live:           'bg-emerald-400',
}

const PRIORITY_ICON: Record<TaskPriority, string> = {
  high: 'text-red-400', medium: 'text-yellow-400/60', low: 'text-white/20',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

function formatDay(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function weekdayShort(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short' })
}

// ── Bar position logic ──────────────────────────────────────────────────────

interface BarRow {
  task: Task
  barStart: number
  barEnd: number
  isOverdue: boolean
}

function computeRows(activeTasks: Task[], today: Date, totalDays: number): BarRow[] {
  const unscheduledHighCount  = { current: 0 }
  const unscheduledMedCount   = { current: 0 }
  const unscheduledLowCount   = { current: 0 }

  return activeTasks.map(task => {
    let barStart: number
    let barEnd: number
    let isOverdue = false

    if (task.due_date) {
      const due = startOfDay(new Date(task.due_date))
      const dueOffset = daysBetween(today, due)

      if (dueOffset < 0) {
        isOverdue = true
        barStart = 0
        barEnd   = 2
      } else if (dueOffset >= totalDays) {
        barStart = totalDays - 3
        barEnd   = totalDays - 1
      } else {
        barEnd   = dueOffset
        barStart = Math.max(0, dueOffset - 2)
      }
    } else {
      let slot: number
      if (task.priority === 'high') {
        slot = unscheduledHighCount.current++
        barStart = Math.min(1 + slot * 3, totalDays - 4)
      } else if (task.priority === 'medium') {
        slot = unscheduledMedCount.current++
        barStart = Math.min(5 + slot * 3, totalDays - 4)
      } else {
        slot = unscheduledLowCount.current++
        barStart = Math.min(9 + slot * 3, totalDays - 4)
      }
      barEnd = barStart + 2
    }

    return { task, barStart, barEnd, isOverdue }
  })
}

// ── Shared grid rendering ───────────────────────────────────────────────────

function DayHeader({ days }: { days: Date[] }) {
  return (
    <div className="flex border-b border-white/8 mb-1">
      <div className="w-[260px] shrink-0" />
      <div className="flex-1 flex">
        {days.map((d, i) => {
          const isToday   = i === 0
          const isWeekend = d.getDay() === 0 || d.getDay() === 6
          return (
            <div
              key={i}
              className={cn(
                'flex-1 text-center py-1.5 text-[10px] font-medium border-r border-white/4 last:border-r-0',
                isToday ? 'text-white bg-white/5 rounded-t' : isWeekend ? 'text-white/15' : 'text-white/30',
              )}
            >
              <div>{weekdayShort(d)}</div>
              <div className={isToday ? 'text-white/60' : ''}>{d.getDate()}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TaskRow({ row, days, totalDays, showStrategy }: {
  row: BarRow
  days: Date[]
  totalDays: number
  showStrategy?: boolean
}) {
  const { task, barStart, barEnd, isOverdue } = row
  return (
    <div className="flex items-center h-8 group hover:bg-white/[0.02] rounded transition-colors">
      {/* Task label */}
      <div className="w-[260px] shrink-0 flex items-center gap-1.5 px-2 overflow-hidden">
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', STATUS_DOT[task.status])} />
        <span className={cn('shrink-0', PRIORITY_ICON[task.priority])}>
          <Flag size={8} />
        </span>
        <span className="text-[11px] text-white/60 truncate group-hover:text-white/80 transition-colors">
          {task.title}
        </span>
        {showStrategy && task.strategies?.name && (
          <span className="text-[9px] text-white/20 truncate ml-auto shrink-0 max-w-[80px]">
            {task.strategies.name}
          </span>
        )}
      </div>

      {/* Bar area */}
      <div className="flex-1 flex relative">
        {days.map((d, i) => {
          const isWeekend = d.getDay() === 0 || d.getDay() === 6
          return (
            <div
              key={i}
              className={cn(
                'flex-1 h-8 border-r border-white/4 last:border-r-0',
                isWeekend && 'bg-white/[0.015]',
                i === 0 && 'bg-white/[0.02]',
              )}
            />
          )
        })}
        <div
          className="absolute top-1 bottom-1 rounded-md flex items-center px-2 overflow-hidden transition-all"
          style={{
            left:  `${(barStart / totalDays) * 100}%`,
            width: `${((barEnd - barStart + 1) / totalDays) * 100}%`,
          }}
        >
          <div
            className={cn(
              'absolute inset-0 rounded-md',
              isOverdue ? 'bg-red-500/40 ring-1 ring-red-500/30' : TYPE_COLORS[task.type] ?? TYPE_COLORS.other,
            )}
          />
          <span className="relative text-[10px] text-white/90 font-medium truncate">
            {task.type}
            {isOverdue && ' · overdue'}
            {!task.due_date && ' · no date'}
          </span>
        </div>
      </div>
    </div>
  )
}

function Legend() {
  return (
    <div className="flex items-center gap-4 mt-4 pt-3 border-t border-white/5 flex-wrap">
      {Object.entries(TYPE_COLORS).filter(([k]) => k !== 'other').map(([type, color]) => (
        <div key={type} className="flex items-center gap-1.5">
          <div className={cn('w-2.5 h-2.5 rounded-sm', color)} />
          <span className="text-[10px] text-white/30 capitalize">{type}</span>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <div className="w-2.5 h-2.5 rounded-sm bg-red-500/40 ring-1 ring-red-500/30" />
        <span className="text-[10px] text-white/30">Overdue</span>
      </div>
    </div>
  )
}

// ── Props ────────────────────────────────────────────────────────────────────

interface GanttChartProps {
  /** If set, fetch tasks for this client only. Otherwise, fetch all active clients. */
  clientId?: string
}

// ── Main export ─────────────────────────────────────────────────────────────

export function GanttChart({ clientId }: GanttChartProps = {}) {
  const [tasks, setTasks]     = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  const isAgencyView = !clientId

  useEffect(() => {
    const url = clientId
      ? `/api/strategies/tasks?clientId=${clientId}`
      : '/api/strategies/tasks?allActive=true'

    fetch(url)
      .then(r => r.json())
      .then(d => { if (!d.error) setTasks(d) })
      .finally(() => setLoading(false))
  }, [clientId])

  const today      = useMemo(() => startOfDay(new Date()), [])
  const TOTAL_DAYS = 14
  const timelineEnd = addDays(today, TOTAL_DAYS - 1)

  const activeTasks = useMemo(() =>
    tasks.filter(t => t.status !== 'live'),
  [tasks])

  const rows = useMemo(() =>
    computeRows(activeTasks, today, TOTAL_DAYS),
  [activeTasks, today])

  // Group by client (agency view) or by strategy (client view)
  const grouped = useMemo(() => {
    if (isAgencyView) {
      const map = new Map<string, { label: string; linkHref: string | null; rows: BarRow[] }>()
      for (const row of rows) {
        const cid   = row.task.client_id
        const cname = row.task.clients?.name ?? 'Unknown'
        if (!map.has(cid)) map.set(cid, { label: cname, linkHref: `/clients/${cid}`, rows: [] })
        map.get(cid)!.rows.push(row)
      }
      return [...map.values()].sort((a, b) => b.rows.length - a.rows.length)
    } else {
      // Client view → group by strategy name
      const map = new Map<string, { label: string; linkHref: string | null; rows: BarRow[] }>()
      for (const row of rows) {
        const sname = row.task.strategies?.name ?? 'Unassigned'
        if (!map.has(sname)) map.set(sname, { label: sname, linkHref: null, rows: [] })
        map.get(sname)!.rows.push(row)
      }
      return [...map.values()].sort((a, b) => b.rows.length - a.rows.length)
    }
  }, [rows, isAgencyView])

  const days = useMemo(() =>
    Array.from({ length: TOTAL_DAYS }, (_, i) => addDays(today, i)),
  [today])

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="bg-[#141414] border border-white/8 rounded-xl p-5">
        <div className="flex items-center gap-2 py-6 text-white/30 text-sm">
          <Loader2 size={14} className="animate-spin" /> Loading timeline…
        </div>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="bg-[#141414] border border-white/8 rounded-xl p-5">
        <h2 className="text-white font-bold text-lg mb-2">2-Week Timeline</h2>
        <p className="text-white/20 text-sm py-6 text-center">No active tasks to show.</p>
      </div>
    )
  }

  return (
    <div className="bg-[#141414] border border-white/8 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-white font-bold text-lg">2-Week Timeline</h2>
          <span className="text-white/25 text-xs">
            {formatDay(today)} — {formatDay(timelineEnd)}
          </span>
        </div>
        <span className="text-white/25 text-xs">{rows.length} tasks</span>
      </div>

      <div className="overflow-x-auto">
        <div style={{ minWidth: 900 }}>
          <DayHeader days={days} />

          {grouped.map((group, gi) => (
            <div key={gi} className="mb-3">
              {/* Group header */}
              <div className="flex items-center gap-2 py-1.5 px-1">
                {group.linkHref ? (
                  <Link
                    href={group.linkHref}
                    className="text-xs font-semibold text-white/60 hover:text-white transition-colors"
                  >
                    {group.label}
                  </Link>
                ) : (
                  <span className="text-xs font-semibold text-white/60">{group.label}</span>
                )}
                <span className="text-[10px] text-white/20">{group.rows.length} tasks</span>
              </div>

              {group.rows.map(row => (
                <TaskRow
                  key={row.task.id}
                  row={row}
                  days={days}
                  totalDays={TOTAL_DAYS}
                  showStrategy={isAgencyView}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <Legend />
    </div>
  )
}
