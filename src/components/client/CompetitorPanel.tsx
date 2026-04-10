'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Loader2, Plus, Trash2, Zap, X, ExternalLink, Clock, AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────────

interface Competitor {
  id: string
  client_id: string
  domain: string
  notes: string | null
  summary_html: string | null
  summary_generated_at: string | null
  ahrefs_data: Record<string, unknown> | null
  created_at: string
}

interface Props {
  clientId: string
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function CompetitorPanel({ clientId }: Props) {
  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [loading, setLoading]         = useState(true)
  const [newDomain, setNewDomain]     = useState('')
  const [adding, setAdding]           = useState(false)
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [viewComp, setViewComp]       = useState<Competitor | null>(null)
  const [error, setError]             = useState<string | null>(null)

  const fetchCompetitors = useCallback(() => {
    fetch(`/api/competitors?clientId=${clientId}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setCompetitors(d) })
      .finally(() => setLoading(false))
  }, [clientId])

  useEffect(() => { fetchCompetitors() }, [fetchCompetitors])

  // Add competitor
  const handleAdd = async () => {
    if (!newDomain.trim()) return
    setAdding(true)
    setError(null)
    try {
      const res = await fetch('/api/competitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, domain: newDomain.trim() }),
      })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setCompetitors(prev => [...prev.filter(c => c.id !== data.id), data])
      setNewDomain('')
    } catch { setError('Failed to add competitor') }
    finally { setAdding(false) }
  }

  // Remove competitor
  const handleRemove = async (id: string) => {
    setCompetitors(prev => prev.filter(c => c.id !== id))
    await fetch(`/api/competitors?id=${id}`, { method: 'DELETE' })
  }

  // Trigger analysis
  const handleAnalyze = async (comp: Competitor) => {
    setAnalyzingId(comp.id)
    setError(null)
    try {
      const res = await fetch(`/api/competitors/${comp.id}/analyze`, { method: 'POST' })
      const data = await res.json()
      if (data.error) { setError(data.error); setAnalyzingId(null); return }
      setCompetitors(prev => prev.map(c => c.id === comp.id ? data : c))
      setViewComp(data) // auto-open the modal
    } catch { setError('Analysis failed') }
    finally { setAnalyzingId(null) }
  }

  return (
    <>
      <div className="bg-[#141414] border border-white/8 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-bold text-lg">Competitors</h3>
          <span className="text-white/20 text-xs">{competitors.length} tracked</span>
        </div>

        {/* Add competitor input */}
        <div className="flex items-center gap-2 mb-4">
          <input
            type="text"
            placeholder="Add competitor domain (e.g. example.com)"
            value={newDomain}
            onChange={e => setNewDomain(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            className="flex-1 bg-white/5 border border-white/8 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !newDomain.trim()}
            className="flex items-center gap-1.5 bg-white text-black font-semibold text-sm px-3 py-2 rounded-lg hover:bg-white/90 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-xs mb-3">
            <AlertCircle size={12} /> {error}
          </div>
        )}

        {/* Competitor list */}
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-white/30 text-sm">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : competitors.length === 0 ? (
          <p className="text-white/20 text-sm py-4 text-center">
            No competitors tracked yet. Add a domain above.
          </p>
        ) : (
          <div className="space-y-1">
            {competitors.map(comp => {
              const isAnalyzing = analyzingId === comp.id
              const hasSummary  = !!comp.summary_html

              return (
                <div
                  key={comp.id}
                  className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-white/[0.03] transition-colors group"
                >
                  {/* Domain */}
                  <button
                    onClick={() => hasSummary ? setViewComp(comp) : undefined}
                    className={cn(
                      'flex-1 text-left text-sm font-medium truncate transition-colors',
                      hasSummary
                        ? 'text-white/70 hover:text-white cursor-pointer'
                        : 'text-white/40 cursor-default',
                    )}
                  >
                    {comp.domain}
                  </button>

                  {/* Summary status */}
                  {hasSummary && comp.summary_generated_at && (
                    <span className="flex items-center gap-1 text-[10px] text-white/20 shrink-0">
                      <Clock size={9} />
                      {new Date(comp.summary_generated_at).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric',
                      })}
                    </span>
                  )}

                  {/* View button */}
                  {hasSummary && (
                    <button
                      onClick={() => setViewComp(comp)}
                      className="text-[10px] text-white/30 hover:text-white/60 px-2 py-1 rounded border border-white/8 hover:border-white/15 transition-all shrink-0"
                    >
                      View
                    </button>
                  )}

                  {/* Analyze button */}
                  <button
                    onClick={() => handleAnalyze(comp)}
                    disabled={isAnalyzing}
                    className={cn(
                      'flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border transition-all shrink-0',
                      isAnalyzing
                        ? 'border-yellow-500/20 text-yellow-400/60 cursor-wait'
                        : hasSummary
                          ? 'border-white/8 text-white/30 hover:text-white/60 hover:border-white/15'
                          : 'border-blue-500/30 text-blue-400 hover:bg-blue-500/10',
                    )}
                  >
                    {isAnalyzing ? (
                      <><Loader2 size={10} className="animate-spin" /> Analyzing…</>
                    ) : (
                      <><Zap size={10} /> {hasSummary ? 'Re-analyze' : 'Analyze'}</>
                    )}
                  </button>

                  {/* External link */}
                  <a
                    href={`https://${comp.domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white/15 hover:text-white/40 shrink-0 transition-colors"
                  >
                    <ExternalLink size={12} />
                  </a>

                  {/* Delete */}
                  <button
                    onClick={() => handleRemove(comp.id)}
                    className="text-white/10 hover:text-red-400 shrink-0 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Summary Modal ─────────────────────────────────────────── */}
      {viewComp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setViewComp(null)}
        >
          <div
            className="bg-[#141414] border border-white/10 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/8 shrink-0">
              <div>
                <h2 className="text-white font-bold text-lg">{viewComp.domain}</h2>
                <div className="flex items-center gap-3 mt-1">
                  {viewComp.summary_generated_at && (
                    <span className="text-[11px] text-white/25 flex items-center gap-1">
                      <Clock size={10} />
                      Analyzed {new Date(viewComp.summary_generated_at).toLocaleDateString('en-US', {
                        month: 'long', day: 'numeric', year: 'numeric',
                      })}
                    </span>
                  )}
                  <a
                    href={`https://${viewComp.domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-blue-400/60 hover:text-blue-400 flex items-center gap-1 transition-colors"
                  >
                    <ExternalLink size={10} /> Visit site
                  </a>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleAnalyze(viewComp)}
                  disabled={analyzingId === viewComp.id}
                  className="flex items-center gap-1.5 text-xs font-medium text-white/50 hover:text-white px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 transition-all"
                >
                  {analyzingId === viewComp.id ? (
                    <><Loader2 size={12} className="animate-spin" /> Re-analyzing…</>
                  ) : (
                    <><Zap size={12} /> Re-analyze</>
                  )}
                </button>
                <button
                  onClick={() => setViewComp(null)}
                  className="text-white/30 hover:text-white transition-colors p-1"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {viewComp.summary_html ? (
                <div
                  className="prose prose-invert prose-sm max-w-none
                    prose-headings:text-white prose-headings:font-bold
                    prose-h3:text-base prose-h3:mt-5 prose-h3:mb-2
                    prose-p:text-white/60 prose-p:leading-relaxed prose-p:text-sm
                    prose-li:text-white/60 prose-li:text-sm
                    prose-strong:text-white/80
                    prose-em:text-white/50
                    prose-ul:my-2 prose-ol:my-2"
                  dangerouslySetInnerHTML={{ __html: viewComp.summary_html }}
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Zap size={32} className="text-white/10 mb-3" />
                  <p className="text-white/30 text-sm mb-4">
                    No analysis yet. Click the button to generate one.
                  </p>
                  <button
                    onClick={() => handleAnalyze(viewComp)}
                    disabled={analyzingId === viewComp.id}
                    className="flex items-center gap-1.5 text-sm font-medium text-blue-400 bg-blue-500/10 border border-blue-500/20 px-4 py-2 rounded-lg hover:bg-blue-500/15 transition-all"
                  >
                    {analyzingId === viewComp.id ? (
                      <><Loader2 size={14} className="animate-spin" /> Analyzing…</>
                    ) : (
                      <><Zap size={14} /> Analyze Competitor</>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
