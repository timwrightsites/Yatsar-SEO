'use client'

import { usePathname } from 'next/navigation'
import { Shell } from './Shell'
import { ToastProvider } from '../ui/ToastProvider'
import { AgentStatusPoller } from '../ui/AgentStatusPoller'

export function ConditionalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const noShell = pathname.startsWith('/login') || pathname.startsWith('/auth')
  if (noShell) return <>{children}</>
  return (
    <ToastProvider>
      <Shell>{children}</Shell>
      <AgentStatusPoller />
    </ToastProvider>
  )
}
