'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { buildConfirmationMessage } from '@/lib/buildConfirmationMessage'
import { isValidStateCode } from '@/lib/usStates'

export async function updateProfile(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const { data: currentProfile } = await supabase
    .from('profiles')
    .select('phone_verified')
    .eq('id', user!.id)
    .single()
  const phoneVerified = !!currentProfile?.phone_verified

  const rawState = (formData.get('state') as string) ?? ''
  const state = isValidStateCode(rawState) ? rawState : ''
  const username = ((formData.get('username') as string) || '').replace(/\s+/g, '')

  if (!username) {
    redirect(`/profile?tab=account&error=${encodeURIComponent('Please enter a username.')}`)
  }

  const updatePayload: Record<string, unknown> = {
    username,
    city:               formData.get('city')                as string,
    state,
    address:            (formData.get('address')            as string) || '',
    address_unit:       (formData.get('address_unit')       as string) || '',
    zip:                (formData.get('zip')                as string) || '',
    pickup_description: (formData.get('pickup_description') as string) || '',
    notify_message:          formData.get('notify_message')          === 'true',
    notify_purchase_request: formData.get('notify_purchase_request') === 'true',
    notify_purchase_decision: formData.get('notify_purchase_decision') === 'true',
    notify_tbr_match:        formData.get('notify_tbr_match')        === 'true',
    notify_pickup:           formData.get('notify_pickup')           === 'true',
    // The UI presents this as an opt-IN toggle ("Announcement emails: ON"),
    // while the column stores the opposite (marketing_opt_out). Invert here —
    // this is the only self-serve way to undo a one-click unsubscribe.
    marketing_opt_out:       formData.get('marketing_emails')        !== 'true',
  }

  // Once a phone number is verified, only the verification flow itself may
  // change profiles.phone — readOnly in the UI is not a security boundary
  // by itself, since a crafted POST could still submit a different value.
  if (!phoneVerified) {
    updatePayload.phone = formData.get('phone') as string
  }

  const { error } = await supabase.from('profiles').update(updatePayload).eq('id', user!.id)

  if (error) {
    const message = error.code === '23505'
      ? 'That username is already taken — try another.'
      : 'Something went wrong saving your changes. Please try again.'
    redirect(`/profile?tab=account&error=${encodeURIComponent(message)}`)
  }

  redirect('/profile?tab=account&success=1')
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

export async function markPickedUp(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')
  const conversationId = formData.get('conversation_id') as string

  const { data: convo } = await supabase
    .from('conversations')
    .select('buyer_id, seller_id')
    .eq('id', conversationId)
    .single()

  const isSeller = convo?.seller_id === user.id
  const isBuyer = convo?.buyer_id === user.id
  if (!convo || (!isSeller && !isBuyer)) redirect('/profile?tab=exchanges')

  const column = isSeller ? 'seller_picked_up_at' : 'buyer_picked_up_at'

  // is(column, null) guards against a double-click re-firing the message
  // below for a party who already confirmed once.
  const { data: updated } = await supabase
    .from('conversations')
    .update({ [column]: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('exchange_status', 'confirmed')
    .is(column, null)
    .select('id')
    .maybeSingle()

  if (updated) {
    const { data: result } = await supabase.rpc('resolve_pickup', {
      p_conversation_id: conversationId,
      p_actor_id: user.id,
    })

    if (result === 'waiting') {
      const { data: profile } = await supabase.from('profiles').select('username').eq('id', user.id).single()
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_id: user.id,
        body: `📦 ${profile?.username ?? 'They'} marked this picked up! Please confirm on your end within 48 hours.`,
        kind: 'pickup',
      })
    }
  }

  redirect('/profile?tab=exchanges')
}

export async function fileDispute(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please sign in.' }

  const conversationId = formData.get('conversation_id') as string
  const message = ((formData.get('message') as string) || '').trim()
  if (!message) return { ok: false, error: 'Please describe the issue.' }

  const { data: convo } = await supabase
    .from('conversations')
    .select('buyer_id, seller_id, listing_id')
    .eq('id', conversationId)
    .single()
  if (!convo || (convo.buyer_id !== user.id && convo.seller_id !== user.id)) {
    return { ok: false, error: 'Exchange not found.' }
  }

  const { error } = await supabase.from('disputes').insert({
    conversation_id: conversationId,
    reporter_id: user.id,
    message,
  })
  if (error) return { ok: false, error: 'Could not file the dispute. Please try again.' }

  // Best-effort admin alert — the dispute row inserted above is what actually
  // freezes the exchange; a failed email here doesn't undo that.
  try {
    const { data: listing } = await supabase.from('listings').select('title').eq('id', convo.listing_id).single()
    const { data: admins } = await supabase.from('profiles').select('email').eq('is_admin', true)
    const { sendEmail } = await import('@/lib/email/resend')
    for (const admin of admins ?? []) {
      if (admin.email) {
        await sendEmail({
          to: admin.email,
          subject: `Dispute filed: ${listing?.title ?? 'an exchange'}`,
          text: `A dispute was filed on an exchange.\n\nMessage:\n${message}\n\nConversation ID: ${conversationId}`,
        })
      }
    }
  } catch {}

  return { ok: true }
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
  // These come from the seller's confirm-and-review popup — a one-time
  // override for this exchange only. Address/pickup are stored on the
  // conversation itself (not written back to profiles/listings) so the
  // confirmation message and the buyer's "Ready for Pick Up" summary always
  // agree. City/state have no equivalent summary to stay in sync with, so
  // they only flow into the message below.
  const address     = ((formData.get('address') as string) || '').trim()
  const addressUnit = ((formData.get('address_unit') as string) || '').trim()
  const rawState    = (formData.get('state') as string) || ''
  const city        = ((formData.get('city') as string) || '').trim()
  const state       = isValidStateCode(rawState) ? rawState : ''
  const pickup      = ((formData.get('pickup') as string) || '').trim()

  await supabase.from('conversations')
    .update({
      exchange_status: 'confirmed',
      confirmed_address: address || null,
      confirmed_address_unit: addressUnit || null,
      confirmed_pickup: pickup || null,
    })
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
    .select('username')
    .eq('id', user.id)
    .single()

  const { data: convo } = await supabase
    .from('conversations')
    .select('listing_id')
    .eq('id', conversationId)
    .single()
  if (convo?.listing_id) {
    await supabase
      .from('listings')
      .update({ status: 'sold' })
      .eq('id', convo.listing_id)
      .eq('status', 'pending')
  }

  if (profile) {
    const body = buildConfirmationMessage({
      username: profile.username,
      city,
      state,
      address,
      address_unit: addressUnit,
      pickup,
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

export async function startSupportConversation(): Promise<{ ok: boolean; conversationId?: string; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please sign in.' }

  const { data: existing, error: lookupError } = await supabase
    .from('conversations')
    .select('id')
    .eq('type', 'admin')
    .eq('user_id', user.id)
    .eq('repliable', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lookupError) return { ok: false, error: 'Could not start a support conversation. Please try again.' }
  if (existing) return { ok: true, conversationId: existing.id }

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({ type: 'admin', user_id: user.id, repliable: true })
    .select('id')
    .single()

  if (error || !created) return { ok: false, error: 'Could not start a support conversation. Please try again.' }
  return { ok: true, conversationId: created.id }
}
