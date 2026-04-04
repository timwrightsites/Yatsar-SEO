'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, ChevronDown, Bot, User, Loader } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────

interface Client {
  id: string
  name: string
  domain: string
  industry: string | null
  status: string
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  clientName?: string
  agentId?: string
}

interface Props {
  clients: Client[]
}

// ── Agents ─────────────────────────────────────────────────────────────────

const AGENTS = [
  { value: 'seo-co-strategist', label: 'SEO Co-Strategist' },
  { value: 'growth-director',   label: 'Growth Director'   },
  { value: 'audit-director',    label: 'Audit Director'    },
  { value: 'content-director',  label: 'Content Director'  },
]

const QUICK_TASKS = [
  'Summarise this week\'s SEO performance',
  'Find keyword opportunities',
  'Run a technical site audit',
  'Create a content brief',
  'Analyse competitor rankings',
  'Check indexation health',
  'Identify link building opportunities',
  'Generate a monthly report',
]

// ── Dropdown ───────────────────────────────────────────────────────────────

function Dropdown({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selected = options.find((o) => o.value === value)

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 text-white/80 text-sm hover:border-white/30 hover:text-white transition-all"
      >
        {selected ? selected.label : label}
        <ChevronDown size={13} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute bottom-full mb-2 left-0 w-52 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
          <div className="px-3 py-2 text-xs text-white/30 border-b border-white/5">
            {label}
          </div>
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={cn(
                'w-full text-left px-3 py-2.5 text-sm transition-all',
                value === opt.value
                  ? 'text-white bg-white/8'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Message bubble ─────────────────────────────────────────────────────────

function MessageBubble({ msg, isStreaming }: { msg: Message; isStreaming: boolean }) {
  const isUser = msg.role === 'user'
  const agentLabel = AGENTS.find(a => a.value === msg.agentId)?.label ?? 'AI Agent'

  return (
    <div className={cn('flex gap-3 max-w-3xl', isUser ? 'ml-auto flex-row-reverse' : 'mr-auto')}>
      {/* Avatar */}
      <div className={cn(
        'w-8 h-8 rounded-full shrink-0 flex items-center justify-center mt-0.5',
        isUser ? 'bg-white/10' : 'bg-[#22c55e]/10 border border-[#22c55e]/20'
      )}>
        {isUser
          ? <User size={14} className="text-white/60" />
          : <Bot size={14} className="text-[#22c55e]" />
        }
      </div>

      {/* Bubble */}
      <div>
        {!isUser && msg.agentId && (
          <div className="text-xs text-white/30 mb-1 ml-0.5">
            {agentLabel}
            {msg.clientName && (
              <span className="ml-1.5 text-white/20">· {msg.clientName}</span>
            )}
          </div>
        )}
        <div className={cn(
          'px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap',
          isUser
            ? 'bg-white/8 text-white rounded-tr-sm'
            : 'bg-[#161616] border border-white/8 text-white/85 rounded-tl-sm'
        )}>
          {msg.content}
          {!isUser && isStreaming && (
            <span className="inline-block w-1.5 h-4 ml-0.5 bg-white/30 animate-pulse rounded-sm align-middle" />
          )}
        </div>
        <div className={cn('text-[11px] text-white/20 mt-1', isUser ? 'text-right' : 'text-left')}>
          {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────

function EmptyState({ agentLabel }: { agentLabel: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
      <div className="w-14 h-14 rounded-2xl bg-[#22c55e]/10 border border-[#22c55e]/20 flex items-center justify-center mb-4">
        <Bot size={24} className="text-[#22c55e]" />
      </div>
      <h2 className="text-white font-semibold text-lg mb-2">{agentLabel}</h2>
      <p className="text-white/30 text-sm max-w-xs">
        Select a client, choose a quick task or type a message to get started.
      </p>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function ChatInterface({ clients }: Props) {
  const [messages, setMessages]         = useState<Message[]>([])
  const [input, setInput]               = useState('')
  const [clientId, setClientId]         = useState('')
  const [agentId, setAgentId]           = useState('seo-co-strategist')
  const [quickTask, setQuickTask]       = useState('')
  const [isStreaming, setIsStreaming]   = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const clientOptions  = clients.map((c) => ({ value: c.id, label: c.name }))
  const quickTaskOptions = QUICK_TASKS.map((t) => ({ value: t, label: t }))
  const agentLabel = AGENTS.find(a => a.value === agentId)?.label ?? 'AI Agent'

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend() {
    const text = (quickTask || input).trim()
    if (!text || isStreaming) return
    if (!clientId) {
      alert('Please select a client first.')
      return
    }

    const clientName = clients.find(c => c.id === clientId)?.name

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
      clientName,
    }

    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInput('')
    setQuickTask('')
    setIsStreaming(true)

    // Add empty assistant message to stream into
    const assistantId = (Date.now() + 1).toString()
    setMessages(prev => [...prev, {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      clientName,
      agentId,
    }])

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          agentId,
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      })

      if (!res.ok || !res.body) throw new Error('Agent request failed')

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
                  const last = updated[updated.length - 1]
                  updated[updated.length - 1] = { ...last, content: last.content + chunk }
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
          ...updated[updated.length - 1],
          content: 'Something went wrong. Please try again.',
        }
        return updated
      })
    } finally {
      setIsStreaming(false)
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-screen bg-[#0d0d0d]">
      {/* Chat area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto w-full px-6 py-8 flex flex-col gap-6 min-h-full">
          {messages.length === 0
            ? <EmptyState agentLabel={agentLabel} />
            : (
              <>
                {messages.map((msg, i) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    isStreaming={isStreaming && i === messages.length - 1}
                  />
                ))}
                <div ref={bottomRef} />
              </>
            )
          }
        </div>
      </div>

      {/* Input bar */}
      <div className="shrink-0 flex flex-col items-center pb-8 px-6">
        <div className="w-full max-w-2xl space-y-2">
          {/* Dropdown row */}
          <div className="flex items-center gap-2 flex-wrap">
            <Dropdown
              label="Select Client"
              options={clientOptions}
              value={clientId}
              onChange={setClientId}
            />
            <Dropdown
              label="Agent"
              options={AGENTS}
              value={agentId}
              onChange={(v) => { setAgentId(v); setMessages([]) }}
            />
            <Dropdown
              label="Quick Tasks"
              options={quickTaskOptions}
              value={quickTask}
              onChange={setQuickTask}
            />
          </div>

          {/* Text input */}
          <div className="flex items-center gap-3 bg-[#161616] border border-white/10 rounded-xl px-4 py-3">
            <input
              type="text"
              value={quickTask || input}
              onChange={(e) => { setQuickTask(''); setInput(e.target.value) }}
              onKeyDown={handleKeyDown}
              placeholder={clientId ? `Ask ${agentLabel}...` : 'Select a client to get started'}
              className="flex-1 bg-transparent text-white/80 text-sm placeholder:text-white/25 outline-none"
            />
            <button
              onClick={handleSend}
              disabled={isStreaming || (!input.trim() && !quickTask) || !clientId}
              className={cn(
                'w-8 h-8 flex items-center justify-center rounded-lg transition-all',
                isStreaming || (!input.trim() && !quickTask) || !clientId
                  ? 'text-white/20 cursor-not-allowed'
                  : 'text-white/60 hover:text-white hover:bg-white/8'
              )}
            >
              {isStreaming
                ? <Loader size={16} className="animate-spin" />
                : <Send size={16} />
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
