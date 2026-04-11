'use client'

import { useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface AgentPanelProps {
  clientId: string
}

const AGENTS = [
  { id: 'keyword',   label: 'Keyword Agent' },
  { id: 'content',   label: 'Content Writer' },
  { id: 'link',      label: 'Link Builder' },
  { id: 'technical', label: 'Technical SEO' },
  { id: 'audit',     label: 'Site Crawler' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'geo',       label: 'GEO / Local' },
  { id: 'optimizer', label: 'Optimizer' },
  { id: 'alerter',   label: 'Alerter' },
  { id: 'reporter',  label: 'Reporter' },
]

export default function AgentPanel({ clientId }: AgentPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [agentId, setAgentId] = useState('keyword')
  const [isStreaming, setIsStreaming] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [followUpApplied, setFollowUpApplied] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const searchParams = useSearchParams()

  // Pick up follow-up context from URL params (set by Bot Runs "Follow up" button)
  useEffect(() => {
    if (followUpApplied) return
    const agentParam = searchParams.get('agent')
    const promptParam = searchParams.get('prompt')
    if (agentParam && AGENTS.some(a => a.id === agentParam)) {
      setAgentId(agentParam)
    }
    if (promptParam) {
      setInput(promptParam)
      setFollowUpApplied(true)
      // Focus the textarea after a tick
      setTimeout(() => textareaRef.current?.focus(), 100)
    }
  }, [searchParams, followUpApplied])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return

    const userMessage: Message = { role: 'user', content: trimmed }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setInput('')
    setIsStreaming(true)

    // Add empty assistant message to stream into
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    try {
      const res = await fetch('/api/agent/managed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          messages: nextMessages,
          agentId,
          sessionId, // Continue existing session for multi-turn
        }),
      })

      if (!res.ok || !res.body) {
        let detail = `Status ${res.status}`
        try {
          const errBody = await res.json()
          const parts = [errBody.error, errBody.detail].filter(Boolean)
          detail = parts.join(' — ') || detail
        } catch {}
        throw new Error(detail)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6))

              // Capture sessionId for multi-turn
              if (data.sessionId && !sessionId) {
                setSessionId(data.sessionId)
              }

              const chunk = data.choices?.[0]?.delta?.content || ''
              if (chunk) {
                setMessages(prev => {
                  const updated = [...prev]
                  updated[updated.length - 1] = {
                    role: 'assistant',
                    content: updated[updated.length - 1].content + chunk,
                  }
                  return updated
                })
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant',
          content: `Agent error: ${errMsg}`,
        }
        return updated
      })
    } finally {
      setIsStreaming(false)
      // Signal StrategyPanel (and any other listeners) to refresh
      window.dispatchEvent(new CustomEvent('strategy-updated'))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Reset session when switching agents
  const switchAgent = (newAgentId: string) => {
    setAgentId(newAgentId)
    setMessages([])
    setSessionId(null)
  }

  return (
    <div className="flex flex-col h-full min-h-[500px] bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">AI Agent</span>
          <span className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-yellow-400 animate-pulse' : 'bg-emerald-400'}`} />
          {sessionId && (
            <span className="text-[9px] text-white/20 bg-white/5 px-1.5 py-0.5 rounded">
              session active
            </span>
          )}
        </div>
        <select
          value={agentId}
          onChange={e => switchAgent(e.target.value)}
          disabled={isStreaming}
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        >
          {AGENTS.map(a => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </select>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <div className="text-3xl mb-3">🤖</div>
            <p className="text-gray-400 text-sm font-medium">
              {AGENTS.find(a => a.id === agentId)?.label}
            </p>
            <p className="text-gray-600 text-xs mt-1 max-w-xs">
              {agentId === 'keyword' && 'Keyword research, gap analysis, competitive targets, and opportunity scoring.'}
              {agentId === 'content' && 'Content briefs, article drafts, on-page optimization, and content strategy.'}
              {agentId === 'link' && 'Link prospecting, outreach drafts, backlink opportunities, and competitor analysis.'}
              {agentId === 'technical' && 'Technical SEO fixes, site speed, schema markup, and crawlability.'}
              {agentId === 'audit' && 'Full site audits, Core Web Vitals, indexation, and crawl issues.'}
              {agentId === 'analytics' && 'Traffic analysis, rank tracking, conversion insights, and reporting.'}
              {agentId === 'geo' && 'Local SEO, GBP optimization, citation building, and AEO opportunities.'}
              {agentId === 'optimizer' && 'Page-level optimization, meta tags, internal linking, and quick wins.'}
              {agentId === 'alerter' && 'Rank drops, indexation issues, traffic anomalies, and competitor moves.'}
              {agentId === 'reporter' && 'Client reports, progress summaries, and performance dashboards.'}
            </p>
            <p className="text-gray-700 text-[10px] mt-3">
              Powered by Claude Managed Agents
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-gray-800 text-gray-100 rounded-bl-sm'
              }`}
            >
              {msg.content}
              {msg.role === 'assistant' && isStreaming && i === messages.length - 1 && (
                <span className="inline-block w-1.5 h-4 ml-0.5 bg-gray-400 animate-pulse rounded-sm align-middle" />
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-800 bg-gray-900">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            rows={1}
            placeholder={`Ask ${AGENTS.find(a => a.id === agentId)?.label ?? 'your agent'}...`}
            className="flex-1 resize-none bg-gray-800 text-white text-sm rounded-xl px-3 py-2.5 placeholder-gray-500 border border-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 max-h-32 overflow-y-auto"
            style={{ lineHeight: '1.5' }}
          />
          <button
            onClick={sendMessage}
            disabled={isStreaming || !input.trim()}
            className="flex-shrink-0 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl px-4 py-2.5 text-sm font-medium transition-colors"
          >
            {isStreaming ? '...' : 'Send'}
          </button>
        </div>
        <p className="text-gray-600 text-xs mt-1.5 ml-1">Shift+Enter for new line · Enter to send</p>
      </div>
    </div>
  )
}
