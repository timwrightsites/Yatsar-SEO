import { cn } from '@/lib/utils'
import type { ActivityLog } from '@/types'

interface BotActivityProps {
  logs: ActivityLog[]
}

const dotColor: Record<string, string> = {
  content:   'bg-yellow-400',
  link:      'bg-blue-400',
  technical: 'bg-green-400',
  geo:       'bg-green-500',
}

const statusConfig: Record<string, { label: string; className: string }> = {
  success: { label: 'Success',     className: 'border-[#22c55e] text-[#22c55e]' },
  info:    { label: 'In Progress', className: 'border-yellow-500 text-yellow-400' },
  warning: { label: 'In Progress', className: 'border-yellow-500 text-yellow-400' },
  error:   { label: 'Failed',      className: 'border-red-500 text-red-400' },
}

function timeAgo(dateStr: string): string {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`
  return `${Math.floor(diff / 86400)} days ago`
}

export function BotActivity({ logs }: BotActivityProps) {
  return (
    <div>
      <h2 className="text-white font-bold text-xl mb-4">Bot Activity</h2>
      <div className="border border-white/8 rounded-lg overflow-hidden">
        {logs.map((log, i) => {
          const dot = dotColor[log.bot_type ?? ''] ?? 'bg-white/30'
          const status = statusConfig[log.status] ?? statusConfig.info
          return (
            <div
              key={log.id}
              className={cn(
                'flex items-center gap-4 px-5 py-4',
                i !== logs.length - 1 && 'border-b border-white/5'
              )}
            >
              {/* Colored dot */}
              <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', dot)} />

              {/* Text */}
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-sm leading-tight">{log.message}</p>
                <p className="text-white/40 text-xs mt-0.5">
                  {log.metadata && typeof log.metadata === 'object' && 'domain' in log.metadata
                    ? String((log.metadata as Record<string, unknown>).domain)
                    : 'yatsar.agency'}{' '}
                  • {timeAgo(log.created_at)}
                </p>
              </div>

              {/* Status badge */}
              <span className={cn('text-xs border px-3 py-1 rounded-md font-medium shrink-0', status.className)}>
                {status.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
