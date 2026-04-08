export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface AgencySettings {
  id: string
  user_id: string
  display_name: string | null
  gsc_api_key: string | null
  pagespeed_api_key: string | null
  updated_at: string | null
}

export interface Database {
  public: {
    Views: Record<string, never>
    Functions: Record<string, never>
    Tables: {
      clients: {
        Row: Client
        Insert: Omit<Client, 'id' | 'created_at'>
        Update: Partial<Omit<Client, 'id' | 'created_at'>>
        Relationships: []
      }
      bot_configs: {
        Row: BotConfig
        Insert: Omit<BotConfig, 'id' | 'created_at'>
        Update: Partial<Omit<BotConfig, 'id' | 'created_at'>>
        Relationships: []
      }
      activity_logs: {
        Row: ActivityLog
        Insert: Omit<ActivityLog, 'id' | 'created_at'>
        Update: Partial<Omit<ActivityLog, 'id' | 'created_at'>>
        Relationships: []
      }
      client_knowledge_bases: {
        Row: ClientKB
        Insert: Omit<ClientKB, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<ClientKB, 'id' | 'created_at'>>
        Relationships: []
      }
      metrics: {
        Row: Metric
        Insert: Omit<Metric, 'id' | 'created_at'>
        Update: Partial<Omit<Metric, 'id' | 'created_at'>>
        Relationships: []
      }
      agency_settings: {
        Row: AgencySettings
        Insert: Omit<AgencySettings, 'id'>
        Update: Partial<Omit<AgencySettings, 'id'>>
        Relationships: []
      }
    }
  }
}

export interface Client {
  id: string
  created_at: string
  name: string
  domain: string
  industry: string | null
  status: 'active' | 'paused' | 'inactive'
  monthly_retainer: number | null
  onboarded_at: string | null
  avatar_url: string | null
  notes: string | null
}

export interface BotConfig {
  id: string
  created_at: string
  client_id: string
  bot_type: 'content' | 'link' | 'technical'
  status: 'running' | 'idle' | 'paused' | 'error'
  last_run_at: string | null
  config: Json
  schedule: string | null
}

export interface ActivityLog {
  id: string
  created_at: string
  client_id: string
  bot_type: string | null
  event_type: string
  message: string
  metadata: Json | null
  status: 'success' | 'warning' | 'error' | 'info'
}

export interface ClientKB {
  id: string
  created_at: string
  updated_at: string
  client_id: string
  brand_voice: string | null
  target_keywords: string[] | null
  competitor_domains: string[] | null
  content_constraints: string | null
  link_targets: string[] | null
  technical_notes: string | null
}

export interface Metric {
  id: string
  created_at: string
  client_id: string
  month: string
  organic_traffic: number | null
  keywords_ranked: number | null
  backlinks: number | null
  domain_rating: number | null
  page_speed_mobile: number | null
  page_speed_desktop: number | null
  impressions: number | null
  clicks: number | null
}
