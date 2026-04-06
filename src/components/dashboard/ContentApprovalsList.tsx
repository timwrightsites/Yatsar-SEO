'use client'

import Link from 'next/link'
import { FileText, Clock, CheckCircle, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Draft {
  id: string
  client_id: string
  title: string
  target_keyword: string | null
  word_count: number | null
  status: string
  created_at: string
  agent_notes: string | null
  clients: { name: string } | null
}

interface Props {
  drafts: Draft[]
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
  pending_review: { label: 'Needs Review', icon: Clock,       className: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/5' },
  approved:       { label: 'Approved',     icon: CheckCircle, className: 'text-[#22c55e] border-[#22c55e]/30 bg-[#22c55e]/5'   },
  rejected:       { label: 'Rejected',     icon: XCircle,     className: 'text-red-400 border-red-500/30 bg-red-500/5'         },
  published:      { label: 'Published',    icon: CheckCircle, className: 'text-blue-400 border-blue-500/30 bg-blue-500/5'      },
}

export function ContentApprovalsList({ drafts }: Props) {
  if (drafts.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-white/20 text-sm">No content awaiting approval.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col divide-y divide-white/5">
      {drafts.map((draft) => {
        const config = statusConfig[draft.status as keyof typeof statusConfig] ?? statusConfig.pending_review
        const Icon   = config.icon

        return (
          <Link
            key={draft.id}
            href={`/clients/${draft.client_id}?content=${draft.id}`}
            className="flex items-center justify-between gap-4 py-3 px-1 hover:bg-white/3 rounded-lg transition-all group"
          >
            {/* Left: icon + title */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/8 flex items-center justify-center shrink-0">
                <FileText size={14} className="text-white/40" />
              </div>
              <div className="min-w-0">
                <p className="text-white/80 text-sm font-medium truncate group-hover:text-white transition-colors">
                  {draft.title}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {draft.clients?.name && (
                    <span className="text-white/30 text-xs">{draft.clients.name}</span>
                  )}
                  {draft.target_keyword && (
                    <>
                      <span className="text-white/15">·</span>
                      <span className="text-white/25 text-xs truncate">{draft.target_keyword}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Right: word count + status + time */}
            <div className="flex items-center gap-3 shrink-0">
              {draft.word_count && (
                <span className="text-white/25 text-xs hidden sm:block">
                  {draft.word_count.toLocaleString()} words
                </span>
              )}
              <span className={cn(
                'flex items-center gap-1 text-[10px] border px-2 py-0.5 rounded font-medium',
                config.className
              )}>
                <Icon size={10} />
                {config.label}
              </span>
              <span className="text-white/20 text-xs w-14 text-right">{timeAgo(draft.created_at)}</span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
