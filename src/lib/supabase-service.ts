import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Supabase service-role client.
 *
 * Used by server-side endpoints that authenticate callers via a shared
 * secret (e.g. the Paperclip plugin bearer token) instead of the user's
 * Supabase session cookie. RLS is bypassed — so only call this from
 * routes that have already validated the caller.
 */
let cached: ReturnType<typeof createClient<Database>> | null = null

export function createServiceClient() {
  if (cached) return cached
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Supabase service client missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    )
  }
  cached = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}
