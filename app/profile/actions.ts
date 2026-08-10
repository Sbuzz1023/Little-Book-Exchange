'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { buildConfirmationMessage } from '@/lib/buildConfirmationMessage'
import { isValidStateCode } from '@/lib/usStates'

export async function updateProfile(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')
  const rawState = (formData.get('state') as string) ?? ''
  const state = isValidStateCode(rawState) ? rawState : ''
  await supabase.from('profiles').update({
    city:               formData.get('city')                as string,
    state,
    phone:              formData.get('phone')               as string,
    address:            (formData.get('address')            as string) || '',
    address_unit:       (formData.get('address_unit')       as string) || '',
    zip:                (formData.get('zip')                as string) || '',
    share_address:      formData.get('share_address')       === 'true',
    pickup_description: (formData.get('pickup_description') as string) || '',
    share_pickup:       formData.get('share_pickup')        === 'true',
    notify_message:          formData.get('notify_message')          === 'true',
    notify_purchase_request: formData.get('notify_purchase_request') === 'true',
    notify_purchase_decision: formData.get('notify_purchase_decision') === 'true',
    notify_tbr_match:        formData.get('notify_tbr_match')        === 'true',
    notify_pickup:           formData.get('notify_pickup')           === 'true',
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

export async function completeExchange(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')
  const conversationId = formData.get('conversation_id') as string

  await supabase.from('conversations')
    .update({ exchange_status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('exchange_status', 'confirmed')
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)

  await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender_id: user.id,
    body: '📚 Book picked up! Thanks so much!',
    kind: 'pickup',
  })

  redirect('/profile?tab=exchanges')
}

export async function hideExchangeHistory(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')
  const conversationId = formData.get('conversation_id') as string
  const role = formData.get('role') as 'buyer' | 'seller'

  await supabase.from('conversations')
    .update(role === 'seller' ? { seller_hidden: true } : { buyer_hidden: true })
    .eq('id', conversationId)
    .eq(role === 'seller' ? 'seller_id' : 'buyer_id', user.id)

  redirect('/profile?tab=exchanges')
}

export async function cancelPurchase(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const conversationId = formData.get('conversation_id') as string

  const { data: convo } = await supabase
    .from('conversations')
    .select('listing_id, exchange_status')
    .eq('id', conversationId)
    .eq('buyer_id', user.id)
    .maybeSingle()

  if (convo?.listing_id && convo.exchange_status === 'requested') {
    await supabase.rpc('reopen_listing', { p_listing_id: convo.listing_id })
  }

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

  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', user.id)
    .eq('entity_id', conversationId)
    .eq('type', 'purchase_request')

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

    await supabase
      .from('listings')
      .update({ status: 'sold' })
      .eq('id', convo.listing_id)
      .eq('status', 'pending')
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
      kind: 'confirmation',
    })
  }

  redirect('/profile')
}

export async function denyPurchase(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const conversationId = formData.get('conversation_id') as string

  const { data: convo } = await supabase
    .from('conversations')
    .select('listing_id, buyer_id, exchange_status')
    .eq('id', conversationId)
    .eq('seller_id', user.id)
    .eq('exchange_status', 'requested')
    .maybeSingle()

  if (convo?.buyer_id) {
    try {
      await supabase.rpc('create_notification', {
        p_user_id: convo.buyer_id,
        p_type: 'purchase_decision',
        p_entity_id: conversationId,
      })
    } catch {}
  }

  await supabase
    .from('conversations')
    .update({ exchange_status: 'declined', completed_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('seller_id', user.id)
    .eq('exchange_status', 'requested')

  if (convo?.listing_id) {
    await supabase
      .from('listings')
      .update({ status: 'active' })
      .eq('id', convo.listing_id)
      .eq('status', 'pending')
  }

  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', user.id)
    .eq('entity_id', conversationId)
    .eq('type', 'purchase_request')

  redirect('/profile')
}
