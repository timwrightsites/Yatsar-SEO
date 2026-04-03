'use client'

import { usePathname } from 'next/navigation'
import { Shell } from './Shell'

export function ConditionalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const noShell = pathname.startsWith('/login') || pathname.startsWith('/auth')
  if (noShell) return <>{children}</>
  return <Shell>{children}</Shell>
}
