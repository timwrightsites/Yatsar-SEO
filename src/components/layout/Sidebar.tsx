'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Home, MessageSquare, Settings, Mail, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase-browser'

const nav = [
  { href: '/',         icon: Home },
  { href: '/messages', icon: MessageSquare },
  { href: '/settings', icon: Settings },
  { href: '/mail',     icon: Mail },
]

export function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="w-[60px] shrink-0 flex flex-col items-center bg-[#0d0d0d] border-r border-white/5 h-screen sticky top-0 py-4">
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center mb-8">
        <span className="text-[11px] font-bold text-black">T</span>
      </div>

      {/* Nav */}
      <nav className="flex flex-col items-center gap-1 flex-1">
        {nav.map(({ href, icon: Icon }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'w-9 h-9 flex items-center justify-center rounded-lg transition-all',
                active
                  ? 'bg-white/10 text-white'
                  : 'text-white/30 hover:text-white/70 hover:bg-white/5'
              )}
            >
              <Icon size={18} />
            </Link>
          )
        })}
      </nav>

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        className="w-9 h-9 flex items-center justify-center rounded-lg text-white/30 hover:text-white/70 hover:bg-white/5 transition-all"
        title="Sign out"
      >
        <LogOut size={18} />
      </button>
    </aside>
  )
}
