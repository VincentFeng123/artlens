import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Null when Supabase isn't configured — the app then runs entirely in local
 * demo mode (see lib/api.ts). Only the anon key ever reaches the client; all
 * provider/service-role secrets live in Edge Function secrets.
 */
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null

export const isBackendConfigured = supabase !== null
