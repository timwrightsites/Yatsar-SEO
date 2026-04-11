'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { CheckCircle, XCircle, Loader2, Zap, X } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

type ToastType = 'success' | 'error' | 'running' | 'info'

interface Toast {
  id: string
  type: ToastType
  title: string
  message?: string
  /** Auto-dismiss after N ms. 0 = sticky. Default 5000. */
  duration?: number
  /** Link to navigate on click */
  href?: string
}

interface ToastContextValue {
  addToast: (toast: Omit<Toast, 'id'>) => string
  removeToast: (id: string) => void
  /** Update an existing toast (e.g. running → success) */
  updateToast: (id: string, updates: Partial<Omit<Toast, 'id'>>) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}

// ── Provider ───────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setToasts(prev => [...prev, { ...toast, id }])
    const duration = toast.duration ?? (toast.type === 'running' ? 0 : 5000)
    if (duration > 0) {
      setTimeout(() => removeToast(id), duration)
    }
    return id
  }, [removeToast])

  const updateToast = useCallback((id: string, updates: Partial<Omit<Toast, 'id'>>) => {
    setToasts(prev => prev.map(t => {
      if (t.id !== id) return t
      const updated = { ...t, ...updates }
      // If switching from running to success/error, auto-dismiss
      if (t.type === 'running' && updates.type && updates.type !== 'running') {
        const dur = updates.duration ?? 5000
        if (dur > 0) setTimeout(() => removeToast(id), dur)
      }
      return updated
    }))
  }, [removeToast])

  // ── Listen for global agent events ──
  useEffect(() => {
    function onAgentDispatched(e: Event) {
      const { taskId } = (e as CustomEvent).detail ?? {}
      addToast({
        type: 'running',
        title: 'Agent dispatched',
        message: 'Running autonomously — you\'ll be notified when done.',
        duration: 4000,
      })
    }

    window.addEventListener('agent-dispatched', onAgentDispatched)
    return () => window.removeEventListener('agent-dispatched', onAgentDispatched)
  }, [addToast])

  return (
    <ToastContext.Provider value={{ addToast, removeToast, updateToast }}>
      {children}
      {/* Toast container — bottom right */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col-reverse gap-2 pointer-events-none">
        {toasts.map(toast => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// ── Toast card ─────────────────────────────────────────────────────────────────

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={16} className="text-[#22c55e] shrink-0" />,
  error:   <XCircle size={16} className="text-red-400 shrink-0" />,
  running: <Loader2 size={16} className="text-blue-400 shrink-0 animate-spin" />,
  info:    <Zap size={16} className="text-violet-400 shrink-0" />,
}

const BORDERS: Record<ToastType, string> = {
  success: 'border-[#22c55e]/20',
  error:   'border-red-400/20',
  running: 'border-blue-400/20',
  info:    'border-violet-400/20',
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div
      className={cn(
        'pointer-events-auto w-80 bg-[#1a1a1a] border rounded-xl shadow-2xl',
        'px-4 py-3 flex items-start gap-3',
        'animate-in slide-in-from-right-full fade-in duration-300',
        BORDERS[toast.type],
      )}
    >
      <div className="mt-0.5">{ICONS[toast.type]}</div>
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-medium leading-snug">{toast.title}</p>
        {toast.message && (
          <p className="text-white/40 text-xs mt-0.5 leading-relaxed">{toast.message}</p>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="text-white/20 hover:text-white/50 transition-colors shrink-0 mt-0.5"
      >
        <X size={14} />
      </button>
    </div>
  )
}
