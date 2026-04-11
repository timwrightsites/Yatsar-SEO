'use client'

import { useEffect, useRef } from 'react'
import { useToast } from './ToastProvider'

/**
 * Polls /api/agents/status for recently completed bot_runs and fires
 * toast notifications. Mounts once at the layout level.
 *
 * Polling strategy:
 *   - Every 10s, fetch bot_runs that finished in the last 30s
 *   - Track which run IDs we've already notified about
 *   - Fire a toast for each new completion/failure
 *   - Also dispatch 'agent-completed' custom event so panels can refresh
 */

const POLL_INTERVAL = 10_000 // 10 seconds
const LOOKBACK_MS   = 30_000 // 30 seconds

const BOT_TYPE_LABELS: Record<string, string> = {
  content: 'Writer Agent', link: 'Link Agent', technical: 'Technical Agent',
  keyword: 'Keyword Agent', analytics: 'Analytics Agent', audit: 'Crawler Agent',
  geo: 'GEO Agent', optimizer: 'Optimizer Agent', alerter: 'Alerter Agent',
  reporter: 'Reporter Agent',
}

interface BotRunUpdate {
  id: string
  bot_type: string
  status: string
  client_id: string
  client_name?: string
  finished_at: string | null
  error_message: string | null
}

export function AgentStatusPoller() {
  const { addToast } = useToast()
  const seenRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let active = true

    async function poll() {
      if (!active) return
      try {
        // Side-effect: trigger server-side session completion check
        // This catches managed agent runs that the agent didn't update itself
        fetch('/api/agents/check-sessions').catch(() => {})

        const since = new Date(Date.now() - LOOKBACK_MS).toISOString()
        const res = await fetch(`/api/agents/status?since=${encodeURIComponent(since)}`)
        if (!res.ok) return

        const runs: BotRunUpdate[] = await res.json()

        for (const run of runs) {
          if (seenRef.current.has(run.id)) continue
          seenRef.current.add(run.id)

          const agentLabel = BOT_TYPE_LABELS[run.bot_type] ?? run.bot_type
          const clientLabel = run.client_name ?? ''

          if (run.status === 'succeeded') {
            addToast({
              type: 'success',
              title: `${agentLabel} completed`,
              message: clientLabel ? `Finished for ${clientLabel}` : 'Task completed successfully',
              duration: 6000,
            })
          } else if (run.status === 'failed') {
            addToast({
              type: 'error',
              title: `${agentLabel} failed`,
              message: run.error_message?.slice(0, 100) ?? 'Unknown error',
              duration: 8000,
            })
          } else if (run.status === 'escalated') {
            addToast({
              type: 'info',
              title: `${agentLabel} needs attention`,
              message: run.error_message?.slice(0, 100) ?? 'Escalated for review',
              duration: 8000,
            })
          }

          // Notify other components
          window.dispatchEvent(new CustomEvent('agent-completed', {
            detail: { runId: run.id, botType: run.bot_type, status: run.status },
          }))
        }

        // Prune seen set to prevent memory leak (keep last 200)
        if (seenRef.current.size > 200) {
          const arr = Array.from(seenRef.current)
          seenRef.current = new Set(arr.slice(-100))
        }
      } catch {
        // Silent — polling failures shouldn't break the UI
      }
    }

    // Initial poll after 3s (let the page load first)
    const initial = setTimeout(poll, 3000)
    const interval = setInterval(poll, POLL_INTERVAL)

    return () => {
      active = false
      clearTimeout(initial)
      clearInterval(interval)
    }
  }, [addToast])

  return null // Pure side-effect component
}
