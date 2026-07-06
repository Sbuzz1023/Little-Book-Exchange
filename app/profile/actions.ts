'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function updateProfile(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')
  await supabase.from('profiles').update({
    city:  formData.get('city')  as string,
    state: formData.get('state') as string,
    phone: formData.get('phone') as string,
  }).eq('id', user!.id)
  redirect('/profile?success=1')
}

export async function updateListingStatus(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')
  const id = formData.get('id') as string
  const status = formData.get('status') as string
  if (status === 'delete') {
    await supabase.from('listings').delete().eq('id', id).eq('user_id', user!.id)
  } else {
    await supabase.from('listings').update({ status }).eq('id', id).eq('user_id', user!.id)
  }
  redirect('/profile')
}

export async function notifyPickedUp(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')
  const conversationId = formData.get('conversation_id') as string
  await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender_id: user.id,
    body: '📚 Book picked up! Thanks so much!',
  })
  redirect('/profile?tab=exchanges')
}
