'use client'

import { useState } from 'react'
import { FileText, Clock, CheckCircle, XCircle, BookOpen } from 'lucide-react'
import { ContentEditor } from '@/components/client/ContentEditor'
import { cn } from '@/lib/utils'

interface Draft {
  id: string
  client_id: string
  title: string
  target_keyword: string | null
  word_count: number | null
  status: string
  agent_notes: string | null
  content: string | null
  created_at: string
}

interface Props {
  initialDrafts: Draft[]
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

const statusConfig = {
  pending_review: { label: 'Needs Review', icon: Clock,       row: 'border-l-yellow-500/40',  badge: 'text-yellow-400 border-yellow-500/30' },
  approved:       { label: 'Approved',     icon: CheckCircle, row: 'border-l-[#22c55e]/40',   badge: 'text-[#22c55e] border-[#22c55e]/30'  },
  rejected:       { label: 'Rejected',     icon: XCircle,     row: 'border-l-red-500/40',     badge: 'text-red-400 border-red-500/30'      },
  published:      { label: 'Published',    icon: CheckCircle, row: 'border-l-blue-500/40',    badge: 'text-blue-400 border-blue-500/30'    },
}

export function ContentSection({ initialDrafts, highlightId }: Props) {
  const [drafts, setDrafts]           = useState<Draft[]>(initialDrafts)
  const [activeDraft, setActiveDraft] = useState<Draft | null>(
    highlightId ? (initialDrafts.find(d => d.id === highlightId) ?? null) : null
  )
  const [filter, setFilter] = useState<string>('all')

  function handleStatusChange(id: string, status: string) {
    setDrafts(prev => prev.map(d => d.id === id ? { ...d, status } : d))
  }

  const filters = ['all', 'pending_review', 'approved', 'rejected', 'published']
  const visible  = filter === 'all' ? drafts : drafts.filter(d => d.status === filter)
  const pending  = drafts.filter(d => d.status === 'pending_review').length

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-white font-bold text-xl">Content</h2>
          {pending > 0 && (
            <span className="text-[10px] bg-yellow-500/15 text-yellow-400 border border-yellow-500/20 px-2 py-0.5 rounded-full font-medium">
              {pending} pending
            </span>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-white/8">
        {filters.map(f => {
          const count = f === 'all' ? drafts.length : drafts.filter(d => d.status === f).length
          const label = f === 'all' ? 'All' : (statusConfig[f as keyof typeof statusConfig]?.label ?? f)
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium capitalize transition-all border-b-2 -mb-px whitespace-nowrap',
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

      {/* Draft list */}
      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/8 flex items-center justify-center">
            <BookOpen size={20} className="text-white/20" />
          </div>
          <p className="text-white/20 text-sm">
            {filter === 'all' ? 'No content drafts yet.' : `No ${statusConfig[filter as keyof typeof statusConfig]?.label.toLowerCase() ?? filter} drafts.`}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map(draft => {
            const config = statusConfig[draft.status as keyof typeof statusConfig] ?? statusConfig.pending_review
            const Icon   = config.icon
            const isHighlighted = draft.id === highlightId

            return (
              <button
                key={draft.id}
                onClick={() => setActiveDraft(draft)}
                className={cn(
                  'w-full text-left bg-[#141414] border border-white/8 rounded-lg p-4',
                  'hover:border-white/15 hover:bg-[#1a1a1a] transition-all',
                  'border-l-2',
                  config.row,
                  isHighlighted && 'ring-1 ring-yellow-500/30'
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <FileText size={14} className="text-white/30 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-white/80 text-sm font-medium leading-snug">{draft.title}</p>
                      {draft.target_keyword && (
                        <p className="text-white/30 text-xs mt-0.5 truncate">keyword: {draft.target_keyword}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {draft.word_count && (
                      <span className="text-white/20 text-xs hidden sm:block">{draft.word_count.toLocaleString()}w</span>
                    )}
                    <span className={cn('flex items-center gap-1 text-[10px] border px-2 py-0.5 rounded font-medium', config.badge)}>
                      <Icon size={9} />
                      {config.label}
                    </span>
                    <span className="text-white/20 text-xs">{timeAgo(draft.created_at)}</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Editor modal */}
      {activeDraft && (
        <ContentEditor
          draft={activeDraft}
          onClose={() => setActiveDraft(null)}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  )
}
