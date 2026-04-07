'use client'

import { useState } from 'react'
import {
  Link2, TrendingUp, Mail, MailCheck, MailX, ExternalLink,
  Clock, Trophy, Ban,
} from 'lucide-react'
import { OutreachEditor, type ProspectWithDraft } from '@/components/client/OutreachEditor'
import { cn } from '@/lib/utils'

interface Props {
  initialProspects: ProspectWithDraft[]
  highlightId?: string | null
}

function timeAgo(dateStr: string): string {
  const diff  = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (hours < 1)  return 'just now'
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

const prospectStatusConfig: Record<string, { label: string; icon: typeof Clock; row: string; badge: string }> = {
  new:       { label: 'New',       icon: Clock,        row: 'border-l-yellow-500/40', badge: 'text-yellow-400 border-yellow-500/30' },
  contacted: { label: 'Contacted', icon: Mail,         row: 'border-l-blue-500/40',   badge: 'text-blue-400 border-blue-500/30'    },
  replied:   { label: 'Replied',   icon: MailCheck,    row: 'border-l-purple-500/40', badge: 'text-purple-400 border-purple-500/30' },
  won:       { label: 'Won',       icon: Trophy,       row: 'border-l-[#22c55e]/40',  badge: 'text-[#22c55e] border-[#22c55e]/30'  },
  rejected:  { label: 'Rejected',  icon: MailX,        row: 'border-l-red-500/40',    badge: 'text-red-400 border-red-500/30'      },
  dismissed: { label: 'Dismissed', icon: Ban,          row: 'border-l-white/10',      badge: 'text-white/30 border-white/10'       },
}

const draftStatusBadge: Record<string, { label: string; className: string }> = {
  pending_review: { label: 'Draft ready',   className: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/5' },
  approved:       { label: 'Draft approved', className: 'text-[#22c55e] border-[#22c55e]/30 bg-[#22c55e]/5' },
  sent:           { label: 'Sent',           className: 'text-blue-400 border-blue-500/30 bg-blue-500/5' },
  rejected:       { label: 'Draft rejected', className: 'text-red-400 border-red-500/30 bg-red-500/5' },
}

export function LinkProspectsSection({ initialProspects, highlightId }: Props) {
  const [prospects, setProspects]   = useState<ProspectWithDraft[]>(initialProspects)
  const [active, setActive]         = useState<ProspectWithDraft | null>(
    highlightId ? (initialProspects.find(p => p.id === highlightId) ?? null) : null
  )
  const [filter, setFilter] = useState<string>('all')

  function handleProspectStatusChange(id: string, status: string) {
    setProspects(prev => prev.map(p => p.id === id ? { ...p, status } : p))
  }

  function handleDraftStatusChange(prospectId: string, draftStatus: string) {
    setProspects(prev =>
      prev.map(p =>
        p.id === prospectId && p.draft
          ? { ...p, draft: { ...p.draft, status: draftStatus } }
          : p
      )
    )
  }

  const filters = ['all', 'new', 'contacted', 'replied', 'won', 'rejected']
  const visible =
    filter === 'all' ? prospects : prospects.filter(p => p.status === filter)
  const newCount = prospects.filter(p => p.status === 'new').length
  const draftsReady = prospects.filter(p => p.draft?.status === 'pending_review').length

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-white font-bold text-xl">Link Prospects</h2>
          {newCount > 0 && (
            <span className="text-[10px] bg-yellow-500/15 text-yellow-400 border border-yellow-500/20 px-2 py-0.5 rounded-full font-medium">
              {newCount} new
            </span>
          )}
          {draftsReady > 0 && (
            <span className="text-[10px] bg-blue-500/15 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full font-medium">
              {draftsReady} draft{draftsReady === 1 ? '' : 's'} ready
            </span>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-white/8">
        {filters.map(f => {
          const count = f === 'all' ? prospects.length : prospects.filter(p => p.status === f).length
          const label = f === 'all' ? 'All' : (prospectStatusConfig[f]?.label ?? f)
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-all border-b-2 -mb-px whitespace-nowrap',
                filter === f
                  ? 'text-white border-white'
                  : 'text-white/30 border-transparent hover:text-white/60'
              )}
            >
              {label}
              <span className={cn(
                'ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full',
                filter === f ? 'bg-white/10 text-white/60' : 'bg-white/5 text-white/20'
              )}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Prospect list */}
      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/8 flex items-center justify-center">
            <Link2 size={20} className="text-white/20" />
          </div>
          <p className="text-white/20 text-sm">
            {filter === 'all' ? 'No link prospects yet.' : `No ${prospectStatusConfig[filter]?.label.toLowerCase() ?? filter} prospects.`}
          </p>
          {filter === 'all' && (
            <p className="text-white/15 text-xs">Create a strategy task of type=link to trigger the Link Bot.</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map(prospect => {
            const config = prospectStatusConfig[prospect.status] ?? prospectStatusConfig.new
            const Icon = config.icon
            const draftBadge = prospect.draft ? draftStatusBadge[prospect.draft.status] : null
            const isHighlighted = prospect.id === highlightId
            const dr = prospect.domain_rating

            return (
              <button
                key={prospect.id}
                onClick={() => setActive(prospect)}
                className={cn(
                  'w-full text-left bg-[#141414] border border-white/8 rounded-lg p-4',
                  'hover:border-white/15 hover:bg-[#1a1a1a] transition-all',
                  'border-l-2',
                  config.row,
                  isHighlighted && 'ring-1 ring-yellow-500/30'
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <Link2 size={14} className="text-white/30 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-white/80 text-sm font-medium leading-snug truncate">{prospect.domain}</p>
                        <a
                          href={`https://${prospect.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="text-white/20 hover:text-white/60 transition-colors shrink-0"
                        >
                          <ExternalLink size={11} />
                        </a>
                      </div>
                      {prospect.why && (
                        <p className="text-white/30 text-xs mt-0.5 line-clamp-1">{prospect.why}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* DR */}
                    {dr !== null && (
                      <span className="hidden md:flex items-center gap-1 text-white/40 text-[11px] font-medium">
                        <TrendingUp size={10} />
                        DR {dr}
                      </span>
                    )}
                    {/* Score */}
                    <span className="hidden md:inline text-white/30 text-[11px]">
                      {prospect.prospect_score.toFixed(1)}
                    </span>
                    {/* Competitor count */}
                    <span className="hidden sm:inline text-white/30 text-[11px]">
                      {prospect.competitor_link_count} comp
                    </span>
                    {/* Draft badge if exists */}
                    {draftBadge && (
                      <span className={cn('text-[10px] border px-2 py-0.5 rounded font-medium', draftBadge.className)}>
                        {draftBadge.label}
                      </span>
                    )}
                    {/* Status badge */}
                    <span className={cn('flex items-center gap-1 text-[10px] border px-2 py-0.5 rounded font-medium', config.badge)}>
                      <Icon size={9} />
                      {config.label}
                    </span>
                    <span className="text-white/20 text-xs hidden lg:block">{timeAgo(prospect.created_at)}</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {active && (
        <OutreachEditor
          prospect={active}
          onClose={() => setActive(null)}
          onProspectStatusChange={handleProspectStatusChange}
          onDraftStatusChange={handleDraftStatusChange}
        />
      )}
    </div>
  )
}

export { type ProspectWithDraft }
