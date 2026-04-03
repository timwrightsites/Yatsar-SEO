'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, ChevronDown, Bot, User, Loader } from 'lucide-react'
import { cn } from '@/lib/utils'
import { mockClients } from '@/lib/mock-data'

// ── Types ──────────────────────────────────────────────────────────────────

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  targetClient?: string
  botType?: string
}

// ── Mock bot responses ─────────────────────────────────────────────────────

const BOT_RESPONSES: Record<string, string[]> = {
  content: [
    "I've analysed the content gaps for your selected client. Found 23 high-opportunity keywords with a combined search volume of 48K/mo. Top opportunity: \"[client industry] software pricing\" — currently ranking #34 with a quick-win potential.",
    "Content audit complete. 12 pages identified for consolidation, 8 thin pages flagged for expansion. Recommend prioritising the blog cluster around your core service pages first.",
  ],
  link: [
    "Link prospecting done. Found 17 relevant domains in the DR 40–70 range with open guest post programmes. I've drafted 5 personalised outreach emails — want me to queue them for review?",
    "Backlink gap analysis complete. Your top 3 competitors have an average of 340 more referring domains. I've identified 62 domains linking to all 3 competitors but not your client — these are your highest-priority targets.",
  ],
  technical: [
    "Site crawl finished. 4 critical issues found: 1 broken canonical tag on the homepage, 3 pages with duplicate H1s, 11 images missing alt text, and Core Web Vitals failing on mobile for 6 pages. Full report ready.",
    "PageSpeed audit complete. Mobile score: 68 (needs work). Largest Contentful Paint is 3.8s — caused by an unoptimised hero image. Switching to WebP + lazy loading would bring it under 2.5s.",
  ],
  geo: [
    "Google Business Profile updated. Added 6 new Q&A pairs based on recent search queries, updated business hours, and flagged 2 duplicate listings that need manual removal. Local pack ranking improved from #5 to #3 this week.",
    "Local citation audit done. Found 14 directories with inconsistent NAP data. I've queued corrections for your review — approve them and I'll push the updates.",
  ],
  default: [
    "Got it. I'm pulling the latest data for your client now and will have a full analysis ready in a moment.",
    "On it. Let me check the current status across all active bots for this client and summarise what's been done this week.",
    "Sure — running that now. I'll surface the key findings and recommended next steps.",
  ],
}

const QUICK_TASKS = [
  'Run content audit',
  'Find link opportunities',
  'Technical site crawl',
  'Update GBP profile',
  'Keyword gap analysis',
  'Check bot status',
  'Generate monthly report',
]

const BOT_TYPES = [
  { value: 'content',   label: 'Content Bot' },
  { value: 'link',      label: 'Link Bot' },
  { value: 'technical', label: 'Technical Bot' },
  { value: 'geo',       label: 'GEO Bot' },
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
        <div className="absolute bottom-full mb-2 left-0 w-48 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
          <div
            className="px-3 py-2 text-xs text-white/30 border-b border-white/5"
          >
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

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'
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
        {/* Meta */}
        {!isUser && msg.botType && (
          <div className="text-xs text-white/30 mb-1 ml-0.5">
            {BOT_TYPES.find(b => b.value === msg.botType)?.label ?? 'AI Assistant'}
            {msg.targetClient && (
              <span className="ml-1.5 text-white/20">· {msg.targetClient}</span>
            )}
          </div>
        )}
        <div className={cn(
          'px-4 py-3 rounded-2xl text-sm leading-relaxed',
          isUser
            ? 'bg-white/8 text-white rounded-tr-sm'
            : 'bg-[#161616] border border-white/8 text-white/85 rounded-tl-sm'
        )}>
          {msg.content}
        </div>
        <div className={cn('text-[11px] text-white/20 mt-1', isUser ? 'text-right' : 'text-left')}>
          {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}

// ── Typing indicator ───────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-3 max-w-3xl mr-auto">
      <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center bg-[#22c55e]/10 border border-[#22c55e]/20">
        <Bot size={14} className="text-[#22c55e]" />
      </div>
      <div className="bg-[#161616] border border-white/8 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
      <div className="w-14 h-14 rounded-2xl bg-[#22c55e]/10 border border-[#22c55e]/20 flex items-center justify-center mb-4">
        <Bot size={24} className="text-[#22c55e]" />
      </div>
      <h2 className="text-white font-semibold text-lg mb-2">AI Assistant</h2>
      <p className="text-white/30 text-sm max-w-xs">
        Select a client, pick a task or bot type, and ask anything about your SEO campaigns.
      </p>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function ChatInterface() {
  const [messages, setMessages]     = useState<Message[]>([])
  const [input, setInput]           = useState('')
  const [targetClient, setTargetClient] = useState('')
  const [spawnBot, setSpawnBot]     = useState('')
  const [quickTask, setQuickTask]   = useState('')
  const [isTyping, setIsTyping]     = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const clientOptions = mockClients.map((c) => ({ value: c.id, label: c.name }))
  const quickTaskOptions = QUICK_TASKS.map((t) => ({ value: t, label: t }))

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  function getResponse(userText: string, botType: string): string {
    const pool = BOT_RESPONSES[botType] ?? BOT_RESPONSES.default
    return pool[Math.floor(Math.random() * pool.length)]
  }

  async function handleSend() {
    const text = (quickTask || input).trim()
    if (!text) return

    const clientName = mockClients.find(c => c.id === targetClient)?.name

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
      targetClient: clientName,
    }

    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setQuickTask('')
    setIsTyping(true)

    // Simulate bot thinking delay
    await new Promise((r) => setTimeout(r, 1200 + Math.random() * 800))

    const botMsg: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: getResponse(text, spawnBot),
      timestamp: new Date(),
      targetClient: clientName,
      botType: spawnBot || 'content',
    }

    setIsTyping(false)
    setMessages((prev) => [...prev, botMsg])
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
          {messages.length === 0 && !isTyping
            ? <EmptyState />
            : (
              <>
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} msg={msg} />
                ))}
                {isTyping && <TypingIndicator />}
                <div ref={bottomRef} />
              </>
            )
          }
        </div>
      </div>

      {/* Input bar — matches Figma exactly */}
      <div className="shrink-0 flex flex-col items-center pb-8 px-6">
        <div className="w-full max-w-2xl space-y-2">
          {/* Dropdown row */}
          <div className="flex items-center gap-2">
            <Dropdown
              label="Target Client"
              options={clientOptions}
              value={targetClient}
              onChange={setTargetClient}
            />
            <Dropdown
              label="Quick Tasks"
              options={quickTaskOptions}
              value={quickTask}
              onChange={setQuickTask}
            />
            <Dropdown
              label="Spawn Bot"
              options={BOT_TYPES}
              value={spawnBot}
              onChange={setSpawnBot}
            />
          </div>

          {/* Text input */}
          <div className="flex items-center gap-3 bg-[#161616] border border-white/10 rounded-xl px-4 py-3">
            <input
              type="text"
              value={quickTask || input}
              onChange={(e) => { setQuickTask(''); setInput(e.target.value) }}
              onKeyDown={handleKeyDown}
              placeholder="Let the magic begin. Ask a question"
              className="flex-1 bg-transparent text-white/80 text-sm placeholder:text-white/25 outline-none"
            />
            <button
              onClick={handleSend}
              disabled={isTyping || (!input.trim() && !quickTask)}
              className={cn(
                'w-8 h-8 flex items-center justify-center rounded-lg transition-all',
                isTyping || (!input.trim() && !quickTask)
                  ? 'text-white/20 cursor-not-allowed'
                  : 'text-white/60 hover:text-white hover:bg-white/8'
              )}
            >
              {isTyping
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
