import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  TrendingUp,
  FileText,
  Link2,
  Target,
  MessageSquare,
  Sparkles,
  Zap,
} from 'lucide-react'

export const TAB_KEYS = ['overview', 'seo', 'geo', 'content', 'links', 'strategy', 'runs', 'chat'] as const
export type TabKey = (typeof TAB_KEYS)[number]

const TABS: { key: TabKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', label: 'Overview',        icon: LayoutDashboard },
  { key: 'seo',      label: 'SEO Data',        icon: TrendingUp      },
  { key: 'geo',      label: 'GEO',             icon: Sparkles        },
  { key: 'content',  label: 'Content Drafts',  icon: FileText        },
  { key: 'links',    label: 'Link Prospects',  icon: Link2           },
  { key: 'strategy', label: 'Strategy',        icon: Target          },
  { key: 'runs',     label: 'Bot Runs',        icon: Zap             },
  { key: 'chat',     label: 'AI Chat',         icon: MessageSquare   },
]

export function isTabKey(value: string | undefined | null): value is TabKey {
  return !!value && (TAB_KEYS as readonly string[]).includes(value)
}

interface Props {
  clientId:        string
  active:          TabKey
  pendingDrafts:   number
  newProspects:    number
}

export function ClientTabs({ clientId, active, pendingDrafts, newProspects }: Props) {
  return (
    <div className="border-b border-white/8 mb-6 -mx-1 overflow-x-auto">
      <nav className="flex items-center gap-1 min-w-max">
        {TABS.map(({ key, label, icon: Icon }) => {
          const isActive = key === active
          // Preserve the URL but always send users back to ?tab=<key>
          const href = `/clients/${clientId}?tab=${key}`
          const badgeCount =
            key === 'content' ? pendingDrafts :
            key === 'links'   ? newProspects  :
            0

          return (
            <Link
              key={key}
              href={href}
              scroll={false}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-all whitespace-nowrap',
                isActive
                  ? 'text-white border-white'
                  : 'text-white/40 border-transparent hover:text-white/70 hover:border-white/15'
              )}
            >
              <Icon size={14} />
              {label}
              {badgeCount > 0 && (
                <span className="text-[10px] bg-yellow-500/15 text-yellow-400 border border-yellow-500/20 px-1.5 py-0.5 rounded-full font-medium leading-none">
                  {badgeCount}
                </span>
              )}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
