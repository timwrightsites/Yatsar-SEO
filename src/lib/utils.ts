import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return num.toString()
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    active: 'text-emerald-400',
    paused: 'text-yellow-400',
    inactive: 'text-red-400',
    running: 'text-blue-400',
    idle: 'text-slate-400',
    error: 'text-red-500',
  }
  return map[status] ?? 'text-slate-400'
}
