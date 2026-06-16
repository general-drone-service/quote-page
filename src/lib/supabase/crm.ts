import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * Service-role client to the SHARED Drone168 CRM (separate project from this
 * app's own QUOTE_SUPABASE). Used to mirror paid-ad quote leads into CRM
 * `ad_leads` so Google + Meta are measured on one ruler.
 *
 * Returns null when CRM env isn't set — callers MUST treat the mirror as
 * best-effort and never block the quote on it.
 * Env (never in repo): CRM_SUPABASE_URL, CRM_SUPABASE_SERVICE_ROLE_KEY
 */
export function getCrmAdmin(): SupabaseClient | null {
  const url = process.env.CRM_SUPABASE_URL
  const key = process.env.CRM_SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}
