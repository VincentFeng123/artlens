import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

/**
 * Service-role client for DB writes + Storage uploads from inside Edge
 * Functions. SUPABASE_URL is injected automatically by the Supabase runtime;
 * SUPABASE_SERVICE_ROLE_KEY must be set via `supabase secrets set`.
 */
export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}
