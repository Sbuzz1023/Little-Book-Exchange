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

export async function adminSetDisputeStatus(disputeId: string, status: 'open' | 'resolved' | 'unresolved'): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const { data: dispute, error: fetchError } = await supabase
    .from('disputes')
    .select('conversation_id')
    .eq('id', disputeId)
    .single()
  if (fetchError || !dispute) return { ok: false, error: 'Dispute not found.' }

  const closed = status === 'resolved' || status === 'unresolved'
  const { error } = await supabase
    .from('disputes')
    .update({ status, resolved_at: closed ? new Date().toISOString() : null })
    .eq('id', disputeId)
  if (error) return { ok: false, error: error.message }

  // Both terminal outcomes — resolved (the problem was actually fixed) and
  // unresolved (the admin is closing this out without fixing it) — mean the
  // admin is done looking at this, so resolve_pickup() gets a chance to
  // complete an otherwise-eligible exchange either way. Only an OPEN dispute
  // blocks completion in the first place, so setting status back to 'open'
  // (not exposed in the UI, kept here for flexibility) never calls it — an
  // open dispute re-blocks automatically the next time resolve_pickup runs,
  // since it checks live for any open dispute.
  if (closed) {
    await supabase.rpc('resolve_pickup', { p_conversation_id: dispute.conversation_id })
  }

  return { ok: true }
}

export async function adminDeleteDispute(disputeId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const { data: dispute, error: fetchError } = await supabase
    .from('disputes')
    .select('conversation_id, status')
    .eq('id', disputeId)
    .single()
  if (fetchError || !dispute) return { ok: false, error: 'Dispute not found.' }

  const { data: deleted, error } = await supabase
    .from('disputes')
    .delete()
    .eq('id', disputeId)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!deleted || deleted.length === 0) {
    return { ok: false, error: 'Delete was blocked — the admin delete policy may not be applied yet.' }
  }

  // Deleting a frivolous OPEN dispute can immediately unblock a stuck
  // exchange, same reasoning as resolving one. A resolved dispute is already
  // non-blocking, so no need to call this again.
  if (dispute.status === 'open') {
    await supabase.rpc('resolve_pickup', { p_conversation_id: dispute.conversation_id })
  }

  return { ok: true }
}
