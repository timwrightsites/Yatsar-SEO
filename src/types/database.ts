export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface AgencySettings {
  id: string
  user_id: string | null
  display_name: string | null
  gsc_api_key: string | null
  pagespeed_api_key: string | null
  created_at: string | null
  updated_at: string | null
}

export interface Client {
  id: string
  created_at: string | null
  name: string
  domain: string
  industry: string | null
  vertical: string | null
  company_id: string
  status: 'active' | 'paused' | 'inactive' | 'archived' | null
  monthly_retainer: number | null
  monthly_retainer_cents: number | null
  onboarded_at: string | null
  avatar_url: string | null
  logo_url: string | null
  notes: string | null
  ahrefs_project_id: string | null
  gsc_property: string | null
  pagespeed_url: string | null
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

export interface BotRun {
  id: string
  created_at: string
  client_id: string
  bot_type: string | null
  task_id: string | null
  agent_run_id: string | null
  status: string
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  trigger_source: string | null
  output: Json | null
  error_message: string | null
}

export interface BotStandingOrder {
  id: string
  created_at: string
  client_id: string
  bot_type: string
  enabled: boolean
  schedule: string | null
  config: Json
}

export interface ActivityLog {
  id: string
  created_at: string | null
  client_id: string | null
  // Paperclip-side columns
  kind: string
  title: string
  detail: string | null
  meta: Json | null
  // App-side columns (legacy shape, now nullable)
  bot_type: string | null
  event_type: string | null
  message: string | null
  metadata: Json | null
  status: 'success' | 'warning' | 'error' | 'info' | null
}

export interface ClientKB {
  id: string
  updated_at: string | null
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

export interface MetricSnapshot {
  id: string
  client_id: string
  source: 'gsc' | 'ahrefs' | 'site-audit' | 'brand-radar' | 'manual'
  metric: string
  value: number | null
  captured_at: string | null
  meta: Json | null
}

export interface AgentRun {
  id: string
  client_id: string
  agent: string
  issue_id: string | null
  status: string
  started_at: string | null
  finished_at: string | null
  input: string | null
  output: string | null
  output_summary: string | null
  metadata: Json | null
  cost_cents: number | null
}

export interface AgentTask {
  id: string
  created_at: string
  completed_at: string | null
  client_id: string
  agent_id: string
  prompt: string
  response: string | null
  status: 'running' | 'completed' | 'error'
}

export interface ChatMessage {
  id: string
  created_at: string | null
  client_id: string
  agent: string
  agent_id: string | null
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface Strategy {
  id: string
  created_at: string
  updated_at: string
  client_id: string
  name: string
  description: string | null
  status: 'active' | 'paused' | 'archived' | 'completed'
}

export interface StrategyTask {
  id: string
  created_at: string
  updated_at: string
  completed_at: string | null
  client_id: string
  strategy_id: string | null
  title: string
  type: string | null
  notes: string | null
  output_ref: string | null
  status: string
  scheduled_for: string | null
}

export interface LinkProspect {
  id: string
  created_at: string | null
  updated_at: string | null
  client_id: string
  domain: string
  url: string | null
  title: string | null
  domain_rating: number | null
  traffic: number | null
  relevance_score: number | null
  prospect_score: number | null
  prospect_type: string | null
  opportunity_type: string | null
  discovered_from: string | null
  output_ref: string | null
  source_run_id: string | null
  status: string
  notes: string | null
}

export interface OutreachDraft {
  id: string
  created_at: string
  updated_at: string
  client_id: string
  prospect_id: string | null
  subject: string | null
  body: string | null
  tone: string | null
  status: 'drafted' | 'reviewed' | 'approved' | 'sent' | 'rejected'
  agent_notes: string | null
  reviewer_notes: string | null
}

export interface OutreachThread {
  id: string
  created_at: string | null
  client_id: string
  prospect_id: string | null
  subject: string | null
  to_email: string | null
  from_email: string | null
  status: string
  last_message: string | null
  last_activity_at: string | null
}

export interface ContentDraft {
  id: string
  created_at: string | null
  updated_at: string | null
  client_id: string
  title: string
  target_url: string | null
  target_keyword: string | null
  body_html: string | null
  body_json: Json | null
  status: 'draft' | 'reviewed' | 'approved' | 'published' | 'archived'
  author_agent: string | null
  source_run_id: string | null
}

export interface Competitor {
  id: string
  created_at: string
  updated_at: string
  client_id: string
  domain: string
  notes: string | null
  last_analyzed_at: string | null
  analysis: Json | null
}

export interface ClientMemory {
  id: string
  created_at: string
  updated_at: string
  client_id: string
  kind: string
  content: string
  meta: Json | null
}

export interface AhrefsSnapshot {
  id: string
  created_at: string
  captured_at: string
  client_id: string
  payload: Json
  summary: string | null
}

export interface Database {
  public: {
    Views: Record<string, never>
    Functions: Record<string, never>
    Tables: {
      clients: {
        Row: Client
        Insert: Partial<Omit<Client, 'id' | 'created_at'>> & { name: string; domain: string; company_id: string }
        Update: Partial<Client>
        Relationships: []
      }
      bot_configs: {
        Row: BotConfig
        Insert: Omit<BotConfig, 'id' | 'created_at'>
        Update: Partial<Omit<BotConfig, 'id' | 'created_at'>>
        Relationships: []
      }
      bot_runs: {
        Row: BotRun
        Insert: Partial<Omit<BotRun, 'id' | 'created_at'>> & { client_id: string }
        Update: Partial<BotRun>
        Relationships: []
      }
      bot_standing_orders: {
        Row: BotStandingOrder
        Insert: Omit<BotStandingOrder, 'id' | 'created_at'>
        Update: Partial<Omit<BotStandingOrder, 'id' | 'created_at'>>
        Relationships: []
      }
      activity_logs: {
        Row: ActivityLog
        Insert: Partial<Omit<ActivityLog, 'id' | 'created_at'>> & { kind: string; title: string }
        Update: Partial<ActivityLog>
        Relationships: []
      }
      client_knowledge_bases: {
        Row: ClientKB
        Insert: Omit<ClientKB, 'id' | 'updated_at'>
        Update: Partial<Omit<ClientKB, 'id'>>
        Relationships: []
      }
      metrics: {
        Row: Metric
        Insert: Omit<Metric, 'id' | 'created_at'>
        Update: Partial<Omit<Metric, 'id' | 'created_at'>>
        Relationships: []
      }
      metric_snapshots: {
        Row: MetricSnapshot
        Insert: Partial<Omit<MetricSnapshot, 'id'>> & { client_id: string; source: MetricSnapshot['source']; metric: string }
        Update: Partial<MetricSnapshot>
        Relationships: []
      }
      agent_runs: {
        Row: AgentRun
        Insert: Partial<Omit<AgentRun, 'id'>> & { client_id: string; agent: string; status: string }
        Update: Partial<AgentRun>
        Relationships: []
      }
      agent_tasks: {
        Row: AgentTask
        Insert: Partial<Omit<AgentTask, 'id' | 'created_at'>> & { client_id: string; prompt: string }
        Update: Partial<AgentTask>
        Relationships: []
      }
      chat_messages: {
        Row: ChatMessage
        Insert: Partial<Omit<ChatMessage, 'id' | 'created_at'>> & { client_id: string; role: ChatMessage['role']; content: string }
        Update: Partial<ChatMessage>
        Relationships: []
      }
      strategies: {
        Row: Strategy
        Insert: Partial<Omit<Strategy, 'id' | 'created_at' | 'updated_at'>> & { client_id: string; name: string }
        Update: Partial<Strategy>
        Relationships: []
      }
      strategy_tasks: {
        Row: StrategyTask
        Insert: Partial<Omit<StrategyTask, 'id' | 'created_at' | 'updated_at'>> & { client_id: string; title: string }
        Update: Partial<StrategyTask>
        Relationships: []
      }
      link_prospects: {
        Row: LinkProspect
        Insert: Partial<Omit<LinkProspect, 'id'>> & { client_id: string; domain: string }
        Update: Partial<LinkProspect>
        Relationships: []
      }
      outreach_drafts: {
        Row: OutreachDraft
        Insert: Partial<Omit<OutreachDraft, 'id' | 'created_at' | 'updated_at'>> & { client_id: string }
        Update: Partial<OutreachDraft>
        Relationships: []
      }
      outreach_threads: {
        Row: OutreachThread
        Insert: Partial<Omit<OutreachThread, 'id'>> & { client_id: string }
        Update: Partial<OutreachThread>
        Relationships: []
      }
      content_drafts: {
        Row: ContentDraft
        Insert: Partial<Omit<ContentDraft, 'id'>> & { client_id: string; title: string }
        Update: Partial<ContentDraft>
        Relationships: []
      }
      competitors: {
        Row: Competitor
        Insert: Partial<Omit<Competitor, 'id' | 'created_at' | 'updated_at'>> & { client_id: string; domain: string }
        Update: Partial<Competitor>
        Relationships: []
      }
      client_memory: {
        Row: ClientMemory
        Insert: Partial<Omit<ClientMemory, 'id' | 'created_at' | 'updated_at'>> & { client_id: string; kind: string; content: string }
        Update: Partial<ClientMemory>
        Relationships: []
      }
      ahrefs_snapshots: {
        Row: AhrefsSnapshot
        Insert: Partial<Omit<AhrefsSnapshot, 'id' | 'created_at'>> & { client_id: string; payload: Json }
        Update: Partial<AhrefsSnapshot>
        Relationships: []
      }
      agency_settings: {
        Row: AgencySettings
        Insert: Partial<Omit<AgencySettings, 'id' | 'created_at' | 'updated_at'>>
        Update: Partial<AgencySettings>
        Relationships: []
      }
    }
  }
}
