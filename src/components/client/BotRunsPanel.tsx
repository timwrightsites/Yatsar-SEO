'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Loader2, CheckCircle, XCircle, AlertTriangle, Clock,
  ChevronDown, ChevronRight, Zap, ExternalLink, RefreshCw, MessageSquare,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface BotRun {
  id: string
  bot_type: string
  status: string
  client_id: string
  client_name: string | null
  client_domain: string | null
  task_id: string | null
  task_title: string | null
  task_type: string | null
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  error_message: string | null
  summary: string
  trigger_source: string
  has_output: boolean
  issue_id: string | null
  agent_name: string | null
}

// ── Status config (Monday-style colored pills) ────────────────────────────────

const STATUS_GROUPS = [
  { key: 'running',   label: 'In Progress',   color: 'bg-blue-500',    textColor: 'text-blue-400',    borderColor: 'border-blue-500/20' },
  { key: 'succeeded', label: 'Completed',      color: 'bg-[#22c55e]',  textColor: 'text-[#22c55e]',   borderColor: 'border-[#22c55e]/20' },
  { key: 'failed',    label: 'Failed',         color: 'bg-red-500',     textColor: 'text-red-400',     borderColor: 'border-red-500/20' },
  { key: 'escalated', label: 'Needs Attention', color: 'bg-yellow-500', textColor: 'text-yellow-400',  borderColor: 'border-yellow-500/20' },
  { key: 'queued',    label: 'Queued',         color: 'bg-white/30',    textColor: 'text-white/40',    borderColor: 'border-white/10' },
  { key: 'skipped',   label: 'Skipped',        color: 'bg-white/20',    textColor: 'text-white/30',    borderColor: 'border-white/8' },
] as const

const STATUS_PILL: Record<string, { bg: string; text: string; label: string }> = {
  running:   { bg: 'bg-blue-500',    text: 'text-white', label: 'Running' },
  succeeded: { bg: 'bg-[#22c55e]',   text: 'text-white', label: 'Completed' },
  failed:    { bg: 'bg-red-500',      text: 'text-white', label: 'Failed' },
  escalated: { bg: 'bg-yellow-500',   text: 'text-black', label: 'Escalated' },
  queued:    { bg: 'bg-white/20',     text: 'text-white/60', label: 'Queued' },
  skipped:   { bg: 'bg-white/10',     text: 'text-white/40', label: 'Skipped' },
}

const BOT_LABELS: Record<string, string> = {
  director: 'Director', content: 'Writer', link: 'Link', technical: 'Technical',
  keyword: 'Keyword', analytics: 'Analytics', audit: 'Crawler',
  geo: 'GEO', optimizer: 'Optimizer', alerter: 'Alerter', reporter: 'Reporter',
}

const BOT_COLORS: Record<string, string> = {
  director: 'bg-white/20 text-white',
  content: 'bg-yellow-500/15 text-yellow-300',
  link: 'bg-blue-500/15 text-blue-300',
  technical: 'bg-green-500/15 text-green-300',
  keyword: 'bg-orange-500/15 text-orange-300',
  analytics: 'bg-cyan-500/15 text-cyan-300',
  audit: 'bg-rose-500/15 text-rose-300',
  geo: 'bg-purple-500/15 text-purple-300',
  optimizer: 'bg-emerald-500/15 text-emerald-300',
  alerter: 'bg-red-500/15 text-red-300',
  reporter: 'bg-indigo-500/15 text-indigo-300',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatDuration(ms: number | null): string {
  if (!ms) return '—'
  if (ms < 1000) return '<1s'
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

// ── Expanded output viewer ─────────────────────────────────────────────────────

interface RunDetail {
  output: Record<string, unknown> | null
  agent_run: {
    id: string
    agent: string | null
    issue_id: string | null
    output_summary: string | null
    output: string | null
  } | null
}

function OutputViewer({ runId }: { runId: string }) {
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/agents/runs/${runId}`)
        if (!res.ok) throw new Error('Failed to load')
        const data = await res.json()
        setDetail({ output: data.output ?? null, agent_run: data.agent_run ?? null })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load output')
      } finally {
        setLoading(false)
      }
    })()
  }, [runId])

  if (loading) {
    return (
      <div className="px-4 py-6 flex items-center gap-2 text-white/30 text-xs">
        <Loader2 size={12} className="animate-spin" /> Loading output…
      </div>
    )
  }

  if (error) {
    return <div className="px-4 py-4 text-red-400/60 text-xs">{error}</div>
  }

  const summary = detail?.agent_run?.output_summary?.trim() ?? ''
  const agentOutputText = detail?.agent_run?.output?.trim() ?? ''
  const rawOutput = detail?.output ?? null
  const issueId = detail?.agent_run?.issue_id ?? null
  const agentName = detail?.agent_run?.agent ?? null

  if (!summary && !agentOutputText && !rawOutput) {
    return <div className="px-4 py-4 text-white/20 text-xs">No output recorded for this run.</div>
  }

  return (
    <div className="px-4 py-4 space-y-3">
      {/* Issue / agent header */}
      {(issueId || agentName) && (
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider">
          {agentName && (
            <span className="bg-white/5 border border-white/10 text-white/50 px-2 py-0.5 rounded">
              {agentName}
            </span>
          )}
          {issueId && (
            <span className="bg-blue-500/10 border border-blue-500/20 text-blue-300 px-2 py-0.5 rounded font-medium">
              {issueId}
            </span>
          )}
        </div>
      )}

      {/* Paperclip narrative summary */}
      {summary && (
        <div className="bg-white/[0.02] border border-white/8 rounded-lg p-4">
          <p className="text-[10px] uppercase tracking-wider text-white/30 mb-2">Summary</p>
          <p className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap">
            {summary}
          </p>
        </div>
      )}

      {/* Longer agent_runs.output text if present */}
      {agentOutputText && (
        <details className="bg-white/[0.02] border border-white/8 rounded-lg">
          <summary className="cursor-pointer px-4 py-2.5 text-[10px] uppercase tracking-wider text-white/30 hover:text-white/60 transition-colors">
            Full agent output
          </summary>
          <div className="px-4 pb-4">
            <p className="text-white/70 text-sm leading-relaxed whitespace-pre-wrap">
              {agentOutputText}
            </p>
          </div>
        </details>
      )}

      {/* Raw JSON fallback */}
      {rawOutput && (
        <details className="bg-black/30 border border-white/5 rounded-lg">
          <summary className="cursor-pointer px-4 py-2.5 text-[10px] uppercase tracking-wider text-white/25 hover:text-white/50 transition-colors">
            Raw JSON
          </summary>
          <pre className="px-4 pb-4 text-xs text-white/50 overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">
            {JSON.stringify(rawOutput, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}

// ── Run row ────────────────────────────────────────────────────────────────────

// Map bot_type to the chat agent ID (now 1:1 since all agents are in the dropdown)
const BOT_TO_AGENT: Record<string, string> = {
  director: 'director',
  content: 'content',
  keyword: 'keyword',
  link: 'link',
  technical: 'technical',
  audit: 'audit',
  analytics: 'analytics',
  geo: 'geo',
  optimizer: 'optimizer',
  alerter: 'alerter',
  reporter: 'reporter',
}

function RunRow({ run, showClient, onFollowUp }: { run: BotRun; showClient: boolean; onFollowUp: (run: BotRun) => void }) {
  const [expanded, setExpanded] = useState(false)
  const pill = STATUS_PILL[run.status] ?? STATUS_PILL.queued
  const botColor = BOT_COLORS[run.bot_type] ?? 'bg-white/10 text-white/50'

  return (
    <>
      <tr
        className={cn(
          'group hover:bg-white/[0.02] transition-colors cursor-pointer',
          expanded && 'bg-white/[0.02]',
        )}
        onClick={() => run.has_output && setExpanded(!expanded)}
      >
        {/* Expand arrow */}
        <td className="pl-4 pr-1 py-3 w-8">
          {run.has_output ? (
            <button className="text-white/15 group-hover:text-white/30 transition-colors">
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : (
            <span className="w-3" />
          )}
        </td>

        {/* Task name */}
        <td className="py-3 pr-4">
          <p className="text-white text-xs font-medium leading-snug truncate max-w-[260px]">
            {run.task_title ?? `${BOT_LABELS[run.bot_type] ?? run.bot_type} run`}
          </p>
        </td>

        {/* Agent */}
        <td className="py-3 pr-4">
          <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', botColor)}>
            {BOT_LABELS[run.bot_type] ?? run.bot_type}
          </span>
        </td>

        {/* Status pill */}
        <td className="py-3 pr-4">
          <span className={cn(
            'inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded font-semibold min-w-[80px] justify-center',
            pill.bg, pill.text,
          )}>
            {run.status === 'running' && <Loader2 size={9} className="animate-spin" />}
            {pill.label}
          </span>
        </td>

        {/* Date */}
        <td className="py-3 pr-4">
          <span className="text-white/30 text-[11px]">
            {formatDate(run.started_at)}
          </span>
        </td>

        {/* Duration */}
        <td className="py-3 pr-4">
          <span className="text-white/20 text-[11px]">
            {run.status === 'running' ? (
              <span className="text-blue-400/60">running…</span>
            ) : (
              formatDuration(run.duration_ms)
            )}
          </span>
        </td>

        {/* Summary */}
        <td className="py-3 pr-4">
          <p className="text-white/30 text-[11px] truncate max-w-[200px]">
            {run.error_message
              ? <span className="text-red-400/50">{run.error_message.slice(0, 80)}</span>
              : (typeof run.summary === 'string' ? run.summary : run.summary ? JSON.stringify(run.summary).slice(0, 80) : '—')
            }
          </p>
        </td>

        {/* Client (if showing all) */}
        {showClient && (
          <td className="py-3 pr-4">
            <span className="text-white/25 text-[11px]">{run.client_name ?? '—'}</span>
          </td>
        )}

        {/* Follow up */}
        <td className="py-3 pr-4">
          {(run.status === 'succeeded' || run.status === 'failed' || run.status === 'escalated') && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onFollowUp(run)
              }}
              className="flex items-center gap-1 text-[10px] text-white/20 hover:text-white/60 bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 hover:border-white/10 px-2 py-1 rounded transition-all"
            >
              <MessageSquare size={10} />
              Follow up
            </button>
          )}
        </td>
      </tr>

      {/* Expanded output */}
      {expanded && (
        <tr>
          <td colSpan={showClient ? 9 : 8} className="bg-white/[0.01] border-t border-white/4">
            <OutputViewer runId={run.id} />
          </td>
        </tr>
      )}
    </>
  )
}

// ── Main panel ─────────────────────────────────────────────────────────────────

interface BotRunsPanelProps {
  clientId?: string  // If omitted, shows all clients (dashboard view)
}

export function BotRunsPanel({ clientId }: BotRunsPanelProps) {
  const [runs, setRuns] = useState<BotRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const showClient = !clientId
  const router = useRouter()

  function handleFollowUp(run: BotRun) {
    // Navigate to the Chat tab with agent + context pre-filled
    const agentId = BOT_TO_AGENT[run.bot_type] ?? 'keyword'
    const context = run.status === 'failed'
      ? `The ${BOT_LABELS[run.bot_type] ?? run.bot_type} agent failed on "${run.task_title ?? 'a recent task'}". Error: ${run.error_message ?? 'unknown'}. What went wrong and what should we do next?`
      : `The ${BOT_LABELS[run.bot_type] ?? run.bot_type} agent just finished "${run.task_title ?? 'a recent task'}". ${run.summary || ''} Walk me through the results and what we should do next.`
    const targetClientId = run.client_id ?? clientId
    const params = new URLSearchParams({
      tab: 'chat',
      agent: agentId,
      prompt: context,
    })
    router.push(`/clients/${targetClientId}?${params.toString()}`)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = clientId ? `?clientId=${clientId}` : ''
      const res = await fetch(`/api/agents/runs${params}`)
      if (!res.ok) throw new Error('Failed to load bot runs')
      const data = await res.json()
      // Defensive: ensure data is always an array
      setRuns(Array.isArray(data) ? data : [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  // Auto-refresh on agent events
  useEffect(() => {
    const refresh = () => setTimeout(load, 1500)
    window.addEventListener('agent-dispatched', refresh)
    window.addEventListener('agent-completed', refresh)
    return () => {
      window.removeEventListener('agent-dispatched', refresh)
      window.removeEventListener('agent-completed', refresh)
    }
  }, [load])

  // Poll for running agents
  useEffect(() => {
    const hasRunning = runs.some(r => r.status === 'running')
    if (!hasRunning) return
    const interval = setInterval(load, 10_000)
    return () => clearInterval(interval)
  }, [runs, load])

  function toggleGroup(key: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (loading && runs.length === 0) {
    return (
      <div className="bg-[#141414] border border-white/8 rounded-lg p-8 flex items-center justify-center gap-2 text-white/30 text-sm">
        <Loader2 size={14} className="animate-spin" /> Loading agent runs…
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-[#141414] border border-white/8 rounded-lg p-5 text-red-400 text-sm">
        {error}
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <div className="bg-[#141414] border border-white/8 rounded-lg p-8 text-center">
        <Zap size={24} className="text-white/10 mx-auto mb-3" />
        <p className="text-white/25 text-sm">No agent runs yet</p>
        <p className="text-white/15 text-xs mt-1">
          Run an agent from a strategy task to see results here
        </p>
      </div>
    )
  }

  // Group runs by status (Monday-style)
  const grouped = STATUS_GROUPS.map(group => ({
    ...group,
    runs: runs.filter(r => r.status === group.key),
  })).filter(g => g.runs.length > 0)

  return (
    <div className="bg-[#141414] border border-white/8 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
        <div className="flex items-center gap-3">
          <h2 className="text-white font-semibold text-sm">Agent Runs</h2>
          <span className="text-white/20 text-[11px]">{runs.length} total</span>
          {runs.some(r => r.status === 'running') && (
            <span className="flex items-center gap-1 text-[10px] bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">
              <Loader2 size={8} className="animate-spin" />
              {runs.filter(r => r.status === 'running').length} running
            </span>
          )}
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-white/25 hover:text-white/50 text-[11px] transition-colors"
        >
          <RefreshCw size={10} /> Refresh
        </button>
      </div>

      {/* Status groups */}
      {grouped.map(group => {
        const isCollapsed = collapsedGroups.has(group.key)
        return (
          <div key={group.key}>
            {/* Group header (Monday-style colored bar) */}
            <button
              onClick={() => toggleGroup(group.key)}
              className={cn(
                'w-full flex items-center gap-3 px-5 py-2.5 border-b transition-colors hover:bg-white/[0.02]',
                group.borderColor,
              )}
            >
              <div className={cn('w-1.5 h-5 rounded-full shrink-0', group.color)} />
              <span className={cn('text-xs font-semibold', group.textColor)}>
                {group.label}
              </span>
              <span className="text-white/15 text-[10px]">{group.runs.length}</span>
              <div className="flex-1" />
              {isCollapsed ? <ChevronRight size={12} className="text-white/15" /> : <ChevronDown size={12} className="text-white/15" />}
            </button>

            {/* Table */}
            {!isCollapsed && (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/4">
                    <th className="w-8" />
                    <th className="text-left text-white/20 text-[10px] font-medium uppercase tracking-wider py-2 pr-4">Task</th>
                    <th className="text-left text-white/20 text-[10px] font-medium uppercase tracking-wider py-2 pr-4">Agent</th>
                    <th className="text-left text-white/20 text-[10px] font-medium uppercase tracking-wider py-2 pr-4">Status</th>
                    <th className="text-left text-white/20 text-[10px] font-medium uppercase tracking-wider py-2 pr-4">Date</th>
                    <th className="text-left text-white/20 text-[10px] font-medium uppercase tracking-wider py-2 pr-4">Duration</th>
                    <th className="text-left text-white/20 text-[10px] font-medium uppercase tracking-wider py-2 pr-4">Summary</th>
                    {showClient && (
                      <th className="text-left text-white/20 text-[10px] font-medium uppercase tracking-wider py-2 pr-4">Client</th>
                    )}
                    <th className="text-left text-white/20 text-[10px] font-medium uppercase tracking-wider py-2 pr-4 w-[90px]"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.03]">
                  {group.runs.map(run => (
                    <RunRow key={run.id} run={run} showClient={showClient} onFollowUp={handleFollowUp} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
    </div>
  )
}
