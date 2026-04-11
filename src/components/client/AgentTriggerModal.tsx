'use client'

import { useState, useEffect } from 'react'
import { X, Loader2, Zap, Play, ChevronDown, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

type BotType =
  | 'content' | 'link' | 'technical'
  | 'analytics' | 'audit' | 'keyword' | 'geo'
  | 'optimizer' | 'alerter' | 'reporter'

interface PresetPrompt {
  label: string
  value: string
}

interface AgentPreset {
  label: string
  prompts: PresetPrompt[]
}

interface AgentTriggerModalProps {
  taskId:    string
  taskTitle: string
  taskType:  string
  clientId:  string
  onClose:   () => void
  onSuccess: (result: { runId: string; sessionId: string }) => void
}

// ── Preset prompts per agent type ──────────────────────────────────────────────

const AGENT_PRESETS: Record<string, AgentPreset> = {
  analytics: {
    label: 'Analytics Agent',
    prompts: [
      { label: 'Monthly traffic rollup', value: 'Run a monthly traffic rollup — summarize organic sessions, top growing/declining keywords, and click trends.' },
      { label: 'Core Web Vitals audit', value: 'Run a Core Web Vitals audit — check LCP, FID, CLS for the top 10 pages and flag anything failing.' },
      { label: 'GSC performance snapshot', value: 'Pull a GSC performance snapshot — top queries by clicks, impressions, CTR, and average position for the last 28 days.' },
    ],
  },
  audit: {
    label: 'Crawler Agent',
    prompts: [
      { label: 'Full site crawl', value: 'Run a full technical crawl — check for broken links, missing meta tags, redirect chains, thin content, and orphan pages.' },
      { label: 'Indexation audit', value: 'Run an indexation audit — compare sitemap URLs vs indexed URLs, find noindex issues, and check robots.txt.' },
      { label: 'Page speed check', value: 'Run a page speed check on the top 10 traffic pages — flag anything with LCP > 2.5s or CLS > 0.1.' },
    ],
  },
  keyword: {
    label: 'Keyword Agent',
    prompts: [
      { label: 'Opportunity scan', value: 'Run a keyword opportunity scan — find keywords in positions 4-20 with high volume where we can push to page 1.' },
      { label: 'Competitor gap analysis', value: 'Run a competitor keyword gap analysis — find high-value keywords our competitors rank for that we don\'t.' },
      { label: 'Content gap finder', value: 'Find content gaps — topics with search volume in our niche that we have zero coverage on.' },
    ],
  },
  content: {
    label: 'Writer Agent',
    prompts: [
      { label: 'Write article from task', value: 'Write the article as specified in the task description. Target striking-distance keywords from the Ahrefs data.' },
      { label: 'GEO-optimized article', value: 'Write a GEO-optimized article — structure it for AI Overview citations with question H2s, Key Takeaways, and FAQ schema hints.' },
    ],
  },
  link: {
    label: 'Link Agent',
    prompts: [
      { label: 'Ahrefs link gap analysis', value: 'Run an Ahrefs link gap analysis against our top 3 competitors. Find prospects with DR 20-70 that link to competitors but not us.' },
      { label: 'Draft outreach emails', value: 'Research the link targets in the task metadata and draft personalized outreach emails for each prospect.' },
    ],
  },
  geo: {
    label: 'GEO Agent',
    prompts: [
      { label: 'AI visibility audit', value: 'Run a GEO visibility audit — check which of our keywords trigger AI Overviews, whether we\'re cited, and identify gaps.' },
      { label: 'Citation opportunity scan', value: 'Scan for citation opportunities — find AI Overview queries in our niche where we have ranking content but aren\'t being cited.' },
    ],
  },
  optimizer: {
    label: 'Optimizer Agent',
    prompts: [
      { label: 'On-page optimization', value: 'Run an on-page optimization pass — rewrite title tags, meta descriptions, H1s, and internal link suggestions for the specified pages.' },
      { label: 'Content refresh', value: 'Identify stale content (>6 months, declining traffic) and suggest specific updates to regain rankings.' },
    ],
  },
  alerter: {
    label: 'Alerter Agent',
    prompts: [
      { label: 'Anomaly check', value: 'Run an anomaly check — compare this week vs last week for traffic, rankings, and indexation. Flag anything that dropped >15%.' },
      { label: 'Competitor movement alert', value: 'Check if any competitors had major ranking movements this week on our target keywords.' },
    ],
  },
  reporter: {
    label: 'Reporter Agent',
    prompts: [
      { label: 'Monthly SEO recap', value: 'Generate a monthly SEO recap report — organic traffic trends, keyword movements, content published, links acquired, and next month priorities.' },
      { label: 'Client-facing summary', value: 'Write a client-facing summary email — plain English, highlight wins, explain any drops, and list next steps.' },
    ],
  },
  technical: {
    label: 'Technical Agent',
    prompts: [
      { label: 'PageSpeed analysis', value: 'Run a full PageSpeed analysis and generate technical recommendations with priority rankings.' },
      { label: 'Schema markup audit', value: 'Audit the site\'s structured data — check for missing schema types, validation errors, and opportunities.' },
    ],
  },
}

// Task type → bot type mapping
const TASK_TYPE_TO_BOT: Record<string, BotType | undefined> = {
  technical: 'technical', content: 'content', link: 'link',
  meta: 'content', keyword: 'keyword', analytics: 'analytics',
  audit: 'audit', geo: 'geo', optimizer: 'optimizer',
  alerter: 'alerter', reporter: 'reporter',
}

const BOT_TYPE_COLORS: Record<string, string> = {
  content: 'from-yellow-500/20 to-yellow-600/5',
  technical: 'from-green-500/20 to-green-600/5',
  link: 'from-blue-500/20 to-blue-600/5',
  keyword: 'from-orange-500/20 to-orange-600/5',
  analytics: 'from-cyan-500/20 to-cyan-600/5',
  audit: 'from-rose-500/20 to-rose-600/5',
  geo: 'from-purple-500/20 to-purple-600/5',
  optimizer: 'from-emerald-500/20 to-emerald-600/5',
  alerter: 'from-red-500/20 to-red-600/5',
  reporter: 'from-indigo-500/20 to-indigo-600/5',
}

// ── Component ──────────────────────────────────────────────────────────────────

export function AgentTriggerModal({
  taskId, taskTitle, taskType, clientId, onClose, onSuccess,
}: AgentTriggerModalProps) {
  const defaultBotType = TASK_TYPE_TO_BOT[taskType] ?? 'content'
  const [selectedBot, setSelectedBot] = useState<BotType>(defaultBotType)
  const [customPrompt, setCustomPrompt] = useState('')
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [dispatching, setDispatching] = useState(false)
  const [error, setError] = useState('')
  const [showBotPicker, setShowBotPicker] = useState(false)

  const preset = AGENT_PRESETS[selectedBot]
  const gradientColor = BOT_TYPE_COLORS[selectedBot] ?? 'from-white/10 to-white/5'

  // When switching bot, reset preset selection
  useEffect(() => {
    setSelectedPreset(null)
    setCustomPrompt('')
  }, [selectedBot])

  function selectPreset(value: string) {
    if (selectedPreset === value) {
      // Deselect
      setSelectedPreset(null)
      setCustomPrompt('')
    } else {
      setSelectedPreset(value)
      setCustomPrompt(value)
    }
  }

  async function dispatch() {
    setDispatching(true)
    setError('')

    try {
      const res = await fetch('/api/agents/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId,
          triggerSource: 'manual',
          customPrompt: customPrompt.trim() || undefined,
          botTypeOverride: selectedBot !== defaultBotType ? selectedBot : undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.ok) {
        setError(data.error ?? data.reason ?? 'Dispatch failed')
        setDispatching(false)
        return
      }

      onSuccess({ runId: data.runId, sessionId: data.sessionId })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
      setDispatching(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-[#141414] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Gradient accent top */}
        <div className={cn('h-1 bg-gradient-to-r', gradientColor)} />

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/8">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br',
              gradientColor,
            )}>
              <Zap size={14} className="text-white/80" />
            </div>
            <div>
              <h2 className="text-white font-bold text-sm">Run Agent</h2>
              <p className="text-white/30 text-[11px] mt-0.5 max-w-[280px] truncate">{taskTitle}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">

          {/* Agent picker */}
          <div>
            <label className="block text-white/40 text-xs font-medium mb-2">Agent</label>
            <div className="relative">
              <button
                onClick={() => setShowBotPicker(!showBotPicker)}
                className="w-full flex items-center justify-between bg-white/5 border border-white/8 rounded-lg px-3 py-2.5 text-sm text-white hover:border-white/15 transition-colors"
              >
                <span>{preset?.label ?? selectedBot}</span>
                <ChevronDown size={14} className={cn('text-white/30 transition-transform', showBotPicker && 'rotate-180')} />
              </button>

              {showBotPicker && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl z-10 max-h-[200px] overflow-y-auto">
                  {Object.entries(AGENT_PRESETS).map(([key, { label }]) => (
                    <button
                      key={key}
                      onClick={() => { setSelectedBot(key as BotType); setShowBotPicker(false) }}
                      className={cn(
                        'w-full text-left px-3 py-2 text-sm hover:bg-white/5 transition-colors',
                        selectedBot === key ? 'text-white bg-white/5' : 'text-white/60',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Preset prompts */}
          {preset && preset.prompts.length > 0 && (
            <div>
              <label className="block text-white/40 text-xs font-medium mb-2">Quick prompts</label>
              <div className="flex flex-col gap-1.5">
                {preset.prompts.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => selectPreset(p.value)}
                    className={cn(
                      'text-left px-3 py-2 rounded-lg border text-xs transition-all',
                      selectedPreset === p.value
                        ? 'border-white/20 bg-white/8 text-white'
                        : 'border-white/6 bg-white/3 text-white/50 hover:border-white/10 hover:text-white/70',
                    )}
                  >
                    <span className="font-medium">{p.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Custom prompt */}
          <div>
            <label className="flex items-center gap-1.5 text-white/40 text-xs font-medium mb-2">
              <MessageSquare size={10} />
              Custom instructions
              <span className="text-white/20">(optional)</span>
            </label>
            <textarea
              value={customPrompt}
              onChange={(e) => { setCustomPrompt(e.target.value); setSelectedPreset(null) }}
              placeholder="Add specific instructions for this agent run..."
              rows={3}
              className="w-full bg-white/5 border border-white/8 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/20 outline-none focus:border-white/20 transition-colors resize-none"
            />
          </div>

          {error && (
            <p className="text-red-400 text-xs bg-red-400/5 border border-red-400/10 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 pb-6">
          <p className="text-white/15 text-[10px]">
            Agent will run autonomously and update the dashboard
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-white/40 hover:text-white/70 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={dispatch}
              disabled={dispatching}
              className={cn(
                'flex items-center gap-2 font-semibold text-sm px-5 py-2 rounded-lg transition-all disabled:opacity-50',
                'bg-white text-black hover:bg-white/90',
              )}
            >
              {dispatching ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Dispatching…
                </>
              ) : (
                <>
                  <Play size={12} />
                  Run Agent
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
