'use client'

import { Bell, Search } from 'lucide-react'

interface HeaderProps {
  title: string
  subtitle?: string
}

export function Header({ title, subtitle }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-8 py-5 border-b border-white/5 bg-[#0d0f14]/80 backdrop-blur sticky top-0 z-10">
      <div>
        <h1 className="text-lg font-semibold text-white leading-none">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="flex items-center gap-2 bg-white/5 border border-white/5 rounded-lg px-3 py-2 text-sm text-slate-400">
          <Search size={14} />
          <span className="text-slate-500 text-xs">Search...</span>
          <kbd className="ml-2 text-[10px] bg-white/5 border border-white/10 px-1.5 py-0.5 rounded text-slate-500">⌘K</kbd>
        </div>

        {/* Notifications */}
        <button className="relative w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 border border-white/5 text-slate-400 hover:text-slate-200 transition">
          <Bell size={15} />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-violet-500 rounded-full" />
        </button>
      </div>
    </header>
  )
}
