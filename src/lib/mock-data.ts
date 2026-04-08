import type { Client, BotConfig, ActivityLog, Metric } from '@/types'

export const mockClients: Client[] = [
  {
    id: '1',
    created_at: '2024-01-15T00:00:00Z',
    name: 'Acme Corp',
    domain: 'acmecorp.com',
    industry: 'SaaS',
    status: 'active',
    monthly_retainer: 3500,
    onboarded_at: '2024-01-15T00:00:00Z',
    avatar_url: null,
    notes: null,
  },
  {
    id: '2',
    created_at: '2024-02-01T00:00:00Z',
    name: 'Brightside Legal',
    domain: 'brightsidelegal.com',
    industry: 'Legal',
    status: 'active',
    monthly_retainer: 2800,
    onboarded_at: '2024-02-01T00:00:00Z',
    avatar_url: null,
    notes: null,
  },
  {
    id: '3',
    created_at: '2024-03-10T00:00:00Z',
    name: 'Peak Fitness',
    domain: 'peakfitness.io',
    industry: 'Health & Wellness',
    status: 'active',
    monthly_retainer: 1800,
    onboarded_at: '2024-03-10T00:00:00Z',
    avatar_url: null,
    notes: null,
  },
  {
    id: '4',
    created_at: '2024-04-05T00:00:00Z',
    name: 'CloudStack Dev',
    domain: 'cloudstackdev.com',
    industry: 'SaaS',
    status: 'paused',
    monthly_retainer: 4200,
    onboarded_at: '2024-04-05T00:00:00Z',
    avatar_url: null,
    notes: null,
  },
  {
    id: '5',
    created_at: '2024-05-20T00:00:00Z',
    name: 'Terra Landscaping',
    domain: 'terralandscaping.com',
    industry: 'Home Services',
    status: 'active',
    monthly_retainer: 1500,
    onboarded_at: '2024-05-20T00:00:00Z',
    avatar_url: null,
    notes: null,
  },
  {
    id: '6',
    created_at: '2024-06-01T00:00:00Z',
    name: 'NexGen Realty',
    domain: 'nexgenrealty.com',
    industry: 'Real Estate',
    status: 'active',
    monthly_retainer: 2200,
    onboarded_at: '2024-06-01T00:00:00Z',
    avatar_url: null,
    notes: null,
  },
]

export const mockBotConfigs: BotConfig[] = [
  { id: 'b1', created_at: '2024-01-15T00:00:00Z', client_id: '1', bot_type: 'content', status: 'running', last_run_at: '2026-04-03T10:00:00Z', config: {}, schedule: '0 9 * * 1' },
  { id: 'b2', created_at: '2024-01-15T00:00:00Z', client_id: '1', bot_type: 'link', status: 'idle', last_run_at: '2026-04-02T14:30:00Z', config: {}, schedule: '0 14 * * 3' },
  { id: 'b3', created_at: '2024-01-15T00:00:00Z', client_id: '1', bot_type: 'technical', status: 'idle', last_run_at: '2026-04-01T08:00:00Z', config: {}, schedule: '0 8 * * 5' },
]

export const mockActivityLogs: ActivityLog[] = [
  { id: 'a1', created_at: '2026-04-03T10:32:00Z', client_id: '1', bot_type: 'content', event_type: 'research_complete', message: 'Content Bot completed keyword research for acmecorp.com — found 47 opportunities', status: 'success', metadata: null },
  { id: 'a2', created_at: '2026-04-03T09:15:00Z', client_id: '1', bot_type: 'technical', event_type: 'audit_complete', message: 'Technical Bot completed site audit — 3 issues flagged (2 warnings, 1 critical)', status: 'warning', metadata: null },
  { id: 'a3', created_at: '2026-04-02T14:45:00Z', client_id: '1', bot_type: 'link', event_type: 'outreach_sent', message: 'Link Bot sent 12 outreach emails for guest post opportunities', status: 'success', metadata: null },
  { id: 'a5', created_at: '2026-04-01T16:20:00Z', client_id: '1', bot_type: 'content', event_type: 'draft_created', message: 'Content Bot created 2 article drafts — pending your approval', status: 'info', metadata: null },
  { id: 'a6', created_at: '2026-04-01T09:00:00Z', client_id: '1', bot_type: 'technical', event_type: 'speed_check', message: 'PageSpeed audit: Mobile 72, Desktop 91 — mobile needs improvement', status: 'warning', metadata: null },
]

export const mockMetrics: Metric[] = [
  { id: 'm1', created_at: '2024-10-01T00:00:00Z', client_id: '1', month: '2025-10-01', organic_traffic: 8200, keywords_ranked: 340, backlinks: 1240, domain_rating: 42, page_speed_mobile: 68, page_speed_desktop: 88, impressions: 42000, clicks: 2100 },
  { id: 'm2', created_at: '2024-11-01T00:00:00Z', client_id: '1', month: '2025-11-01', organic_traffic: 9100, keywords_ranked: 367, backlinks: 1290, domain_rating: 43, page_speed_mobile: 70, page_speed_desktop: 89, impressions: 46000, clicks: 2340 },
  { id: 'm3', created_at: '2024-12-01T00:00:00Z', client_id: '1', month: '2025-12-01', organic_traffic: 9800, keywords_ranked: 392, backlinks: 1350, domain_rating: 44, page_speed_mobile: 71, page_speed_desktop: 90, impressions: 50000, clicks: 2600 },
  { id: 'm4', created_at: '2025-01-01T00:00:00Z', client_id: '1', month: '2026-01-01', organic_traffic: 10500, keywords_ranked: 418, backlinks: 1420, domain_rating: 45, page_speed_mobile: 72, page_speed_desktop: 91, impressions: 54000, clicks: 2800 },
  { id: 'm5', created_at: '2025-02-01T00:00:00Z', client_id: '1', month: '2026-02-01', organic_traffic: 11200, keywords_ranked: 445, backlinks: 1510, domain_rating: 46, page_speed_mobile: 72, page_speed_desktop: 91, impressions: 58000, clicks: 3100 },
  { id: 'm6', created_at: '2025-03-01T00:00:00Z', client_id: '1', month: '2026-03-01', organic_traffic: 12800, keywords_ranked: 481, backlinks: 1620, domain_rating: 47, page_speed_mobile: 73, page_speed_desktop: 92, impressions: 64000, clicks: 3500 },
]
