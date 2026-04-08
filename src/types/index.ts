export type { Client, BotConfig, ActivityLog, ClientKB, Metric } from './database'

export interface MetricCard {
  label: string
  value: string | number
  change?: number
  changeLabel?: string
  icon?: string
}

export interface BotStatus {
  type: 'content' | 'link' | 'technical'
  label: string
  status: 'running' | 'idle' | 'paused' | 'error'
  lastRun?: string
  icon: string
}
