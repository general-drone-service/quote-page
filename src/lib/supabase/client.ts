import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.QUOTE_SUPABASE_URL
const supabaseServiceKey = process.env.QUOTE_SUPABASE_SERVICE_ROLE_KEY

/**
 * Server-side Supabase client for the Quote standalone app.
 * Uses its own independent Supabase project.
 * Only use in API routes / server components.
 */
export function getSupabaseAdmin() {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Missing QUOTE_SUPABASE_URL or QUOTE_SUPABASE_SERVICE_ROLE_KEY environment variables"
    )
  }
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  })
}
