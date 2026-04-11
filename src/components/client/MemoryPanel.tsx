'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Brain, Pin, PinOff, Trash2, Plus, Edit3, Check, X,
  Loader2, Lightbulb, AlertTriangle, Trophy, Heart,
  Settings2, Search, Archive, ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────

interface MemoryEntry {
  id: string
  created_at: string
  client_id: string
  agent: string
  category: string
  content: string
  importance: string
  source_run_id: string | null
  metadata: Record<string, unknown>
  pinned: boolean
  archived: boolean
}

// ── Category config ────────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<string, { icon: typeof Lightbulb; color: string; label: string }> = {
  insight:    { icon: Lightbulb,      color: 'text-yellow-400', label: 'Insight' },
  decision:   { icon: Settings2,      color: 'text-blue-400',   label: 'Decision' },
  finding:    { icon: Search,         color: 'text-cyan-400',   label: 'Finding' },
  issue:      { icon: AlertTriangle,  color: 'text-red-400',    label: 'Issue' },
  win:        { icon: Trophy,         color: 'text-green-400',  label: 'Win' },
  preference: { icon: Heart,          color: 'text-pink-400',   label: 'Preference' },
  system:     { icon: Settings2,      color: 'text-white/30',   label: 'System' },
}

const AGENT_COLORS: Record<string, string> = {
  keyword: 'bg-orange-500/15 text-orange-300',
  content: 'bg-yellow-500/15 text-yellow-300',
  link: 'bg-blue-500/15 text-blue-300',
  technical: 'bg-green-500/15 text-green-300',
  audit: 'bg-rose-500/15 text-rose-300',
  analytics: 'bg-cyan-500/15 text-cyan-300',
  geo: 'bg-purple-500/15 text-purple-300',
  optimizer: 'bg-emerald-500/15 text-emerald-300',
  alerter: 'bg-red-500/15 text-red-300',
  reporter: 'bg-indigo-500/15 text-indigo-300',
  user: 'bg-white/10 text-white/60',
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// ── Add memory form ───────────────────────────────────────────────────────

function AddMemoryForm({ clientId, onAdded }: { clientId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState('')
  const [category, setCategory] = useState('insight')
  const [importance, setImportance] = useState('normal')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!content.trim()) return
    setSaving(true)
    try {
      await fetch('/api/clients/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          agent: 'user',
          category,
          content: content.trim(),
          importance,
        }),
      })
      setContent('')
      setOpen(false)
      onAdded()
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-[11px] text-white/25 hover:text-white/50 bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 hover:border-white/10 px-3 py-1.5 rounded-lg transition-all"
      >
        <Plus size={11} /> Add memory
      </button>
    )
  }

  return (
    <div className="bg-white/[0.03] border border-white/8 rounded-lg p-4 space-y-3">
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="What should agents remember about this client?"
        className="w-full bg-black/30 border border-white/8 rounded-lg px-3 py-2 text-white text-xs placeholder-white/20 resize-none focus:outline-none focus:border-white/20"
        rows={2}
        autoFocus
      />
      <div className="flex items-center gap-3">
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="text-[10px] bg-black/30 border border-white/8 text-white/60 rounded px-2 py-1 focus:outline-none"
        >
          {Object.entries(CATEGORY_CONFIG).filter(([k]) => k !== 'system').map(([key, { label }]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <select
          value={importance}
          onChange={e => setImportance(e.target.value)}
          className="text-[10px] bg-black/30 border border-white/8 text-white/60 rounded px-2 py-1 focus:outline-none"
        >
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </select>
        <div className="flex-1" />
        <button onClick={() => setOpen(false)} className="text-white/20 hover:text-white/40 text-xs">Cancel</button>
        <button
          onClick={handleSave}
          disabled={!content.trim() || saving}
          className="flex items-center gap-1 text-[10px] bg-white/10 hover:bg-white/15 text-white px-3 py-1 rounded transition-colors disabled:opacity-30"
        >
          {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
          Save
        </button>
      </div>
    </div>
  )
}

// ── Single memory entry row ───────────────────────────────────────────────

function MemoryRow({ entry, onUpdate, onDelete }: {
  entry: MemoryEntry
  onUpdate: (id: string, updates: Partial<MemoryEntry>) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState(entry.content)
  const cat = CATEGORY_CONFIG[entry.category] ?? CATEGORY_CONFIG.insight
  const CatIcon = cat.icon
  const agentColor = AGENT_COLORS[entry.agent] ?? 'bg-white/5 text-white/40'

  function handleSaveEdit() {
    if (editContent.trim() && editContent !== entry.content) {
      onUpdate(entry.id, { content: editContent.trim() })
    }
    setEditing(false)
  }

  return (
    <div className={cn(
      'group flex gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02]',
      entry.pinned && 'bg-yellow-500/[0.02] border-l-2 border-yellow-500/30',
      entry.importance === 'high' && !entry.pinned && 'border-l-2 border-white/10',
    )}>
      {/* Category icon */}
      <div className={cn('mt-0.5 shrink-0', cat.color)}>
        <CatIcon size={13} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex gap-2">
            <input
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1 text-white text-xs focus:outline-none"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSaveEdit()}
            />
            <button onClick={handleSaveEdit} className="text-green-400 hover:text-green-300"><Check size={12} /></button>
            <button onClick={() => setEditing(false)} className="text-white/20 hover:text-white/40"><X size={12} /></button>
          </div>
        ) : (
          <p className="text-white/60 text-xs leading-relaxed">{entry.content}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full font-medium', agentColor)}>
            {entry.agent}
          </span>
          <span className={cn('text-[9px]', cat.color)}>{cat.label}</span>
          <span className="text-white/15 text-[9px]">{formatDate(entry.created_at)}</span>
          {entry.importance === 'high' && <span className="text-[9px] text-yellow-500">High priority</span>}
        </div>
      </div>

      {/* Actions */}
      <div className="shrink-0 flex items-start gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onUpdate(entry.id, { pinned: !entry.pinned })}
          className={cn('p-1 rounded hover:bg-white/5', entry.pinned ? 'text-yellow-400' : 'text-white/15 hover:text-white/40')}
          title={entry.pinned ? 'Unpin' : 'Pin'}
        >
          {entry.pinned ? <PinOff size={11} /> : <Pin size={11} />}
        </button>
        <button
          onClick={() => setEditing(true)}
          className="p-1 rounded text-white/15 hover:text-white/40 hover:bg-white/5"
          title="Edit"
        >
          <Edit3 size={11} />
        </button>
        <button
          onClick={() => onUpdate(entry.id, { archived: true })}
          className="p-1 rounded text-white/15 hover:text-white/40 hover:bg-white/5"
          title="Archive"
        >
          <Archive size={11} />
        </button>
        <button
          onClick={() => onDelete(entry.id)}
          className="p-1 rounded text-white/15 hover:text-red-400 hover:bg-white/5"
          title="Delete"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────

interface MemoryPanelProps {
  clientId: string
}

export function MemoryPanel({ clientId }: MemoryPanelProps) {
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [showSystem, setShowSystem] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/clients/memory?clientId=${clientId}&limit=100`)
      if (res.ok) {
        const data = await res.json()
        setEntries(Array.isArray(data) ? data : [])
      }
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  async function handleUpdate(id: string, updates: Partial<MemoryEntry>) {
    await fetch('/api/clients/memory', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...updates }),
    })
    load()
  }

  async function handleDelete(id: string) {
    await fetch(`/api/clients/memory?id=${id}`, { method: 'DELETE' })
    load()
  }

  const filtered = entries.filter(e => {
    if (!showSystem && e.category === 'system') return false
    if (filter === 'all') return true
    if (filter === 'pinned') return e.pinned
    if (filter === 'high') return e.importance === 'high'
    return e.category === filter
  })

  const pinnedCount = entries.filter(e => e.pinned).length
  const highCount = entries.filter(e => e.importance === 'high' && e.category !== 'system').length

  if (loading && entries.length === 0) {
    return (
      <div className="bg-[#141414] border border-white/8 rounded-lg p-8 flex items-center justify-center gap-2 text-white/30 text-sm">
        <Loader2 size={14} className="animate-spin" /> Loading memory…
      </div>
    )
  }

  return (
    <div className="bg-[#141414] border border-white/8 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
        <div className="flex items-center gap-3">
          <Brain size={16} className="text-purple-400" />
          <h2 className="text-white font-semibold text-sm">Client Memory</h2>
          <span className="text-white/20 text-[11px]">{entries.length} entries</span>
          {pinnedCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">
              <Pin size={8} /> {pinnedCount} pinned
            </span>
          )}
          {highCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] bg-red-500/10 border border-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
              {highCount} high priority
            </span>
          )}
        </div>
        <AddMemoryForm clientId={clientId} onAdded={load} />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-b border-white/4 overflow-x-auto">
        {[
          { key: 'all', label: 'All' },
          { key: 'pinned', label: 'Pinned' },
          { key: 'high', label: 'High priority' },
          { key: 'insight', label: 'Insights' },
          { key: 'finding', label: 'Findings' },
          { key: 'issue', label: 'Issues' },
          { key: 'win', label: 'Wins' },
          { key: 'decision', label: 'Decisions' },
          { key: 'preference', label: 'Preferences' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'text-[10px] px-2.5 py-1 rounded-full transition-colors whitespace-nowrap',
              filter === f.key
                ? 'bg-white/10 text-white font-medium'
                : 'text-white/25 hover:text-white/50 hover:bg-white/[0.03]',
            )}
          >
            {f.label}
          </button>
        ))}
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-[10px] text-white/20 cursor-pointer">
          <input
            type="checkbox"
            checked={showSystem}
            onChange={e => setShowSystem(e.target.checked)}
            className="rounded border-white/20"
          />
          Show system logs
        </label>
      </div>

      {/* Entries */}
      {filtered.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <Brain size={24} className="text-white/10 mx-auto mb-3" />
          <p className="text-white/25 text-sm">
            {entries.length === 0 ? 'No memories yet' : 'No entries match this filter'}
          </p>
          <p className="text-white/15 text-xs mt-1">
            Agents will log insights here as they work. You can also add your own.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-white/[0.03]">
          {filtered.map(entry => (
            <MemoryRow
              key={entry.id}
              entry={entry}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}
