import 'server-only'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'

// For API routes the iPhone app calls with its Supabase access token
// (`Authorization: Bearer <token>`). The returned client acts as that user,
// so row-level security applies exactly as it does in the app itself.
export async function userFromBearer(request: Request): Promise<{ supabase: SupabaseClient; user: User } | null> {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  if (!token) return null
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user } } = await supabase.auth.getUser(token)
  return user ? { supabase, user } : null
}
