-- ============================================================
-- 001_paperclip_plugin.sql
-- ------------------------------------------------------------
-- Adds a stable, human-readable mapping key between Paperclip
-- "companies" and Yatsar-SEO "clients" so the Paperclip plugin
-- can look up a client without needing the Supabase UUID baked
-- into the Paperclip host.
--
-- The mapping key is Paperclip's `companyPrefix` (e.g. "TRU" for
-- Trustal Recruiting). It's surfaced in the Paperclip URL
-- (http://<host>/TRU/...) and is stable across Paperclip database
-- rebuilds, whereas the internal companyId UUID rotates when the
-- host's PGlite DB is wiped.
--
-- Safe to re-run — the column add and index are guarded.
-- ============================================================

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS paperclip_company_prefix TEXT;

-- Enforce one-to-one mapping: a given prefix points at exactly
-- one Yatsar client. Partial UNIQUE index so NULLs don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_paperclip_prefix
  ON clients (paperclip_company_prefix)
  WHERE paperclip_company_prefix IS NOT NULL;

-- ------------------------------------------------------------
-- Seed: link Trustal Recruiting -> Paperclip prefix "TRU"
-- ------------------------------------------------------------
-- Client id captured 2026-04-18 from the Yatsar-SEO dashboard URL:
--   https://yatsar-seo.vercel.app/clients/f46fa346-84a5-4411-90ad-01e664ad7660
-- Prefix taken from Paperclip URL: http://localhost:3100/TRU/...
UPDATE clients
SET    paperclip_company_prefix = 'TRU'
WHERE  id = 'f46fa346-84a5-4411-90ad-01e664ad7660'
  AND  (paperclip_company_prefix IS NULL OR paperclip_company_prefix = 'TRU');
