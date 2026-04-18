'use client'

/**
 * ProjectCard — Paperclip-style project tile used on the Agency View grid.
 *
 * Visual anatomy (top → bottom):
 *
 *   [ status dot ]  Project Name                            [ industry chip ]
 *                   domain.com
 *
 *   ┌─────────────────── Tasks row ───────────────────┐
 *   │  • 4 To do     • 2 In prog   • 1 Needs approval │
 *   │  • 1 Blocked   • 2 Overdue                      │
 *   └─────────────────────────────────────────────────┘
 *
 *   ┌──── Review queue ────┐
 *   │  3 pending review  → │   (links to /review-queue)
 *   └──────────────────────┘
 *
 *   ─────────────────────────────────────────────────
 *   Last touched by {bot} · {timeago}
 *   "Short detail line from the latest activity_log"
 *
 * Entire card is clickable and routes to /clients/{id}?tab=tasks — the
 * tasks tab is almost always where Tim wants to land when he opens a
 * project, not the generic overview.
 */

import Link from 'next/link'
import { Globe, AlertTriangle, Inbox, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProjectRollup } from '@/lib/projects'

// ── Small helpers ──────────────────────────────────────────────────────

function formatTimeAgo(dateStr: string): string {
  const diff  = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

function statusDotColor(status: string): string {
  switch (status) {
    case 'active':   return 'bg-emerald-400'
    case 'paused':   return 'bg-amber-400'
    case 'inactive': return 'bg-white/20'
    default:         return 'bg-rose-400'
  }
}

// ── Tiny presentational components ─────────────────────────────────────

interface TaskChipProps {
  count: number
  label: string
  dot:   string
  emphasize?: boolean
}

function TaskChip({ count, label, dot, emphasize }: TaskChipProps) {
  if (count === 0) return null
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 text-[11px] leading-none px-2 py-1 rounded-md border',
      emphasize
        ? 'bg-rose-500/10 border-rose-400/30 text-rose-200'
        : 'bg-white/[0.03] border-white/8 text-white/70',
    )}>
      <span className={cn('w-1.5 h-1.5 rounded-full', dot)} />
      <span className="font-semibold tabular-nums">{count}</span>
      <span className="text-white/50">{label}</span>
    </span>
  )
}

// ── Main card ──────────────────────────────────────────────────────────

interface Props {
  project: ProjectRollup
}

export function ProjectCard({ project }: Props) {
  const { tasks, review, last_activity } = project

  const href = `/clients/${project.id}?tab=tasks`

  return (
    <Link
      href={href}
      className={cn(
        'group flex flex-col h-full bg-[#141414] border border-white/8 rounded-xl p-5',
        'hover:border-indigo-400/30 hover:bg-[#161619] transition-all',
      )}
    >
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <span
            className={cn(
              'w-2 h-2 rounded-full mt-[9px] shrink-0',
              statusDotColor(project.status),
            )}
            aria-hidden
          />
          <div className="min-w-0">
            <h3 className="text-white font-semibold text-[15px] leading-tight truncate">
              {project.name}
            </h3>
            {project.domain && (
              <div className="flex items-center gap-1.5 text-white/35 text-xs mt-1">
                <Globe size={11} />
                <span className="truncate">{project.domain}</span>
              </div>
            )}
          </div>
        </div>

        {project.industry && (
          <span className="text-[10px] uppercase tracking-wider text-white/40 bg-white/[0.03] border border-white/8 px-2 py-1 rounded-md whitespace-nowrap">
            {project.industry}
          </span>
        )}
      </div>

      {/* ── Tasks row ──────────────────────────────────────── */}
      <div className="mt-5">
        {tasks.total === 0 ? (
          <div className="text-white/25 text-xs">No open tasks</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <TaskChip count={tasks.todo}           label="To do"          dot="bg-white/40" />
            <TaskChip count={tasks.in_progress}    label="In progress"    dot="bg-indigo-400" />
            <TaskChip count={tasks.needs_approval} label="Needs approval" dot="bg-amber-400" />
            <TaskChip count={tasks.blocked}        label="Blocked"        dot="bg-rose-400" />
            <TaskChip count={tasks.overdue}        label="Overdue"        dot="bg-rose-400" emphasize />
          </div>
        )}
      </div>

      {/* ── Review queue pill ──────────────────────────────── */}
      {review.total > 0 && (
        <div className="mt-3">
          <span className="inline-flex items-center gap-2 text-[11px] text-amber-200 bg-amber-500/10 border border-amber-400/30 rounded-md px-2.5 py-1.5">
            <Inbox size={12} />
            <span className="font-semibold">{review.total}</span>
            <span className="text-amber-200/70">pending review</span>
          </span>
        </div>
      )}

      {/* ── Footer: last activity ──────────────────────────── */}
      <div className="mt-auto pt-5 border-t border-white/5">
        {last_activity ? (
          <div className="flex items-start gap-2">
            {last_activity.status === 'error' || last_activity.status === 'warning' ? (
              <AlertTriangle size={12} className="text-amber-400 mt-[3px] shrink-0" />
            ) : (
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full mt-[7px] shrink-0',
                  last_activity.status === 'success' ? 'bg-emerald-400' : 'bg-white/30',
                )}
                aria-hidden
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[11px] text-white/40">
                {last_activity.bot && (
                  <>
                    <span className="text-white/60 font-medium">{last_activity.bot}</span>
                    <span>·</span>
                  </>
                )}
                <span>{formatTimeAgo(last_activity.created_at)}</span>
              </div>
              <p className="text-white/55 text-xs mt-0.5 truncate">
                {last_activity.title}
                {last_activity.detail ? ` — ${last_activity.detail}` : ''}
              </p>
            </div>
            <ArrowUpRight
              size={14}
              className="text-white/20 group-hover:text-white/60 transition-colors shrink-0 mt-0.5"
            />
          </div>
        ) : (
          <div className="flex items-center justify-between text-white/25 text-xs">
            <span>No recent activity</span>
            <ArrowUpRight
              size={14}
              className="text-white/20 group-hover:text-white/60 transition-colors"
            />
          </div>
        )}
      </div>
    </Link>
  )
}
