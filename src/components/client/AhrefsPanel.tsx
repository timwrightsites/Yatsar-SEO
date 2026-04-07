'use client'

/**
 * AhrefsPanel — UI scaffold ready to wire to the Ahrefs API v3.
 *
 * STATUS: Mock data only. No live calls yet.
 *
 * WIRE-UP NOTES (when the Ahrefs key is live):
 *   1. Replace the mock* constants below with real API responses from
 *      /api/ahrefs/* route handlers (to be created).
 *   2. Designed for the Standard plan (25 rows per request). The tables
 *      paginate at PAGE_SIZE=25 to mirror what one API call returns —
 *      each "Next page" click should map 1:1 to a new API request.
 *   3. Endpoints to map (Ahrefs API v3):
 *        Domain overview KPIs   → /v3/site-explorer/overview
 *        Top organic keywords   → /v3/site-explorer/organic-keywords
 *        Top pages              → /v3/site-explorer/top-pages
 *        Competitors / gap      → /v3/site-explorer/competing-domains
 *   4. Cache aggressively in Supabase (ahrefs_snapshots table) — daily
 *      refresh is plenty for everything except rank tracker.
 */

import { useMemo, useState } from 'react'
import {
  TrendingUp, TrendingDown, Link2, Globe2, Activity, Search,
  ExternalLink, ChevronLeft, ChevronRight, Sparkles, AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  domain: string
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

// ── Main panel ────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'keywords' | 'pages' | 'competitors'

export function AhrefsPanel({ domain }: Props) {
  const [tab, setTab]   = useState<Tab>('overview')
  const [kwPage, setKwPage] = useState(0)
  const [pgPage, setPgPage] = useState(0)

  const kwPaginated = useMemo(() => {
    const start = kwPage * PAGE_SIZE
    return mockKeywords.slice(start, start + PAGE_SIZE)
  }, [kwPage])
  const kwTotalPages = Math.ceil(mockKeywords.length / PAGE_SIZE)

  const pgPaginated = useMemo(() => {
    const start = pgPage * PAGE_SIZE
    return mockTopPages.slice(start, start + PAGE_SIZE)
  }, [pgPage])
  const pgTotalPages = Math.ceil(mockTopPages.length / PAGE_SIZE)

  return (
    <div className="bg-[#141414] border border-white/8 rounded-lg p-5">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <p className="text-white font-semibold text-sm">Ahrefs</p>
          <MockBadge />
        </div>
        <p className="text-white/30 text-[11px]">{domain}</p>
      </div>

      {/* Setup notice */}
      <div className="flex items-start gap-2 p-3 mb-4 bg-yellow-400/5 border border-yellow-400/15 rounded-lg">
        <AlertCircle size={13} className="text-yellow-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-yellow-400 text-xs font-medium">Pending Ahrefs API connection</p>
          <p className="text-white/40 text-[11px] mt-0.5 leading-relaxed">
            This panel is rendering mock data. Once you add your Ahrefs API key to <code className="text-white/60 bg-white/5 px-1 rounded">AHREFS_API_KEY</code>, the wired routes at <code className="text-white/60 bg-white/5 px-1 rounded">/api/ahrefs/*</code> will swap in live data. Tables paginate at 25 rows to match the Standard plan&apos;s per-request cap.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 mb-4 border-b border-white/5">
        {([
          { id: 'overview',    label: 'Overview'              },
          { id: 'keywords',    label: `Keywords (${mockOverview.organicKeywords})`  },
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
          <div className="grid grid-cols-5 gap-3">
            <KpiCard label="Domain Rating"   value={String(mockOverview.domainRating)}              delta={mockOverview.drDelta}        icon={Activity} />
            <KpiCard label="Organic Traffic" value={mockOverview.organicTraffic.toLocaleString()}   delta={mockOverview.trafficDelta}   icon={TrendingUp} />
            <KpiCard label="Keywords"        value={mockOverview.organicKeywords.toLocaleString()}  delta={mockOverview.keywordsDelta}  icon={Search} />
            <KpiCard label="Ref. Domains"    value={mockOverview.refDomains.toLocaleString()}       delta={mockOverview.refDomainsDelta} icon={Globe2} />
            <KpiCard label="Backlinks"       value={mockOverview.backlinks.toLocaleString()}        delta={mockOverview.backlinksDelta} icon={Link2} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#0d0d0d] border border-white/6 rounded-md p-4">
              <p className="text-white/30 text-[10px] uppercase tracking-wide mb-2">Traffic Value</p>
              <div className="flex items-baseline gap-2">
                <span className="text-white font-bold text-2xl tabular-nums">${mockOverview.trafficValue.toLocaleString()}</span>
                <span className="text-white/30 text-xs">/mo equivalent PPC spend</span>
              </div>
              <p className="text-white/30 text-[11px] mt-2 leading-relaxed">
                What it would cost to buy this organic traffic via Google Ads.
              </p>
            </div>

            <div className="bg-[#0d0d0d] border border-white/6 rounded-md p-4">
              <p className="text-white/30 text-[10px] uppercase tracking-wide mb-2">Quick wins</p>
              <p className="text-white text-sm font-semibold">
                {mockKeywords.filter(k => k.position >= 4 && k.position <= 10).length} keywords on page 1 (pos 4–10)
              </p>
              <p className="text-white/30 text-[11px] mt-2 leading-relaxed">
                Pages already ranking 4–10 typically need only minor on-page work to break into the top 3.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Keywords */}
      {tab === 'keywords' && (
        <div>
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
          {kwPaginated.map((kw) => (
            <div key={kw.keyword}
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
                <a href={`https://${domain}${kw.url}`} target="_blank" rel="noopener noreferrer" className="text-white/25 hover:text-white/60" title={kw.url}>
                  <ExternalLink size={10} />
                </a>
              </div>
            </div>
          ))}
          <Pagination
            page={kwPage}
            totalPages={kwTotalPages}
            totalRows={mockKeywords.length}
            onChange={setKwPage}
          />
        </div>
      )}

      {/* Top Pages */}
      {tab === 'pages' && (
        <div>
          <div className="grid gap-3 pb-2 border-b border-white/5 text-[10px] text-white/25 uppercase tracking-wide"
            style={{ gridTemplateColumns: '1fr 80px 80px 70px 70px' }}>
            <span>Page</span>
            <span className="text-right">Top KW</span>
            <span className="text-right">Value</span>
            <span className="text-right">KWs</span>
            <span className="text-right">Traffic</span>
          </div>
          {pgPaginated.map((p) => (
            <div key={p.url}
              className="grid gap-3 py-2 border-b border-white/4 last:border-0 items-center"
              style={{ gridTemplateColumns: '1fr 80px 80px 70px 70px' }}>
              <a href={`https://${domain}${p.url}`} target="_blank" rel="noopener noreferrer"
                 className="text-white/70 text-xs truncate hover:text-white/95" title={p.url}>
                {p.url}
              </a>
              <span className="text-white/50 text-[11px] text-right truncate" title={`${p.topKw} (#${p.topKwPos})`}>
                #{p.topKwPos}
              </span>
              <span className="text-[#22c55e] text-xs text-right tabular-nums">${p.value.toLocaleString()}</span>
              <span className="text-white/50 text-xs text-right tabular-nums">{p.keywords}</span>
              <span className="text-white text-xs text-right font-semibold tabular-nums">{p.traffic.toLocaleString()}</span>
            </div>
          ))}
          <Pagination
            page={pgPage}
            totalPages={pgTotalPages}
            totalRows={mockTopPages.length}
            onChange={setPgPage}
          />
        </div>
      )}

      {/* Competitors */}
      {tab === 'competitors' && (
        <div>
          <p className="text-white/40 text-[11px] mb-3 leading-relaxed">
            Domains ranking for the same keywords as <span className="text-white/70">{domain}</span>. &quot;Unique&quot; = keywords they rank for that you don&apos;t — your content gap.
          </p>
          <div className="grid gap-3 pb-2 border-b border-white/5 text-[10px] text-white/25 uppercase tracking-wide"
            style={{ gridTemplateColumns: '1fr 50px 80px 80px 80px' }}>
            <span>Competitor</span>
            <span className="text-right">DR</span>
            <span className="text-right">Common</span>
            <span className="text-right">Unique</span>
            <span className="text-right">Overlap</span>
          </div>
          {mockCompetitors.map((c) => (
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
        </div>
      )}

      {/* Footer */}
      <p className="text-white/15 text-[10px] mt-4 pt-3 border-t border-white/5">
        Tables paginate at 25 rows to mirror the Ahrefs Standard plan&apos;s API row cap. Each &quot;next page&quot; will map to one API request when wired.
      </p>
    </div>
  )
}

function Pagination({ page, totalPages, totalRows, onChange }: {
  page:       number
  totalPages: number
  totalRows:  number
  onChange:   (p: number) => void
}) {
  if (totalPages <= 1) return null
  const start = page * PAGE_SIZE + 1
  const end   = Math.min((page + 1) * PAGE_SIZE, totalRows)
  return (
    <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
      <span className="text-white/30 text-[11px] tabular-nums">
        {start}–{end} of {totalRows}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(Math.max(0, page - 1))}
          disabled={page === 0}
          className={cn(
            'p-1 rounded border border-white/8 transition-all',
            page === 0 ? 'text-white/15 cursor-not-allowed' : 'text-white/50 hover:text-white hover:border-white/20'
          )}>
          <ChevronLeft size={12} />
        </button>
        <span className="text-white/40 text-[11px] px-2 tabular-nums">{page + 1} / {totalPages}</span>
        <button
          onClick={() => onChange(Math.min(totalPages - 1, page + 1))}
          disabled={page === totalPages - 1}
          className={cn(
            'p-1 rounded border border-white/8 transition-all',
            page === totalPages - 1 ? 'text-white/15 cursor-not-allowed' : 'text-white/50 hover:text-white hover:border-white/20'
          )}>
          <ChevronRight size={12} />
        </button>
      </div>
    </div>
  )
}
