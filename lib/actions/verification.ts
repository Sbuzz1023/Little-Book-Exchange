'use server'

import { createClient } from '@/lib/supabase/server'
import { toE164 } from './toE164'

export async function resendEmailConfirmation(): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { ok: false, error: 'Please sign in.' }

  const { error } = await supabase.auth.resend({ type: 'signup', email: user.email })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function sendPhoneOtp(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please sign in.' }

  const phone = formData.get('phone') as string
  if (!phone) return { ok: false, error: 'Enter a phone number.' }

  const { error } = await supabase.auth.updateUser({ phone: toE164(phone) })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function verifyPhoneOtp(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please sign in.' }

  const phone = formData.get('phone') as string
  const token = formData.get('token') as string
  if (!phone || !token) return { ok: false, error: 'Enter the code you received.' }

  const { error } = await supabase.auth.verifyOtp({ phone: toE164(phone), token, type: 'phone_change' })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
