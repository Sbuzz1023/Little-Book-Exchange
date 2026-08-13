'use server'

import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribeToken'

export async function unsubscribeFromMarketing(userId: string, token: string): Promise<{ ok: boolean; error?: string }> {
  if (!verifyUnsubscribeToken(userId, token)) return { ok: false, error: 'Invalid or expired link.' }

  const supabase = createServiceRoleClient()
  const { error } = await supabase.from('profiles').update({ marketing_opt_out: true }).eq('id', userId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
