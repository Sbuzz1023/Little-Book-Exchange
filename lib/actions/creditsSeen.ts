'use server'

import { createClient } from '@/lib/supabase/server'

// Called by the nav's coin show as soon as it starts playing, with the
// newest credit_transactions.created_at it covers — not now(), so a row
// created after the page rendered still plays next time. Only ever moves
// the marker forward. Never throws: a failure just means the show may
// replay on the next page load.
export async function markCreditsSeen(upTo: string): Promise<void> {
  if (typeof upTo !== 'string' || Number.isNaN(Date.parse(upTo))) return
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase
      .from('profiles')
      .update({ credits_seen_at: upTo })
      .eq('id', user.id)
      .lt('credits_seen_at', upTo)
  } catch {}
}
