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

export async function resolveDispute(disputeId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const { data: dispute, error: fetchError } = await supabase
    .from('disputes')
    .select('conversation_id')
    .eq('id', disputeId)
    .single()
  if (fetchError || !dispute) return { ok: false, error: 'Dispute not found.' }

  const { error } = await supabase
    .from('disputes')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('id', disputeId)
  if (error) return { ok: false, error: error.message }

  // Best-effort: if the exchange is otherwise eligible (both had already
  // confirmed, or the 48h window already passed while the dispute sat open),
  // this completes it immediately. If not, it resolves later via a confirm
  // click or the next cron run — resolveDispute doesn't need to know which.
  await supabase.rpc('resolve_pickup', { p_conversation_id: dispute.conversation_id })

  return { ok: true }
}
