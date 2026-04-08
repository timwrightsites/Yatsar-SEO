-- ============================================================
-- Yatsar SEO Dashboard — Supabase Schema
-- Run this in Supabase SQL Editor → New Query → Run
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- CLIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name         TEXT NOT NULL,
  domain       TEXT NOT NULL,
  industry     TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','inactive')),
  monthly_retainer  NUMERIC(10,2),
  onboarded_at TIMESTAMPTZ,
  avatar_url   TEXT,
  notes        TEXT
);

-- ============================================================
-- BOT CONFIGS
-- ============================================================
CREATE TABLE IF NOT EXISTS bot_configs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  bot_type    TEXT NOT NULL CHECK (bot_type IN ('content','link','technical')),
  status      TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('running','idle','paused','error')),
  last_run_at TIMESTAMPTZ,
  config      JSONB NOT NULL DEFAULT '{}',
  schedule    TEXT,
  UNIQUE (client_id, bot_type)
);

-- ============================================================
-- ACTIVITY LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  bot_type    TEXT,
  event_type  TEXT NOT NULL,
  message     TEXT NOT NULL,
  metadata    JSONB,
  status      TEXT NOT NULL DEFAULT 'info' CHECK (status IN ('success','warning','error','info'))
);

-- ============================================================
-- CLIENT KNOWLEDGE BASES
-- ============================================================
CREATE TABLE IF NOT EXISTS client_knowledge_bases (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE UNIQUE,
  brand_voice         TEXT,
  target_keywords     TEXT[],
  competitor_domains  TEXT[],
  content_constraints TEXT,
  link_targets        TEXT[],
  technical_notes     TEXT
);

-- ============================================================
-- CHAT MESSAGES (persisted conversation history per client)
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  agent_id     TEXT NOT NULL DEFAULT 'seo-co-strategist',
  role         TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content      TEXT NOT NULL
);

-- ============================================================
-- AGENT TASKS (conversation + task logging)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_tasks (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  agent_id      TEXT NOT NULL DEFAULT 'seo-co-strategist',
  prompt        TEXT NOT NULL,
  response      TEXT,
  status        TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','error')),
  completed_at  TIMESTAMPTZ
);

-- ============================================================
-- METRICS (monthly snapshots)
-- ============================================================
CREATE TABLE IF NOT EXISTS metrics (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  month               DATE NOT NULL,
  organic_traffic     INTEGER,
  keywords_ranked     INTEGER,
  backlinks           INTEGER,
  domain_rating       INTEGER,
  page_speed_mobile   INTEGER,
  page_speed_desktop  INTEGER,
  impressions         INTEGER,
  clicks              INTEGER,
  UNIQUE (client_id, month)
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_bot_configs_client ON bot_configs(client_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_client ON activity_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_client_month ON metrics(client_id, month DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_client_agent ON chat_messages(client_id, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_client ON agent_tasks(client_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_created ON agent_tasks(created_at DESC);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_knowledge_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tasks ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users (adjust when you add auth)
CREATE POLICY "Allow all for authenticated" ON clients
  FOR ALL USING (true);

CREATE POLICY "Allow all for authenticated" ON bot_configs
  FOR ALL USING (true);

CREATE POLICY "Allow all for authenticated" ON activity_logs
  FOR ALL USING (true);

CREATE POLICY "Allow all for authenticated" ON client_knowledge_bases
  FOR ALL USING (true);

CREATE POLICY "Allow all for authenticated" ON metrics
  FOR ALL USING (true);

CREATE POLICY "Allow all for authenticated" ON agent_tasks
  FOR ALL USING (true);

-- ============================================================
-- REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE activity_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE bot_configs;
ALTER PUBLICATION supabase_realtime ADD TABLE agent_tasks;

-- ============================================================
-- SEED DATA (sample clients to get started)
-- ============================================================
INSERT INTO clients (name, domain, industry, status, monthly_retainer, onboarded_at) VALUES
  ('Acme Corp', 'acmecorp.com', 'SaaS', 'active', 3500, NOW()),
  ('Brightside Legal', 'brightsidelegal.com', 'Legal', 'active', 2800, NOW()),
  ('Peak Fitness', 'peakfitness.io', 'Health & Wellness', 'active', 1800, NOW())
ON CONFLICT DO NOTHING;
