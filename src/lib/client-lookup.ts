/**
 * Shared Yatsar client row resolver used by every
 * `/api/plugins/paperclip/*` route.
 *
 * The 3 agent-callable tools (getKeywords / getBacklinks / getSiteAudit)
 * receive `domain` from the LLM — the most natural key for a tool call
 * ("pull keywords for trustalrecruiting.com"). The dashboard widget still
 * uses `companyPrefix` (e.g. "TRU"). Legacy worker builds may send
 * `clientId` or `companyId`. This helper accepts any of them and resolves
 * to a canonical Yatsar `clients` row — or `null` if nothing matches.
 *
 * Lookup priority (first hit wins):
 *   1. `domain`         — exact match on `clients.domain` (normalized)
 *   2. `companyPrefix`  — match on `clients.paperclip_company_prefix`
 *   3. `clientId`       — match on `clients.id` (UUID)
 *   4. `companyId`      — same as clientId, kept for older worker builds
 */

// Keep the Supabase client loosely typed here — this file is imported by
// Next.js route handlers that already own their own typed clients.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any

export interface ClientRow {
  id: string
  name: string
  domain: string | null
  paperclip_company_prefix: string | null
}

export interface ResolveOpts {
  domain?: string | null
  companyPrefix?: string | null
  clientId?: string | null
  companyId?: string | null
}

const SELECT_COLS = 'id, name, domain, paperclip_company_prefix'

/**
 * Normalize a domain for equality matching. Strips protocol, any trailing
 * slash, and lowercases. We do NOT strip `www.` because some clients are
 * tracked with `www.` in their row (it's rare, but the caller can handle
 * the alias themselves if needed).
 */
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

export async function resolveClient(
  supabase: SupabaseClient,
  opts: ResolveOpts,
): Promise<{ client: ClientRow | null; lookupError: string | null }> {
  let client: ClientRow | null = null
  let lookupError: string | null = null

  if (opts.domain) {
    const norm = normalizeDomain(opts.domain)
    // Try normalized first, then the raw value in case the DB row has a
    // protocol or trailing slash (unlikely, but cheap to check).
    const { data, error } = await supabase
      .from('clients')
      .select(SELECT_COLS)
      .or(`domain.eq.${norm},domain.eq.${opts.domain}`)
      .limit(1)
      .maybeSingle()
    if (error) lookupError = error.message
    client = (data as ClientRow | null) ?? null
  }

  if (!client && opts.companyPrefix) {
    const { data, error } = await supabase
      .from('clients')
      .select(SELECT_COLS)
      .eq('paperclip_company_prefix', opts.companyPrefix)
      .maybeSingle()
    if (error) lookupError = error.message
    client = (data as ClientRow | null) ?? null
  }

  if (!client && opts.clientId) {
    const { data, error } = await supabase
      .from('clients')
      .select(SELECT_COLS)
      .eq('id', opts.clientId)
      .maybeSingle()
    if (error) lookupError = error.message
    client = (data as ClientRow | null) ?? null
  }

  if (!client && opts.companyId) {
    const { data, error } = await supabase
      .from('clients')
      .select(SELECT_COLS)
      .eq('id', opts.companyId)
      .maybeSingle()
    if (error) lookupError = error.message
    client = (data as ClientRow | null) ?? null
  }

  return { client, lookupError }
}
