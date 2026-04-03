import { cn } from '@/lib/utils'
import type { ActivityLog } from '@/types'

interface ActivityFeedProps {
  logs: ActivityLog[]
}

const statusDot: Record<string, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-yellow-500',
  error: 'bg-red-500',
  info: 'bg-blue-500',
}

const botLabel: Record<string, string> = {
  content: 'Content',
  link: 'Link',
  technical: 'Technical',
  geo: 'GEO',
}

function timeAgo(dateStr: string): string {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function ActivityFeed({ logs }: ActivityFeedProps) {
  return (
    <div className="space-y-0">
      {logs.map((log, i) => (
        <div key={log.id} className={cn('flex gap-3 py-3', i !== logs.length - 1 && 'border-b border-white/5')}>
          {/* Dot */}
          <div className="flex flex-col items-center pt-1.5">
            <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', statusDot[log.status] ?? 'bg-slate-500')} />
          </div>
          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              {log.bot_type && (
                <span className="text-[10px] font-medium text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded">
                  {botLabel[log.bot_type] ?? log.bot_type} Bot
                </span>
              )}
              <span className="text-[11px] text-slate-500 ml-auto">{timeAgo(log.created_at)}</span>
            </div>
            <p className="text-sm text-slate-300 leading-snug">{log.message}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
