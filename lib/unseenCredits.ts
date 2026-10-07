import type { createClient } from '@/lib/supabase/server'
import { CREDIT_SHOW_REASONS, toUnseenCredits, type UnseenCredit } from '@/lib/creditShow'

// The credit changes the nav's coin show hasn't played yet for this user.
// credits_seen_at is read in its own query, not the layout's main profile
// select: if the column is missing (migration not run yet), that select
// would fail as a whole and drop the user's name, admin link and balance —
// this way only the animation is lost. Never throws; any failure → [].
export async function fetchUnseenCredits(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<UnseenCredit[]> {
  try {
    const { data: seen, error } = await supabase.from('profiles').select('credits_seen_at').eq('id', userId).single()
    if (error || !seen?.credits_seen_at) return []
    const { data: rows, error: ledgerError } = await supabase
      .from('credit_transactions')
      .select('id, amount, reason, created_at, listings(title)')
      .eq('user_id', userId)
      .in('reason', [...CREDIT_SHOW_REASONS])
      .gt('created_at', seen.credits_seen_at)
      .order('created_at', { ascending: true })
      .limit(50)
    if (ledgerError) return []
    return toUnseenCredits(rows ?? [])
  } catch {
    return []
  }
}
