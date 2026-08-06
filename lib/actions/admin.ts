'use server'

import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from './libraryLocations'

// The balance write and the ledger insert both happen inside the
// admin_update_user_credits RPC, not here: this action uses the anon-key +
// session-cookie client, so RLS applies to it. A direct `profiles` update would
// silently match zero rows when an admin edits *another* user (an RLS-filtered
// update raises no error), and a direct `credit_transactions` insert is
// rejected outright — that table is SELECT-only for `authenticated`.
// requireAdmin below is kept as a fast, friendly failure; the RPC's own
// is_admin check is the actual security boundary.
export async function adminUpdateUserCredits(userId: string, credits: number): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const { error } = await supabase.rpc('admin_update_user_credits', { p_user_id: userId, p_credits: credits })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
