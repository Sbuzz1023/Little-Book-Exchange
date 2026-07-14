'use server'

import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from './libraryLocations'

export async function submitReview(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please sign in.' }

  const conversationId = formData.get('conversation_id') as string
  const sellerId = formData.get('seller_id') as string
  const rating = Number(formData.get('rating'))
  const text = ((formData.get('text') as string) || '').trim() || null

  const { error } = await supabase.from('reviews').insert({
    conversation_id: conversationId,
    seller_id: sellerId,
    reviewer_id: user.id,
    rating,
    text,
  })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function adminUpdateReview(id: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const { error } = await supabase.from('reviews').update({ text, flagged: false }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function adminDeleteReview(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const { error } = await supabase.from('reviews').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
