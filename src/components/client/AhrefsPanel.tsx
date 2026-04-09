'use client'

/**
 * AhrefsPanel — wired to Ahrefs API v3 via /api/ahrefs/* routes.
 *
 * Live data flow:
 *   /api/ahrefs/overview          → DR + headline metrics
 *   /api/ahrefs/organic-keywords  → paginated keyword table (25 rows / call)
 *   /api/ahrefs/top-pages         → paginated top pages (25 rows / call)
 *   /api/ahrefs/competitors       → competing domains
 *
 * Falls back to mock data when AHREFS_API_KEY is not set (route returns 503
 * with code 'KEY_MISSING') or any fetch fails — so the UI never goes blank.
 *
 * Caching: responses are cached server-side in `ahrefs_snapshots` for 24h
 * per (clientId, endpoint, params). Add `?fresh=1` to force a refresh.
 */

import { useEffect, useState, useCallback } from 'react'
import {
  TrendingUp, TrendingDown, Link2, Globe2, Activity, Search,
  ExternalLink, ChevronLeft, ChevronRight, Sparkles, AlertCircle,
  RefreshCw, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  clientId: string
  domain:   string
}

interface DomainOverview {
  domainRating:    number
  drDelta:         number
  organicTraffic:  number
  trafficDelta:    number
  organicKeywords: number
  keywordsDelta:   number
  refDomains:      number
  refDomainsDelta: number
  backlinks:       number
  backlinksDelta:  number
  trafficValue:    number
}

interface OrganicKeyword {
  keyword:    string
  position:   number
  prevPos:    number
  volume:     number
  difficulty: number
  traffic:    number
  url:        string
  intent:     'informational' | 'commercial' | 'transactional' | 'navigational'
}

interface TopPage {
  url:      string
  traffic:  number
  value:    number
  keywords: number
  topKw:    string
  topKwPos: number
}

interface Competitor {
  domain:        string
  dr:            number
  commonKw:      number
  uniqueKw:      number
  trafficShared: number
}

// ── Mock data (TODO: replace with /api/ahrefs/* responses) ────────────────────

const PAGE_SIZE = 25 // mirrors Standard plan's 25-row API request cap

const mockOverview: DomainOverview = {
  domainRating:    34,
  drDelta:         +2,
  organicTraffic:  4280,
  trafficDelta:    +18,
  organicKeywords: 612,
  keywordsDelta:   +47,
  refDomains:      89,
  refDomainsDelta: +6,
  backlinks:       1247,
  backlinksDelta:  +32,
  trafficValue:    9840,
}

const mockKeywords: OrganicKeyword[] = [
  { keyword: 'recruiting agency near me',          position: 4,  prevPos: 7,  volume: 2400, difficulty: 38, traffic: 412, url: '/',                          intent: 'commercial'    },
  { keyword: 'staffing services',                  position: 12, prevPos: 14, volume: 8100, difficulty: 56, traffic: 287, url: '/services',                  intent: 'commercial'    },
  { keyword: 'hire warehouse workers',             position: 6,  prevPos: 9,  volume: 1300, difficulty: 29, traffic: 198, url: '/industries/warehouse',      intent: 'transactional' },
  { keyword: 'temp agency atlanta',                position: 3,  prevPos: 3,  volume: 880,  difficulty: 24, traffic: 176, url: '/locations/atlanta',         intent: 'commercial'    },
  { keyword: 'how to find good employees',         position: 9,  prevPos: 11, volume: 1900, difficulty: 41, traffic: 142, url: '/blog/finding-good-hires',   intent: 'informational' },
  { keyword: 'manufacturing recruiters',           position: 5,  prevPos: 8,  volume: 720,  difficulty: 33, traffic: 128, url: '/industries/manufacturing',  intent: 'commercial'    },
  { keyword: 'direct hire vs temp',                position: 2,  prevPos: 4,  volume: 590,  difficulty: 22, traffic: 119, url: '/blog/direct-hire-vs-temp',  intent: 'informational' },
  { keyword: 'forklift operator jobs',             position: 14, prevPos: 12, volume: 4400, difficulty: 47, traffic: 96,  url: '/jobs/forklift',             intent: 'transactional' },
  { keyword: 'best staffing agency for trucking',  position: 7,  prevPos: 10, volume: 480,  difficulty: 31, traffic: 88,  url: '/industries/trucking',       intent: 'commercial'    },
  { keyword: 'cdl driver placement',               position: 11, prevPos: 13, volume: 1100, difficulty: 39, traffic: 74,  url: '/services/cdl-placement',    intent: 'transactional' },
  { keyword: 'how much does a recruiter cost',     position: 8,  prevPos: 8,  volume: 720,  difficulty: 35, traffic: 67,  url: '/pricing',                   intent: 'informational' },
  { keyword: 'skilled labor staffing',             position: 13, prevPos: 16, volume: 590,  difficulty: 32, traffic: 54,  url: '/services/skilled-labor',    intent: 'commercial'    },
  { keyword: 'industrial recruiting firms',        position: 10, prevPos: 12, volume: 390,  difficulty: 28, traffic: 48,  url: '/industries/industrial',     intent: 'commercial'    },
  { keyword: 'trustal recruiting',                 position: 1,  prevPos: 1,  volume: 210,  difficulty: 8,  traffic: 187, url: '/',                          intent: 'navigational'  },
  { keyword: 'background check for hires',         position: 17, prevPos: 19, volume: 880,  difficulty: 44, traffic: 38,  url: '/services/background-check', intent: 'informational' },
  { keyword: 'staffing agency atlanta ga',         position: 5,  prevPos: 7,  volume: 320,  difficulty: 26, traffic: 62,  url: '/locations/atlanta',         intent: 'commercial'    },
  { keyword: 'how to write a job description',     position: 18, prevPos: 22, volume: 2900, difficulty: 51, traffic: 41,  url: '/blog/job-descriptions',     intent: 'informational' },
  { keyword: 'temp to hire programs',              position: 6,  prevPos: 9,  volume: 480,  difficulty: 27, traffic: 58,  url: '/services/temp-to-hire',     intent: 'commercial'    },
  { keyword: 'forklift certification training',    position: 21, prevPos: 25, volume: 1600, difficulty: 36, traffic: 22,  url: '/blog/forklift-cert',        intent: 'informational' },
  { keyword: 'logistics staffing solutions',       position: 9,  prevPos: 11, volume: 290,  difficulty: 25, traffic: 33,  url: '/industries/logistics',      intent: 'commercial'    },
  { keyword: 'on-demand workforce',                position: 15, prevPos: 18, volume: 720,  difficulty: 38, traffic: 28,  url: '/services/on-demand',        intent: 'commercial'    },
  { keyword: 'employee retention tips',            position: 19, prevPos: 21, volume: 1300, difficulty: 42, traffic: 24,  url: '/blog/retention',            intent: 'informational' },
  { keyword: 'food packaging staffing',            position: 8,  prevPos: 10, volume: 170,  difficulty: 19, traffic: 19,  url: '/industries/food-packaging', intent: 'commercial'    },
  { keyword: 'union vs non-union staffing',        position: 22, prevPos: 24, volume: 480,  difficulty: 33, traffic: 14,  url: '/blog/union-staffing',       intent: 'informational' },
  { keyword: 'i-9 verification services',          position: 16, prevPos: 18, volume: 390,  difficulty: 29, traffic: 17,  url: '/services/i9',               intent: 'commercial'    },
  // page 2 starts here
  { keyword: 'osha 10 training for warehouse',     position: 24, prevPos: 28, volume: 590,  difficulty: 31, traffic: 12,  url: '/blog/osha-10',              intent: 'informational' },
  { keyword: 'recruiter for small business',       position: 11, prevPos: 14, volume: 320,  difficulty: 26, traffic: 21,  url: '/services/small-business',   intent: 'commercial'    },
  { keyword: 'pre-employment drug screening',      position: 18, prevPos: 20, volume: 720,  difficulty: 34, traffic: 16,  url: '/services/drug-screening',   intent: 'commercial'    },
  { keyword: 'how to reduce hiring time',          position: 23, prevPos: 27, volume: 480,  difficulty: 36, traffic: 11,  url: '/blog/reduce-hiring-time',   intent: 'informational' },
  { keyword: 'seasonal staffing strategies',       position: 14, prevPos: 16, volume: 260,  difficulty: 24, traffic: 18,  url: '/blog/seasonal-staffing',    intent: 'informational' },
]

const mockTopPages: TopPage[] = [
  { url: '/',                          traffic: 1240, value: 2840, keywords: 87, topKw: 'recruiting agency near me',     topKwPos: 4  },
  { url: '/services',                  traffic: 612,  value: 1490, keywords: 54, topKw: 'staffing services',             topKwPos: 12 },
  { url: '/industries/warehouse',      traffic: 487,  value: 1120, keywords: 42, topKw: 'hire warehouse workers',        topKwPos: 6  },
  { url: '/locations/atlanta',         traffic: 421,  value: 980,  keywords: 38, topKw: 'temp agency atlanta',           topKwPos: 3  },
  { url: '/blog/finding-good-hires',   traffic: 312,  value: 480,  keywords: 29, topKw: 'how to find good employees',    topKwPos: 9  },
  { url: '/industries/manufacturing',  traffic: 287,  value: 720,  keywords: 31, topKw: 'manufacturing recruiters',      topKwPos: 5  },
  { url: '/blog/direct-hire-vs-temp',  traffic: 254,  value: 380,  keywords: 22, topKw: 'direct hire vs temp',           topKwPos: 2  },
  { url: '/jobs/forklift',             traffic: 198,  value: 540,  keywords: 19, topKw: 'forklift operator jobs',        topKwPos: 14 },
  { url: '/industries/trucking',       traffic: 176,  value: 460,  keywords: 24, topKw: 'best staffing agency trucking', topKwPos: 7  },
  { url: '/services/cdl-placement',    traffic: 142,  value: 410,  keywords: 17, topKw: 'cdl driver placement',          topKwPos: 11 },
  { url: '/pricing',                   traffic: 128,  value: 320,  keywords: 14, topKw: 'how much does a recruiter cost', topKwPos: 8 },
  { url: '/services/skilled-labor',    traffic: 117,  value: 290,  keywords: 21, topKw: 'skilled labor staffing',        topKwPos: 13 },
  { url: '/industries/industrial',     traffic: 98,   value: 240,  keywords: 16, topKw: 'industrial recruiting firms',   topKwPos: 10 },
  { url: '/services/background-check', traffic: 87,   value: 210,  keywords: 12, topKw: 'background check for hires',    topKwPos: 17 },
  { url: '/locations/marietta',        traffic: 76,   value: 180,  keywords: 11, topKw: 'staffing agency marietta',      topKwPos: 6  },
]

const mockCompetitors: Competitor[] = [
  { domain: 'roberthalf.com',       dr: 78, commonKw: 142, uniqueKw: 8420, trafficShared: 2.1 },
  { domain: 'kellyservices.com',    dr: 74, commonKw: 118, uniqueKw: 6210, trafficShared: 1.8 },
  { domain: 'spherion.com',         dr: 64, commonKw: 96,  uniqueKw: 3180, trafficShared: 3.4 },
  { domain: 'expresspros.com',      dr: 67, commonKw: 91,  uniqueKw: 4120, trafficShared: 2.9 },
  { domain: 'aerotek.com',          dr: 71, commonKw: 84,  uniqueKw: 5890, trafficShared: 2.2 },
  { domain: 'manpower.com',         dr: 76, commonKw: 79,  uniqueKw: 7340, trafficShared: 1.6 },
  { domain: 'snelling.com',         dr: 58, commonKw: 67,  uniqueKw: 1920, trafficShared: 4.1 },
  { domain: 'peoplelinkstaff.com',  dr: 49, commonKw: 54,  uniqueKw: 980,  trafficShared: 5.8 },
]

// ── Subcomponents ─────────────────────────────────────────────────────────────

function MockBadge() {
  return (
    <span className="flex items-center gap-1 text-[10px] text-yellow-400/80 bg-yellow-400/8 border border-yellow-400/20 px-1.5 py-0.5 rounded">
      <Sparkles size={9} /> Mock data
    </span>
  )
}

function Delta({ value, suffix = '%' }: { value: number; suffix?: string }) {
  if (value === 0) return <span className="text-white/30 text-xs">—</span>
  const positive = value > 0
  const Icon = positive ? TrendingUp : TrendingDown
  return (
    <span className={cn('flex items-center gap-0.5 text-xs font-medium', positive ? 'text-[#22c55e]' : 'text-red-400')}>
      <Icon size={11} />
      {positive ? '+' : ''}{value}{suffix}
    </span>
  )
}

function KpiCard({ label, value, delta, icon: Icon }: { label: string; value: string; delta?: number; icon: React.ComponentType<{ size?: number; className?: string }> }) {
  return (
    <div className="bg-[#0d0d0d] border border-white/6 rounded-md px-3 py-3">
      <div className="flex items-center gap-1.5 text-white/30 text-[10px] uppercase tracking-wide mb-2">
        <Icon size={11} />
        {label}
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="text-white font-bold text-xl tabular-nums">{value}</span>
        {delta !== undefined && <div className="pb-0.5"><Delta value={delta} /></div>}
      </div>
    </div>
  )
}

function PositionDelta({ pos, prev }: { pos: number; prev: number }) {
  const diff = prev - pos // positive = improved (lower number is better)
  if (diff === 0) return <span className="text-white/25 text-[10px]">·</span>
  const up = diff > 0
  return (
    <span className={cn('text-[10px] font-medium', up ? 'text-[#22c55e]' : 'text-red-400')}>
      {up ? '↑' : '↓'}{Math.abs(diff)}
    </span>
  )
}

function IntentPill({ intent }: { intent: OrganicKeyword['intent'] }) {
  const map = {
    informational: { label: 'I', cls: 'bg-blue-400/10 text-blue-400 border-blue-400/20'        },
    commercial:    { label: 'C', cls: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20'  },
    transactional: { label: 'T', cls: 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/20'     },
    navigational:  { label: 'N', cls: 'bg-purple-400/10 text-purple-400 border-purple-400/20'  },
  }
  const m = map[intent]
  return (
    <span className={cn('inline-flex items-center justify-center w-4 h-4 rounded-sm border text-[9px] font-bold', m.cls)} title={intent}>
      {m.label}
    </span>
  )
}

function DifficultyBar({ value }: { value: number }) {
  const color =
    value < 30 ? 'bg-[#22c55e]' :
    value < 50 ? 'bg-yellow-400' :
    value < 70 ? 'bg-orange-400' :
                 'bg-red-400'
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-10 h-1 bg-white/8 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${value}%` }} />
      </div>
      <span className="text-white/50 text-[10px] tabular-nums w-6">{value}</span>
    </div>
  )
}

// ── Response normalizers ─────────────────────────────────────────────────────
//
// Field names below come from the exact `select` sets the Ahrefs UI sends
// (captured 2026-04-07 from the "Pull this report with API v3" feature).
// Each Ahrefs response wraps its rows under a single top-level key — we still
// keep `pick`/`asArray` defensive helpers for forward compat in case Ahrefs
// renames a field. If a normalizer returns nothing, the UI falls back to mock.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pick(obj: any, ...keys: string[]): any {
  if (!obj || typeof obj !== 'object') return undefined
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k]
  }
  return undefined
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asArray(obj: any, ...keys: string[]): any[] {
  for (const k of keys) {
    const v = obj?.[k]
    if (Array.isArray(v)) return v
  }
  if (Array.isArray(obj)) return obj
  // Last-resort: walk the top-level keys and return the first array we find.
  // Ahrefs occasionally renames the wrapping key (e.g. `competitors` →
  // `organic_competitors` between report versions). This guarantees we still
  // surface the rows so the panel doesn't fall back to mock for a rename.
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      if (Array.isArray(obj[k])) return obj[k]
    }
  }
  return []
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeOverview(raw: any): DomainOverview | null {
  if (!raw) return null

  // fetchOverview merges three Ahrefs responses under fixed keys:
  //   { domain_rating: <DR resp>, metrics: <metrics resp>, backlinks_stats: <BL resp> }
  // Each underlying response is itself an object whose payload sits under
  // the endpoint name (Ahrefs convention), e.g.:
  //   domain_rating  → { domain_rating: { domain_rating: 34, ahrefs_rank: 123 } }
  //   metrics        → { metrics: { org_traffic, org_keywords, org_cost, ... } }
  //   backlinks_stats→ { metrics: { live, refdomains, ... } }  (also under `metrics`)
  const drResp = raw.domain_rating ?? {}
  const mResp  = raw.metrics       ?? {}
  const bResp  = raw.backlinks_stats ?? {}

  // Unwrap one level if Ahrefs nested it
  const drInner = drResp.domain_rating ?? drResp
  const mInner  = mResp.metrics        ?? mResp
  const bInner  = bResp.metrics        ?? bResp

  const drVal     = pick(drInner, 'domain_rating')
  const traffic   = pick(mInner,  'org_traffic', 'organic_traffic')
  const keywords  = pick(mInner,  'org_keywords', 'organic_keywords')
  const value     = pick(mInner,  'org_cost', 'traffic_value')
  const refDom    = pick(bInner,  'refdomains', 'ref_domains', 'referring_domains')
  const backlinks = pick(bInner,  'live', 'backlinks')

  if (drVal === undefined && traffic === undefined && backlinks === undefined) return null

  return {
    domainRating:    Number(drVal     ?? 0),
    drDelta:         0, // historical delta would require a separate /history call
    organicTraffic:  Number(traffic   ?? 0),
    trafficDelta:    0,
    organicKeywords: Number(keywords  ?? 0),
    keywordsDelta:   0,
    refDomains:      Number(refDom    ?? 0),
    refDomainsDelta: 0,
    backlinks:       Number(backlinks ?? 0),
    backlinksDelta:  0,
    trafficValue:    Number(value     ?? 0),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeKeywords(raw: any): OrganicKeyword[] {
  // Ahrefs returns organic-keywords rows under `keywords`
  const rows = asArray(raw, 'keywords', 'organic_keywords', 'data', 'rows')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((r: any): OrganicKeyword => {
    // Boolean intent flags from the captured select set. Priority order
    // mirrors how the Ahrefs UI badges them: transactional > commercial >
    // navigational > informational.
    const intent: OrganicKeyword['intent'] =
      r.is_transactional ? 'transactional' :
      r.is_commercial    ? 'commercial' :
      r.is_navigational  ? 'navigational' :
      r.is_informational ? 'informational' :
                           'informational'
    return {
      keyword:    String(pick(r, 'keyword_merged', 'keyword') ?? ''),
      position:   Number(pick(r, 'best_position', 'position') ?? 0),
      prevPos:    Number(pick(r, 'best_position_prev', 'prev_position') ?? pick(r, 'best_position') ?? 0),
      volume:     Number(pick(r, 'volume_merged', 'volume', 'search_volume') ?? 0),
      difficulty: Number(pick(r, 'keyword_difficulty_merged', 'keyword_difficulty', 'difficulty', 'kd') ?? 0),
      traffic:    Number(pick(r, 'sum_traffic', 'traffic') ?? 0),
      url:        String(pick(r, 'best_position_url', 'url', 'best_url') ?? '/'),
      intent,
    }
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeTopPages(raw: any): TopPage[] {
  // Real top-pages columns (confirmed from Ahrefs 400 response):
  // url, sum_traffic_merged, value, keywords, top_keyword, top_keyword_best_position
  const rows = asArray(raw, 'pages', 'top_pages', 'data', 'rows')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((r: any): TopPage => ({
    url:      String(pick(r, 'url', 'raw_url') ?? '/'),
    traffic:  Number(pick(r, 'sum_traffic_merged', 'sum_traffic', 'traffic') ?? 0),
    value:    Number(pick(r, 'value', 'value_merged', 'traffic_value') ?? 0),
    keywords: Number(pick(r, 'keywords', 'sum_keywords_merged', 'sum_keywords') ?? 0),
    topKw:    String(pick(r, 'top_keyword', 'top_keyword_merged', 'keyword') ?? ''),
    topKwPos: Number(pick(r, 'top_keyword_best_position', 'top_keyword_position', 'top_position', 'position') ?? 0),
  }))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeCompetitors(raw: any): Competitor[] {
  // Ahrefs returns organic-competitors rows under `competitors`
  const rows = asArray(raw, 'competitors', 'organic_competitors', 'domains', 'data', 'rows')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((r: any): Competitor => ({
    domain:        String(pick(r, 'competitor_domain', 'domain', 'target') ?? ''),
    dr:            Number(pick(r, 'domain_rating', 'dr') ?? 0),
    commonKw:      Number(pick(r, 'keywords_common', 'common_keywords', 'shared_keywords') ?? 0),
    uniqueKw:      Number(pick(r, 'keywords_competitor', 'competitor_keywords', 'unique_keywords') ?? 0),
    // `share` is a 0–1 traffic-share fraction in Ahrefs; convert to a percent.
    trafficShared: Number(pick(r, 'share', 'traffic_overlap', 'overlap') ?? 0) * 100,
  }))
}

// ── Main panel ────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'keywords' | 'pages' | 'competitors'

interface FetchState<T> {
  data:    T | null
  loading: boolean
  error:   string | null
  isMock:  boolean
}

function initState<T>(): FetchState<T> {
  return { data: null, loading: false, error: null, isMock: false }
}

export function AhrefsPanel({ clientId, domain }: Props) {
  const [tab, setTab]       = useState<Tab>('overview')
  const [kwPage, setKwPage] = useState(0)
  const [pgPage, setPgPage] = useState(0)

  const [overview,    setOverview]    = useState<FetchState<DomainOverview>>(initState)
  const [keywords,    setKeywords]    = useState<FetchState<OrganicKeyword[]>>(initState)
  const [topPages,    setTopPages]    = useState<FetchState<TopPage[]>>(initState)
  const [competitors, setCompetitors] = useState<FetchState<Competitor[]>>(initState)

  // Whether ANY fetch came back as mock-fallback (key missing or fetch failed)
  const usingMockSomewhere =
    overview.isMock || keywords.isMock || topPages.isMock || competitors.isMock

  // ── Fetchers ───────────────────────────────────────────────────────────────

  const fetchOverviewData = useCallback(async (fresh = false) => {
    setOverview(s => ({ ...s, loading: true, error: null }))
    try {
      const res = await fetch(`/api/ahrefs/overview?clientId=${clientId}&target=${encodeURIComponent(domain)}${fresh ? '&fresh=1' : ''}`)
      const json = await res.json()
      if (json.code === 'KEY_MISSING') {
        setOverview({ data: mockOverview, loading: false, error: null, isMock: true })
        return
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      const norm = normalizeOverview(json)
      setOverview({ data: norm ?? mockOverview, loading: false, error: null, isMock: norm === null })
    } catch (err) {
      setOverview({ data: mockOverview, loading: false, error: err instanceof Error ? err.message : 'Fetch failed', isMock: true })
    }
  }, [clientId, domain])

  const fetchKeywordsPage = useCallback(async (page: number, fresh = false) => {
    setKeywords(s => ({ ...s, loading: true, error: null }))
    try {
      const res = await fetch(`/api/ahrefs/organic-keywords?clientId=${clientId}&target=${encodeURIComponent(domain)}&limit=${PAGE_SIZE}${fresh ? '&fresh=1' : ''}`)
      const json = await res.json()
      if (json.code === 'KEY_MISSING') {
        const start = page * PAGE_SIZE
        setKeywords({ data: mockKeywords.slice(start, start + PAGE_SIZE), loading: false, error: null, isMock: true })
        return
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      const rows = normalizeKeywords(json)
      setKeywords({ data: rows.length ? rows : mockKeywords.slice(0, PAGE_SIZE), loading: false, error: null, isMock: rows.length === 0 })
    } catch (err) {
      const start = page * PAGE_SIZE
      setKeywords({ data: mockKeywords.slice(start, start + PAGE_SIZE), loading: false, error: err instanceof Error ? err.message : 'Fetch failed', isMock: true })
    }
  }, [clientId, domain])

  const fetchTopPagesPage = useCallback(async (page: number, fresh = false) => {
    setTopPages(s => ({ ...s, loading: true, error: null }))
    try {
      const res = await fetch(`/api/ahrefs/top-pages?clientId=${clientId}&target=${encodeURIComponent(domain)}&limit=${PAGE_SIZE}${fresh ? '&fresh=1' : ''}`)
      const json = await res.json()
      if (json.code === 'KEY_MISSING') {
        const start = page * PAGE_SIZE
        setTopPages({ data: mockTopPages.slice(start, start + PAGE_SIZE), loading: false, error: null, isMock: true })
        return
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      const rows = normalizeTopPages(json)
      setTopPages({ data: rows.length ? rows : mockTopPages.slice(0, PAGE_SIZE), loading: false, error: null, isMock: rows.length === 0 })
    } catch (err) {
      const start = page * PAGE_SIZE
      setTopPages({ data: mockTopPages.slice(start, start + PAGE_SIZE), loading: false, error: err instanceof Error ? err.message : 'Fetch failed', isMock: true })
    }
  }, [clientId, domain])

  const fetchCompetitorsData = useCallback(async (fresh = false) => {
    setCompetitors(s => ({ ...s, loading: true, error: null }))
    try {
      const res = await fetch(`/api/ahrefs/competitors?clientId=${clientId}&target=${encodeURIComponent(domain)}&limit=${PAGE_SIZE}${fresh ? '&fresh=1' : ''}`)
      const json = await res.json()
      if (json.code === 'KEY_MISSING') {
        setCompetitors({ data: mockCompetitors, loading: false, error: null, isMock: true })
        return
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      const rows = normalizeCompetitors(json)
      setCompetitors({ data: rows.length ? rows : mockCompetitors, loading: false, error: null, isMock: rows.length === 0 })
    } catch (err) {
      setCompetitors({ data: mockCompetitors, loading: false, error: err instanceof Error ? err.message : 'Fetch failed', isMock: true })
    }
  }, [clientId, domain])

  // Initial loads (overview always; tab data lazy on first tab activation)
  useEffect(() => { fetchOverviewData() }, [fetchOverviewData])
  useEffect(() => {
    if (tab === 'keywords'    && !keywords.data    && !keywords.loading)    fetchKeywordsPage(kwPage)
    if (tab === 'pages'       && !topPages.data    && !topPages.loading)    fetchTopPagesPage(pgPage)
    if (tab === 'competitors' && !competitors.data && !competitors.loading) fetchCompetitorsData()
  }, [tab, kwPage, pgPage, keywords.data, keywords.loading, topPages.data, topPages.loading, competitors.data, competitors.loading, fetchKeywordsPage, fetchTopPagesPage, fetchCompetitorsData])

  // Pagination triggers a new fetch (1 fetch = 1 API call on Standard plan)
  const onKwPageChange = (p: number) => { setKwPage(p); fetchKeywordsPage(p) }
  const onPgPageChange = (p: number) => { setPgPage(p); fetchTopPagesPage(p) }

  const refreshAll = () => {
    fetchOverviewData(true)
    if (keywords.data)    fetchKeywordsPage(kwPage, true)
    if (topPages.data)    fetchTopPagesPage(pgPage, true)
    if (competitors.data) fetchCompetitorsData(true)
  }

  // Effective values displayed in the UI (live data preferred, mock fallback)
  const ov          = overview.data    ?? mockOverview
  const kwRows      = keywords.data    ?? []
  const pgRows      = topPages.data    ?? []
  const compRows    = competitors.data ?? mockCompetitors
  // We don't know total row counts from a single page response; expose pagination
  // controls only when there's a possibility of more (i.e. when a full PAGE_SIZE came back).
  const kwHasMore   = kwRows.length === PAGE_SIZE
  const pgHasMore   = pgRows.length === PAGE_SIZE
  const anyLoading  = overview.loading || keywords.loading || topPages.loading || competitors.loading

  return (
    <div className="bg-[#141414] border border-white/8 rounded-lg p-5">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <p className="text-white font-semibold text-sm">Ahrefs</p>
          {usingMockSomewhere && <MockBadge />}
        </div>
        <div className="flex items-center gap-3">
          <p className="text-white/30 text-[11px]">{domain}</p>
          <button
            onClick={refreshAll}
            disabled={anyLoading}
            className={cn('p-1 rounded transition-colors', anyLoading ? 'text-white/15' : 'text-white/30 hover:text-white/70')}
            title="Force refresh (bypasses 24h cache)">
            {anyLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
        </div>
      </div>

      {/* Mock notice — only when something fell back to mock */}
      {usingMockSomewhere && (
        <div className="flex items-start gap-2 p-3 mb-4 bg-yellow-400/5 border border-yellow-400/15 rounded-lg">
          <AlertCircle size={13} className="text-yellow-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-yellow-400 text-xs font-medium">Showing mock data</p>
            <p className="text-white/40 text-[11px] mt-0.5 leading-relaxed">
              Either <code className="text-white/60 bg-white/5 px-1 rounded">AHREFS_API_KEY</code> isn&apos;t set, or the live request returned no rows. Routes are wired and ready — set the env var in Vercel to switch over.
              {(overview.error || keywords.error || topPages.error || competitors.error) && (
                <span className="block mt-1 text-red-400/70">
                  Last error: {overview.error || keywords.error || topPages.error || competitors.error}
                </span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-0.5 mb-4 border-b border-white/5">
        {([
          { id: 'overview',    label: 'Overview'              },
          { id: 'keywords',    label: `Keywords${ov.organicKeywords ? ` (${ov.organicKeywords.toLocaleString()})` : ''}`  },
          { id: 'pages',       label: 'Top Pages'             },
          { id: 'competitors', label: 'Competitors'           },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-3 py-2 text-xs font-medium transition-all border-b-2 -mb-px',
              tab === t.id
                ? 'text-white border-white/40'
                : 'text-white/30 border-transparent hover:text-white/60'
            )}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div className="space-y-4">
          {overview.loading && !overview.data ? (
            <div className="flex items-center gap-2 text-white/30 text-xs py-6">
              <Loader2 size={12} className="animate-spin" /> Loading Ahrefs overview…
            </div>
          ) : (
            <>
              <div className="grid grid-cols-5 gap-3">
                <KpiCard label="Domain Rating"   value={String(ov.domainRating)}              delta={ov.drDelta}         icon={Activity} />
                <KpiCard label="Organic Traffic" value={ov.organicTraffic.toLocaleString()}   delta={ov.trafficDelta}    icon={TrendingUp} />
                <KpiCard label="Keywords"        value={ov.organicKeywords.toLocaleString()}  delta={ov.keywordsDelta}   icon={Search} />
                <KpiCard label="Ref. Domains"    value={ov.refDomains.toLocaleString()}       delta={ov.refDomainsDelta} icon={Globe2} />
                <KpiCard label="Backlinks"       value={ov.backlinks.toLocaleString()}        delta={ov.backlinksDelta}  icon={Link2} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#0d0d0d] border border-white/6 rounded-md p-4">
                  <p className="text-white/30 text-[10px] uppercase tracking-wide mb-2">Traffic Value</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-white font-bold text-2xl tabular-nums">${ov.trafficValue.toLocaleString()}</span>
                    <span className="text-white/30 text-xs">/mo equivalent PPC spend</span>
                  </div>
                  <p className="text-white/30 text-[11px] mt-2 leading-relaxed">
                    What it would cost to buy this organic traffic via Google Ads.
                  </p>
                </div>

                <div className="bg-[#0d0d0d] border border-white/6 rounded-md p-4">
                  <p className="text-white/30 text-[10px] uppercase tracking-wide mb-2">Quick wins</p>
                  <p className="text-white text-sm font-semibold">
                    {kwRows.filter(k => k.position >= 4 && k.position <= 10).length || mockKeywords.filter(k => k.position >= 4 && k.position <= 10).length} keywords on page 1 (pos 4–10)
                  </p>
                  <p className="text-white/30 text-[11px] mt-2 leading-relaxed">
                    Pages already ranking 4–10 typically need only minor on-page work to break into the top 3.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Keywords */}
      {tab === 'keywords' && (
        <div>
          {keywords.loading && kwRows.length === 0 ? (
            <div className="flex items-center gap-2 text-white/30 text-xs py-6">
              <Loader2 size={12} className="animate-spin" /> Loading keywords…
            </div>
          ) : kwRows.length === 0 ? (
            <p className="text-white/30 text-xs py-6">No keywords returned.</p>
          ) : (
            <>
              <div className="grid gap-3 pb-2 border-b border-white/5 text-[10px] text-white/25 uppercase tracking-wide"
                style={{ gridTemplateColumns: '24px 1fr 60px 70px 90px 70px 60px' }}>
                <span></span>
                <span>Keyword</span>
                <span className="text-right">Pos</span>
                <span className="text-right">Volume</span>
                <span className="text-right">KD</span>
                <span className="text-right">Traffic</span>
                <span className="text-right">URL</span>
              </div>
              {kwRows.map((kw) => (
                <div key={`${kw.keyword}-${kw.url}`}
                  className="grid gap-3 py-2 border-b border-white/4 last:border-0 items-center"
                  style={{ gridTemplateColumns: '24px 1fr 60px 70px 90px 70px 60px' }}>
                  <IntentPill intent={kw.intent} />
                  <span className="text-white/70 text-xs truncate" title={kw.keyword}>{kw.keyword}</span>
                  <span className="flex items-center justify-end gap-1.5">
                    <span className="text-white/80 text-xs tabular-nums">{kw.position}</span>
                    <PositionDelta pos={kw.position} prev={kw.prevPos} />
                  </span>
                  <span className="text-white/50 text-xs text-right tabular-nums">{kw.volume.toLocaleString()}</span>
                  <div className="flex justify-end"><DifficultyBar value={kw.difficulty} /></div>
                  <span className="text-white/50 text-xs text-right tabular-nums">{kw.traffic.toLocaleString()}</span>
                  <div className="flex justify-end">
                    <a href={kw.url.startsWith('http') ? kw.url : `https://${domain}${kw.url}`} target="_blank" rel="noopener noreferrer" className="text-white/25 hover:text-white/60" title={kw.url}>
                      <ExternalLink size={10} />
                    </a>
                  </div>
                </div>
              ))}
              <CursorPagination
                page={kwPage}
                hasMore={kwHasMore}
                loading={keywords.loading}
                onChange={onKwPageChange}
              />
            </>
          )}
        </div>
      )}

      {/* Top Pages */}
      {tab === 'pages' && (
        <div>
          {topPages.loading && pgRows.length === 0 ? (
            <div className="flex items-center gap-2 text-white/30 text-xs py-6">
              <Loader2 size={12} className="animate-spin" /> Loading top pages…
            </div>
          ) : pgRows.length === 0 ? (
            <p className="text-white/30 text-xs py-6">No pages returned.</p>
          ) : (
            <>
              <div className="grid gap-3 pb-2 border-b border-white/5 text-[10px] text-white/25 uppercase tracking-wide"
                style={{ gridTemplateColumns: '1fr 80px 80px 70px 70px' }}>
                <span>Page</span>
                <span className="text-right">Top KW</span>
                <span className="text-right">Value</span>
                <span className="text-right">KWs</span>
                <span className="text-right">Traffic</span>
              </div>
              {pgRows.map((p) => (
                <div key={p.url}
                  className="grid gap-3 py-2 border-b border-white/4 last:border-0 items-center"
                  style={{ gridTemplateColumns: '1fr 80px 80px 70px 70px' }}>
                  <a href={p.url.startsWith('http') ? p.url : `https://${domain}${p.url}`} target="_blank" rel="noopener noreferrer"
                     className="text-white/70 text-xs truncate hover:text-white/95" title={p.url}>
                    {p.url}
                  </a>
                  <span className="text-white/50 text-[11px] text-right truncate" title={`${p.topKw} (#${p.topKwPos})`}>
                    #{p.topKwPos || '—'}
                  </span>
                  <span className="text-[#22c55e] text-xs text-right tabular-nums">${p.value.toLocaleString()}</span>
                  <span className="text-white/50 text-xs text-right tabular-nums">{p.keywords}</span>
                  <span className="text-white text-xs text-right font-semibold tabular-nums">{p.traffic.toLocaleString()}</span>
                </div>
              ))}
              <CursorPagination
                page={pgPage}
                hasMore={pgHasMore}
                loading={topPages.loading}
                onChange={onPgPageChange}
              />
            </>
          )}
        </div>
      )}

      {/* Competitors */}
      {tab === 'competitors' && (
        <div>
          <p className="text-white/40 text-[11px] mb-3 leading-relaxed">
            Domains ranking for the same keywords as <span className="text-white/70">{domain}</span>. &quot;Unique&quot; = keywords they rank for that you don&apos;t — your content gap.
          </p>
          {competitors.loading && compRows.length === 0 ? (
            <div className="flex items-center gap-2 text-white/30 text-xs py-6">
              <Loader2 size={12} className="animate-spin" /> Loading competitors…
            </div>
          ) : (
          <>
          <div className="grid gap-3 pb-2 border-b border-white/5 text-[10px] text-white/25 uppercase tracking-wide"
            style={{ gridTemplateColumns: '1fr 50px 80px 80px 80px' }}>
            <span>Competitor</span>
            <span className="text-right">DR</span>
            <span className="text-right">Common</span>
            <span className="text-right">Unique</span>
            <span className="text-right">Overlap</span>
          </div>
          {compRows.map((c) => (
            <div key={c.domain}
              className="grid gap-3 py-2 border-b border-white/4 last:border-0 items-center"
              style={{ gridTemplateColumns: '1fr 50px 80px 80px 80px' }}>
              <a href={`https://${c.domain}`} target="_blank" rel="noopener noreferrer"
                 className="text-white/70 text-xs hover:text-white/95 flex items-center gap-1">
                {c.domain}
                <ExternalLink size={9} className="text-white/25" />
              </a>
              <span className="text-white/60 text-xs text-right tabular-nums">{c.dr}</span>
              <span className="text-white/60 text-xs text-right tabular-nums">{c.commonKw}</span>
              <span className="text-yellow-400 text-xs text-right tabular-nums" title="Content gap — keywords they rank for that you don't">
                {c.uniqueKw.toLocaleString()}
              </span>
              <span className="text-white/50 text-xs text-right tabular-nums">{c.trafficShared}%</span>
            </div>
          ))}
          </>
          )}
        </div>
      )}

      {/* Footer */}
      <p className="text-white/15 text-[10px] mt-4 pt-3 border-t border-white/5">
        Each table page = one Ahrefs API request (25 rows on Standard plan). Responses cached server-side for 24h. Click the refresh icon above to force a fresh fetch and bypass cache.
      </p>
    </div>
  )
}

function CursorPagination({ page, hasMore, loading, onChange }: {
  page:     number
  hasMore:  boolean
  loading:  boolean
  onChange: (p: number) => void
}) {
  if (page === 0 && !hasMore) return null
  const start = page * PAGE_SIZE + 1
  const end   = (page + 1) * PAGE_SIZE
  return (
    <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
      <span className="text-white/30 text-[11px] tabular-nums flex items-center gap-2">
        Rows {start}–{end}
        {loading && <Loader2 size={10} className="animate-spin" />}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(Math.max(0, page - 1))}
          disabled={page === 0 || loading}
          className={cn(
            'p-1 rounded border border-white/8 transition-all',
            page === 0 || loading ? 'text-white/15 cursor-not-allowed' : 'text-white/50 hover:text-white hover:border-white/20'
          )}>
          <ChevronLeft size={12} />
        </button>
        <span className="text-white/40 text-[11px] px-2 tabular-nums">page {page + 1}</span>
        <button
          onClick={() => onChange(page + 1)}
          disabled={!hasMore || loading}
          className={cn(
            'p-1 rounded border border-white/8 transition-all',
            !hasMore || loading ? 'text-white/15 cursor-not-allowed' : 'text-white/50 hover:text-white hover:border-white/20'
          )}>
          <ChevronRight size={12} />
        </button>
      </div>
    </div>
  )
}
