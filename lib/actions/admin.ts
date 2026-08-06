'use server'

import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from './libraryLocations'

export async function adminUpdateUserCredits(userId: string, credits: number): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const { data: before } = await supabase.from('profiles').select('credits').eq('id', userId).single()
  if (!before) return { ok: false, error: 'User not found.' }

  const delta = credits - before.credits
  if (delta === 0) return { ok: true }

  const { error } = await supabase.from('profiles').update({ credits }).eq('id', userId)
  if (error) return { ok: false, error: error.message }

  await supabase.from('credit_transactions').insert({
    user_id: userId,
    amount: delta,
    reason: 'admin_adjustment',
  })

  return { ok: true }
}
