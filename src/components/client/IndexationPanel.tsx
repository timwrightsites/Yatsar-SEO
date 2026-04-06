'use client'

import { useEffect, useState, useCallback } from 'react'
import { Loader2, AlertCircle, CheckCircle2, XCircle, Search, RefreshCw, Send, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type InspectStatus = 'unknown' | 'checking' | 'indexed' | 'not_indexed' | 'error'

interface PageEntry {
  url:            string
  path:           string
  inGSC:          boolean   // appeared in GSC search analytics
  inspectStatus:  InspectStatus
  lastCrawlTime:  string | null
  indexingState:  string | null
  submitStatus:   'idle' | 'submitting' | 'submitted' | 'error'
  submitMessage?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pathOf(url: string) {
  try { return new URL(url).pathname || '/' } catch { return url }
}

function StatusBadge({ status }: { status: InspectStatus | 'inGSC' }) {
  const map: Record<string, { label: string; color: string; dot: string }> = {
    inGSC:       { label: 'In GSC',     color: 'text-[#22c55e]',  dot: 'bg-[#22c55e]'  },
    indexed:     { label: 'Indexed',    color: 'text-[#22c55e]',  dot: 'bg-[#22c55e]'  },
    not_indexed: { label: 'Not Indexed',color: 'text-red-400',    dot: 'bg-red-400'     },
    checking:    { label: 'Checking…',  color: 'text-white/40',   dot: 'bg-white/25'    },
    unknown:     { label: 'Undetected', color: 'text-yellow-400', dot: 'bg-yellow-400'  },
    error:       { label: 'Error',      color: 'text-red-400/60', dot: 'bg-red-400/40'  },
  }
  const s = map[status] ?? map.unknown
  return (
    <span className={cn('flex items-center gap-1.5 text-[11px] font-medium', s.color)}>
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', s.dot)} />
      {s.label}
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  property: string  // e.g. sc-domain:trustalrecruiting.com
  domain:   string  // e.g. trustalrecruiting.com
}

export function IndexationPanel({ property, domain }: Props) {
  const [pages, setPages]         = useState<PageEntry[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [filter, setFilter]       = useState<'all' | 'undetected'>('undetected')
  const [indexingAll, setIndexingAll] = useState(false)
  const [lastIndexed, setLastIndexed] = useState<Date | null>(null)

  // ── Load sitemap + GSC pages ───────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [sitemapRes, gscRes] = await Promise.all([
        fetch(`/api/gsc/sitemap?domain=${encodeURIComponent(domain)}`).then(r => r.json()),
        fetch(`/api/gsc?property=${encodeURIComponent(property)}`).then(r => r.json()),
      ])

      if (sitemapRes.error) throw new Error(`Sitemap: ${sitemapRes.error}`)
      if (gscRes.error)     throw new Error(`GSC: ${gscRes.error}`)

      const sitemapUrls: string[] = sitemapRes.urls ?? []
      const gscPages:    string[] = (gscRes.topPages ?? []).map((p: { page: string }) => p.page)

      // Normalize GSC pages to just paths for comparison
      const gscPaths = new Set(gscPages.map(pathOf))

      const entries: PageEntry[] = sitemapUrls.map(url => ({
        url,
        path:          pathOf(url),
        inGSC:         gscPaths.has(pathOf(url)),
        inspectStatus: 'unknown' as InspectStatus,
        lastCrawlTime: null,
        indexingState: null,
        submitStatus:  'idle',
      }))

      // Sort: undetected first, then alphabetical
      entries.sort((a, b) => {
        if (!a.inGSC && b.inGSC) return -1
        if (a.inGSC && !b.inGSC) return 1
        return a.path.localeCompare(b.path)
      })

      setPages(entries)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [domain, property])

  useEffect(() => { load() }, [load])

  // ── Inspect a single URL ───────────────────────────────────────────────────

  const inspectUrl = async (url: string) => {
    setPages(prev => prev.map(p =>
      p.url === url ? { ...p, inspectStatus: 'checking' } : p
    ))

    try {
      const res = await fetch(`/api/gsc/submit?url=${encodeURIComponent(url)}&property=${encodeURIComponent(property)}`)
      const data = await res.json()

      if (data.error) {
        setPages(prev => prev.map(p =>
          p.url === url ? { ...p, inspectStatus: 'error' } : p
        ))
        return
      }

      const isIndexed = data.verdict === 'PASS' || data.indexingState === 'INDEXING_ALLOWED'
      setPages(prev => prev.map(p =>
        p.url === url ? {
          ...p,
          inspectStatus: isIndexed ? 'indexed' : 'not_indexed',
          lastCrawlTime: data.lastCrawlTime,
          indexingState: data.indexingState,
        } : p
      ))
    } catch {
      setPages(prev => prev.map(p =>
        p.url === url ? { ...p, inspectStatus: 'error' } : p
      ))
    }
  }

  // ── Submit single URL for indexing ─────────────────────────────────────────

  const submitUrl = async (url: string) => {
    setPages(prev => prev.map(p =>
      p.url === url ? { ...p, submitStatus: 'submitting' } : p
    ))

    try {
      const res  = await fetch('/api/gsc/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [url] }),
      })
      const data = await res.json()
      const result = data.results?.[0]

      setPages(prev => prev.map(p =>
        p.url === url ? {
          ...p,
          submitStatus:  result?.status === 'submitted' ? 'submitted' : 'error',
          submitMessage: result?.message,
        } : p
      ))
    } catch (err) {
      setPages(prev => prev.map(p =>
        p.url === url ? { ...p, submitStatus: 'error', submitMessage: String(err) } : p
      ))
    }
  }

  // ── Submit all undetected URLs ─────────────────────────────────────────────

  const submitAll = async () => {
    const targets = pages.filter(p => !p.inGSC && p.submitStatus === 'idle').map(p => p.url)
    if (targets.length === 0) return

    setIndexingAll(true)

    // Mark all as submitting
    setPages(prev => prev.map(p =>
      targets.includes(p.url) ? { ...p, submitStatus: 'submitting' } : p
    ))

    try {
      const res  = await fetch('/api/gsc/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: targets }),
      })
      const data = await res.json()

      if (data.results) {
        type IndexResult = { url: string; status: string; message?: string }
        const resultMap = new Map<string, IndexResult>(
          data.results.map((r: IndexResult) => [r.url, r])
        )
        setPages(prev => prev.map(p => {
          const result = resultMap.get(p.url)
          if (!result) return p
          return {
            ...p,
            submitStatus:  result.status === 'submitted' ? 'submitted' : 'error',
            submitMessage: result.message,
          }
        }))
        setLastIndexed(new Date())
      }
    } catch (err) {
      setPages(prev => prev.map(p =>
        targets.includes(p.url) ? { ...p, submitStatus: 'error', submitMessage: String(err) } : p
      ))
    } finally {
      setIndexingAll(false)
    }
  }

  // ── Derived counts ─────────────────────────────────────────────────────────

  const undetected = pages.filter(p => !p.inGSC)
  const submitted  = pages.filter(p => p.submitStatus === 'submitted')
  const visible    = filter === 'all' ? pages : undetected

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="bg-[#141414] border border-white/8 rounded-lg p-5 flex items-center gap-2 text-white/30 text-sm">
      <Loader2 size={14} className="animate-spin" /> Scanning sitemap…
    </div>
  )

  if (error) return (
    <div className="bg-[#141414] border border-white/8 rounded-lg p-5 flex items-center gap-2 text-red-400 text-sm">
      <AlertCircle size={14} /> {error}
    </div>
  )

  return (
    <div className="bg-[#141414] border border-white/8 rounded-lg p-5">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-white font-semibold text-sm">Indexation</p>
          <p className="text-white/30 text-[11px] mt-0.5">
            {pages.length} sitemap URLs · {undetected.length} not detected in GSC
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastIndexed && (
            <span className="text-[#22c55e] text-[11px]">
              {submitted.length} submitted {lastIndexed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={load}
            className="p-1.5 text-white/30 hover:text-white/60 transition-colors rounded"
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-[#0d0d0d] border border-white/6 rounded-md px-3 py-2.5">
          <p className="text-white/30 text-[10px] uppercase tracking-wide mb-1">In Sitemap</p>
          <p className="text-white font-bold text-xl">{pages.length}</p>
        </div>
        <div className={cn(
          'bg-[#0d0d0d] border rounded-md px-3 py-2.5',
          undetected.length > 0 ? 'border-yellow-400/20' : 'border-white/6'
        )}>
          <p className={cn('text-[10px] uppercase tracking-wide mb-1', undetected.length > 0 ? 'text-yellow-400/60' : 'text-white/30')}>
            Not in GSC
          </p>
          <p className={cn('font-bold text-xl', undetected.length > 0 ? 'text-yellow-400' : 'text-white')}>
            {undetected.length}
          </p>
        </div>
        <div className="bg-[#0d0d0d] border border-white/6 rounded-md px-3 py-2.5">
          <p className="text-white/30 text-[10px] uppercase tracking-wide mb-1">Submitted</p>
          <p className="text-[#22c55e] font-bold text-xl">{submitted.length}</p>
        </div>
      </div>

      {/* Action bar */}
      {undetected.length > 0 && (
        <div className="flex items-center justify-between mb-4 p-3 bg-yellow-400/5 border border-yellow-400/15 rounded-lg">
          <div>
            <p className="text-yellow-400 text-xs font-medium">
              {undetected.length} page{undetected.length !== 1 ? 's' : ''} not detected in Google Search Console
            </p>
            <p className="text-white/30 text-[11px] mt-0.5">
              Submitting requests Google to crawl and index these pages
            </p>
          </div>
          <button
            onClick={submitAll}
            disabled={indexingAll || undetected.every(p => p.submitStatus !== 'idle')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
              indexingAll || undetected.every(p => p.submitStatus !== 'idle')
                ? 'bg-white/5 text-white/20 cursor-not-allowed'
                : 'bg-yellow-400/10 border border-yellow-400/25 text-yellow-400 hover:bg-yellow-400/15'
            )}
          >
            {indexingAll
              ? <><Loader2 size={11} className="animate-spin" /> Submitting…</>
              : <><Send size={11} /> Request Indexing All</>
            }
          </button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-0.5 mb-3">
        {(['undetected', 'all'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-1 rounded text-xs font-medium transition-all',
              filter === f ? 'bg-white/8 text-white' : 'text-white/30 hover:text-white/50'
            )}>
            {f === 'all' ? `All (${pages.length})` : `Not in GSC (${undetected.length})`}
          </button>
        ))}
      </div>

      {/* Table */}
      {visible.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-8 text-white/25 text-xs">
          <CheckCircle2 size={14} className="text-[#22c55e]" />
          All sitemap pages are detected in Google Search Console
        </div>
      ) : (
        <div className="flex flex-col gap-0">
          {/* Table header */}
          <div className="grid gap-3 pb-2 border-b border-white/5 text-[10px] text-white/25 uppercase tracking-wide"
            style={{ gridTemplateColumns: '1fr 100px 80px 90px' }}>
            <span>Page</span>
            <span className="text-right">GSC Status</span>
            <span className="text-right">Inspect</span>
            <span className="text-right">Index</span>
          </div>

          {visible.map((page) => (
            <div key={page.url}
              className="grid gap-3 py-2 border-b border-white/4 last:border-0 items-center"
              style={{ gridTemplateColumns: '1fr 100px 80px 90px' }}>

              {/* URL */}
              <div className="min-w-0 flex items-center gap-1.5">
                <a href={page.url} target="_blank" rel="noopener noreferrer"
                  className="text-white/60 text-xs truncate hover:text-white/90 transition-colors"
                  title={page.url}>
                  {page.path}
                </a>
                <a href={page.url} target="_blank" rel="noopener noreferrer" className="text-white/20 hover:text-white/50 shrink-0">
                  <ExternalLink size={10} />
                </a>
              </div>

              {/* GSC status */}
              <div className="flex justify-end">
                {page.inGSC
                  ? <StatusBadge status="inGSC" />
                  : page.inspectStatus !== 'unknown'
                    ? <StatusBadge status={page.inspectStatus} />
                    : <StatusBadge status="unknown" />
                }
              </div>

              {/* Inspect button */}
              <div className="flex justify-end">
                {(page.inspectStatus as string) === 'checking' ? (
                  <Loader2 size={11} className="animate-spin text-white/30" />
                ) : (
                  <button
                    onClick={() => inspectUrl(page.url)}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] text-white/30 border border-white/8 rounded hover:text-white/60 hover:border-white/15 transition-all">
                    <Search size={9} /> Check
                  </button>
                )}
              </div>

              {/* Index button */}
              <div className="flex justify-end">
                {page.submitStatus === 'submitted' ? (
                  <span className="flex items-center gap-1 text-[10px] text-[#22c55e]">
                    <CheckCircle2 size={10} /> Sent
                  </span>
                ) : page.submitStatus === 'error' ? (
                  <span className="flex items-center gap-1 text-[10px] text-red-400" title={page.submitMessage}>
                    <XCircle size={10} /> Error
                  </span>
                ) : page.submitStatus === 'submitting' ? (
                  <Loader2 size={11} className="animate-spin text-white/30" />
                ) : (
                  <button
                    onClick={() => submitUrl(page.url)}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] text-white/40 border border-white/8 rounded hover:text-white hover:border-white/20 hover:bg-white/4 transition-all">
                    <Send size={9} /> Index
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer note */}
      <p className="text-white/15 text-[10px] mt-4 pt-3 border-t border-white/5">
        "Not in GSC" means the page hasn't appeared in search analytics — it may still be indexed. Use "Check" to inspect via Google's URL Inspection API.
        Google processes indexing requests within 24–72 hours. Daily limit: 200 submissions.
      </p>

    </div>
  )
}
