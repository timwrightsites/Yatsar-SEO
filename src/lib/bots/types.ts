/**
 * Shared types for the autonomous bot system.
 *
 * The bot system is event-driven: a strategy task gets inserted into
 * `strategy_tasks`, the dispatcher reads its `type` field, looks up the
 * matching standing order in `bot_standing_orders` for that (client × bot),
 * and either kicks off the bot or skips/escalates per the standing order.
 *
 * Every execution writes a row to `bot_runs` so the agency owner has a
 * complete audit trail of what each bot did, when, and why.
 */

export type BotType = 'content' | 'link' | 'technical' | 'geo'

export type BotRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'escalated'
  | 'skipped'

export type TriggerSource = 'task_created' | 'cron' | 'manual'

export interface StandingOrder {
  id:               string
  client_id:        string
  bot_type:         BotType
  enabled:          boolean
  scope:            string
  triggers:         string
  approval_gate:    string | null
  escalation_rules: string | null
  config:           Record<string, unknown>
}

export interface StrategyTask {
  id:          string
  client_id:   string
  strategy_id: string
  title:       string
  description: string | null
  type:        string
  status:      string
  priority:    string
  notes:       string | null
  /**
   * Free-form per-task payload written by the strategist at task-creation
   * time. Bots can branch on fields here to enter alternate execution modes
   * (e.g. link_targets for the Link Bot's strategist-driven mode).
   */
  metadata:    Record<string, unknown> | null
}

export interface BotRunRecord {
  id?:             string
  client_id:       string
  bot_type:        BotType
  task_id:         string | null
  status:          BotRunStatus
  trigger_source:  TriggerSource
  input:           Record<string, unknown>
  output?:         Record<string, unknown> | null
  error_message?:  string | null
  started_at?:     string | null
  finished_at?:    string | null
  duration_ms?:    number | null
}

/**
 * Result returned by every concrete bot implementation.
 * The dispatcher takes this and writes it to bot_runs + updates the task.
 */
export interface BotExecutionResult {
  status:    Exclude<BotRunStatus, 'queued' | 'running'>
  output?:   Record<string, unknown>
  summary?:  string  // human-readable, written to strategy_tasks.notes
  error?:    string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseClient = any
