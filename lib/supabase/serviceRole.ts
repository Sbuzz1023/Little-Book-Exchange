// Turns an accidental client-side import of this module into a build error
// rather than a route that quietly ships the service role key to the browser.
import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Server-only. Bypasses Row Level Security entirely — use this ONLY for code
// that runs with no logged-in user (like the Send Email Hook receiver), never
// for anything reachable from a browser request. The service role key must
// never be sent to the client; it isn't prefixed NEXT_PUBLIC_ for that reason.
export function createServiceRoleClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
