'use client'

/**
 * ProjectsShell — the Paperclip-style Agency View.
 *
 * Replaces the old DashboardShell (which used ClientCard). Wraps the
 * ProjectsGrid with:
 *   • header (title + MRR + Add Client button)
 *   • active/archived tab strip with counts
 *   • cross-client agent activity feed (unchanged — BotActivity)
 *   • AddClientModal dialog (unchanged)
 *
 * Data is pre-rolled server-side via `buildProjectsRollup` and passed
 * in as `projects`. We keep the raw `logs` array around only for the
 * BotActivity feed at the bottom.
 */

import { useMemo, useState } from 'react'
import { ProjectCard } from '@/components/projects/ProjectCard'
import { BotActivity } from '@/components/dashboard/BotActivity'
import { AddClientModal } from '@/components/dashboard/AddClientModal'
import { cn } from '@/lib/utils'
import type { ProjectRollup } from '@/lib/projects'
import type { ActivityLog } from '@/types/database'

interface Props {
  projects:  ProjectRollup[]
  logs:      ActivityLog[]
  mrrDisplay: string
}

type Tab = 'active' | 'archived'

export function ProjectsShell({ projects, logs, mrrDisplay }: Props) {
  const [showAdd, setShowAdd] = useState(false)
  const [tab, setTab] = useState<Tab>('active')

  const { activeProjects, archivedProjects } = useMemo(() => {
    const active:   ProjectRollup[] = []
    const archived: ProjectRollup[] = []
    for (const p of projects) {
      if (p.status === 'inactive') archived.push(p)
      else                         active.push(p)
    }
    return { activeProjects: active, archivedProjects: archived }
  }, [projects])

  const visibleProjects = tab === 'active' ? activeProjects : archivedProjects

  return (
    <div className="min-h-screen bg-[#0d0d0d] px-8 py-8">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-baseline gap-3">
          <h1 className="text-white font-bold text-4xl">Agency View</h1>
          <span className="text-[#22c55e] font-semibold text-base">{mrrDisplay}</span>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-white text-black font-semibold text-sm px-4 py-2 rounded-lg hover:bg-white/90 transition-all"
        >
          Add Client <span className="text-lg leading-none">+</span>
        </button>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 mb-6 border-b border-white/8">
        {(['active', 'archived'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium capitalize transition-all border-b-2 -mb-px',
              tab === t
                ? 'text-white border-white'
                : 'text-white/30 border-transparent hover:text-white/60',
            )}
          >
            {t}
            <span className={cn(
              'ml-2 text-xs px-1.5 py-0.5 rounded-full',
              tab === t ? 'bg-white/10 text-white/60' : 'bg-white/5 text-white/20',
            )}>
              {t === 'active' ? activeProjects.length : archivedProjects.length}
            </span>
          </button>
        ))}
      </div>

      {/* ── Projects grid ─────────────────────────────────────── */}
      {visibleProjects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-10">
          {visibleProjects.map(project => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center py-20 mb-10">
          <p className="text-white/20 text-sm">
            {tab === 'active' ? 'No active clients yet.' : 'No archived clients.'}
          </p>
        </div>
      )}

      {/* ── Cross-client activity feed ────────────────────────── */}
      {tab === 'active' && <BotActivity logs={logs} />}

      {showAdd && <AddClientModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}
