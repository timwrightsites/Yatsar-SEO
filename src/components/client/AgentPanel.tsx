'use client'

import { useState, useRef, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface AgentPanelProps {
  clientId: string
}

const AGENTS = [
  { id: 'seo-co-strategist', label: 'SEO Co-Strategist' },
  { id: 'growth-director', label: 'Growth Director' },
  { id: 'audit-director', label: 'Audit Director' },
  { id: 'content-director', label: 'Content Director' },
]

export default function AgentPanel({ clientId }: AgentPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [agentId, setAgentId] = useState('seo-co-strategist')
  const [isStreaming, setIsStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, messages: nextMessages, agentId }),
      })

      if (!res.ok || !res.body) {
        throw new Error('Agent request failed')
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
    } catch {
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant',
          content: 'Something went wrong. Please try again.',
        }
        return updated
      })
    } finally {
      setIsStreaming(false)
      // Signal StrategyPanel (and any other listeners) to refresh —
      // the agent may have included a :::strategy block that was saved server-side
      window.dispatchEvent(new CustomEvent('strategy-updated'))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="flex flex-col h-full min-h-[500px] bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">AI Agent</span>
          <span className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-yellow-400 animate-pulse' : 'bg-emerald-400'}`} />
        </div>
        <select
          value={agentId}
          onChange={e => {
            setAgentId(e.target.value)
            setMessages([])
          }}
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
              {agentId === 'seo-co-strategist' && 'Your SEO strategist. Ask about rankings, opportunities, strategy, or kick off a full audit.'}
              {agentId === 'growth-director' && 'Keyword research, rank tracking, competitive analysis, and AEO opportunities.'}
              {agentId === 'audit-director' && 'Technical SEO health, Core Web Vitals, indexation, and crawlability issues.'}
              {agentId === 'content-director' && 'Content briefs, on-page optimization, internal linking, and content performance.'}
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
