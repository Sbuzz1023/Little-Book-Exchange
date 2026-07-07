'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { buildConfirmationMessage } from '@/lib/buildConfirmationMessage'

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

export async function cancelPurchase(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const conversationId = formData.get('conversation_id') as string

  // Only allowed while still pending — not after seller confirms
  await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId)
    .eq('buyer_id', user.id)
    .in('exchange_status', ['requested', 'none'])

  redirect('/profile')
}

export async function confirmExchange(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const conversationId = formData.get('conversation_id') as string

  await supabase.from('conversations')
    .update({ exchange_status: 'confirmed' })
    .eq('id', conversationId)
    .eq('seller_id', user.id)

  const { data: profile } = await supabase
    .from('profiles')
    .select('username, city, state, phone, address, address_unit, share_address, pickup_description, share_pickup')
    .eq('id', user.id)
    .single()

  let listingPickup: string | null = null
  const { data: convo } = await supabase
    .from('conversations')
    .select('listing_id')
    .eq('id', conversationId)
    .single()
  if (convo?.listing_id) {
    const { data: listing } = await supabase
      .from('listings')
      .select('pickup_description')
      .eq('id', convo.listing_id)
      .single()
    listingPickup = listing?.pickup_description ?? null
  }

  if (profile) {
    const body = buildConfirmationMessage({
      username:       profile.username,
      city:           profile.city,
      state:          profile.state,
      phone:          profile.phone,
      address:        profile.address,
      address_unit:   profile.address_unit,
      share_address:  profile.share_address,
      listing_pickup: listingPickup,
      profile_pickup: profile.pickup_description,
      share_pickup:   profile.share_pickup,
    })
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body,
    })
  }

  redirect('/profile')
}
