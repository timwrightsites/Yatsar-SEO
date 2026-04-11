'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import {
  Bell, CheckCircle, XCircle, AlertTriangle, Loader2, ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'

// ── Types ──────────────────────────────────────────────────────────────────────

interface AgentEvent {
  id: string
  bot_type: string
  status: string
  client_id: string
  client_name: string | null
  finished_at: string | null
  started_at: string | null
  error_message: string | null
  duration_ms: number | null
}

const BOT_LABELS: Record<string, string> = {
  content: 'Writer', link: 'Link', technical: 'Technical',
  keyword: 'Keyword', analytics: 'Analytics', audit: 'Crawler',
  geo: 'GEO', optimizer: 'Optimizer', alerter: 'Alerter', reporter: 'Reporter',
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  succeeded: {
    icon: <CheckCircle size={12} />,
    color: 'text-[#22c55e]',
    label: 'Completed',
  },
  failed: {
    icon: <XCircle size={12} />,
    color: 'text-red-400',
    label: 'Failed',
  },
  escalated: {
    icon: <AlertTriangle size={12} />,
    color: 'text-yellow-400',
    label: 'Escalated',
  },
  running: {
    icon: <Loader2 size={12} className="animate-spin" />,
    color: 'text-blue-400',
    label: 'Running',
  },
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function formatDuration(ms: number | null): string {
  if (!ms) return ''
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60000)}m`
}

// ── Component ──────────────────────────────────────────────────────────────────

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [lastSeen, setLastSeen] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Fetch recent bot_runs (completed + running)
  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/notifications')
      if (!res.ok) return
      const data: AgentEvent[] = await res.json()
      setEvents(data)

      // Count unread (finished after lastSeen)
      if (lastSeen) {
        const newCount = data.filter(
          e => e.finished_at && new Date(e.finished_at) > new Date(lastSeen)
        ).length
        setUnreadCount(newCount)
      } else {
        // First load — count running ones as "unread"
        setUnreadCount(data.filter(e => e.status === 'running').length)
      }
    } catch {
      // Silent
    }
  }, [lastSeen])

  // Poll every 10s
  useEffect(() => {
    fetchEvents()
    const interval = setInterval(fetchEvents, 10_000)
    return () => clearInterval(interval)
  }, [fetchEvents])

  // Refresh on agent events
  useEffect(() => {
    const refresh = () => setTimeout(fetchEvents, 1000)
    window.addEventListener('agent-dispatched', refresh)
    window.addEventListener('agent-completed', refresh)
    return () => {
      window.removeEventListener('agent-dispatched', refresh)
      window.removeEventListener('agent-completed', refresh)
    }
  }, [fetchEvents])

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function handleOpen() {
    setOpen(prev => !prev)
    if (!open) {
      // Mark all as read
      setLastSeen(new Date().toISOString())
      setUnreadCount(0)
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        onClick={handleOpen}
        className={cn(
          'relative w-8 h-8 flex items-center justify-center rounded-lg border transition',
          open
            ? 'bg-white/10 border-white/15 text-white'
            : 'bg-white/5 border-white/5 text-slate-400 hover:text-slate-200',
        )}
      >
        <Bell size={15} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center bg-violet-500 text-white text-[9px] font-bold rounded-full px-1">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
          {/* Header */}
          <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
            <p className="text-white text-xs font-semibold">Agent Activity</p>
            <span className="text-white/20 text-[10px]">{events.length} recent</span>
          </div>

          {/* Events list */}
          <div className="max-h-[360px] overflow-y-auto">
            {events.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-white/20 text-xs">No recent agent activity</p>
              </div>
            ) : (
              events.map(event => {
                const config = STATUS_CONFIG[event.status] ?? STATUS_CONFIG.running
                const timestamp = event.finished_at ?? event.started_at
                return (
                  <Link
                    key={event.id}
                    href={`/clients/${event.client_id}`}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-white/3 transition-colors border-b border-white/4 last:border-0"
                  >
                    <div className={cn('mt-0.5', config.color)}>{config.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-white text-xs font-medium">
                          {BOT_LABELS[event.bot_type] ?? event.bot_type}
                        </span>
                        <span className={cn('text-[10px]', config.color)}>
                          {config.label}
                        </span>
                      </div>
                      {event.client_name && (
                        <p className="text-white/30 text-[11px] truncate">{event.client_name}</p>
                      )}
                      {event.status === 'failed' && event.error_message && (
                        <p className="text-red-400/60 text-[10px] truncate mt-0.5">
                          {event.error_message.slice(0, 80)}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      {timestamp && (
                        <p className="text-white/15 text-[10px]">{timeAgo(timestamp)}</p>
                      )}
                      {event.duration_ms ? (
                        <p className="text-white/10 text-[10px]">{formatDuration(event.duration_ms)}</p>
                      ) : null}
                    </div>
                  </Link>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
