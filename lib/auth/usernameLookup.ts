import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

// Emails are hidden from public reads (shared backend 6/6), so signing in by
// username needs the service role to find the address. Never send the
// result back to a browser or app.
export async function lookupEmailForUsername(username: string): Promise<string | null> {
  const { data } = await createServiceRoleClient()
    .from('profiles').select('email').eq('username', username).maybeSingle()
  return data?.email ?? null
}
