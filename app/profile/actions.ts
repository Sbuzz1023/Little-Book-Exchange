'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { MOCK_CONVERSATIONS, MOCK_LISTINGS, MOCK_USER_ID } from '@/lib/mock-data'
import { isValidStateCode } from '@/lib/usStates'
import { normalizeCity } from '@/lib/normalizeCity'
import { notifyAdminsOfDispute } from '@/lib/disputes/notifyAdmins'

export async function updateProfile(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const { data: currentProfile } = await supabase
    .rpc('get_my_profile')
    .maybeSingle<{ phone_verified: boolean }>()
  const phoneVerified = !!currentProfile?.phone_verified

  const rawState = (formData.get('state') as string) ?? ''
  const state = isValidStateCode(rawState) ? rawState : ''
  const username = ((formData.get('username') as string) || '').replace(/\s+/g, '')

  if (!username) {
    redirect(`/profile?tab=account&error=${encodeURIComponent('Please enter a username.')}`)
  }

  const updatePayload: Record<string, unknown> = {
    username,
    city:               normalizeCity((formData.get('city') as string) ?? ''),
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
    await supabase.rpc('delete_listing', { p_listing_id: id })
  } else {
    await supabase.rpc('set_listing_status', { p_listing_id: id, p_status: status })
  }
  redirect('/profile')
}

export async function markPickedUp(formData: FormData) {
  // Demo server: there's no database, so instead of crashing play the coin
  // show the real pickup would trigger — coin in for the seller, out for the
  // buyer. coin_demo_at makes each press a new show (see HomeNav).
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http')) {
    const id = formData.get('conversation_id') as string
    const convo = MOCK_CONVERSATIONS.find(c => c.id === id)
    const listingId = convo?.listing_id ?? id.replace(/^demo-pending-/, '')
    const params = new URLSearchParams({
      tab: 'exchanges',
      coin_demo: convo?.seller_id === MOCK_USER_ID ? 'earn' : 'spend',
      coin_demo_at: String(Date.now()),
    })
    const title = MOCK_LISTINGS.find(l => l.id === listingId)?.title
    if (title) params.set('coin_demo_title', title)
    redirect(`/profile?${params}`)
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')
  const conversationId = formData.get('conversation_id') as string
  const { data: result } = await supabase.rpc('mark_picked_up', { p_conversation_id: conversationId })

  // Completing moves credits; the root layout reads them (and the unseen
  // ones the nav's coin show plays), and a redirect alone doesn't
  // re-render that layout.
  if (typeof result === 'string' && result.startsWith('completed_')) revalidatePath('/', 'layout')

  redirect('/profile?tab=exchanges')
}

export async function fileDispute(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please sign in.' }

  const conversationId = formData.get('conversation_id') as string
  const message = ((formData.get('message') as string) || '').trim()
  if (!message) return { ok: false, error: 'Please describe the issue.' }

  const { data, error } = await supabase.rpc('file_dispute', { p_conversation_id: conversationId, p_message: message })
  const result = data as { status: string; id?: string } | null
  if (error || !result) return { ok: false, error: 'Could not file the dispute. Please try again.' }
  if (result.status === 'not_allowed') return { ok: false, error: 'Exchange not found.' }
  if (result.status === 'already_open') return { ok: false, error: 'A dispute is already open for this exchange.' }
  if (result.status !== 'ok' || !result.id) return { ok: false, error: 'Could not file the dispute. Please try again.' }

  // Best-effort admin alert — the dispute row is what actually freezes the exchange.
  try { await notifyAdminsOfDispute(result.id) } catch {}

  return { ok: true }
}

export async function hideExchangeHistory(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')
  const conversationId = formData.get('conversation_id') as string
  await supabase.rpc('hide_exchange', { p_conversation_id: conversationId })

  redirect('/profile?tab=exchanges')
}

export async function cancelPurchase(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const conversationId = formData.get('conversation_id') as string

  await supabase.rpc('cancel_request', { p_conversation_id: conversationId })

  redirect('/profile?tab=exchanges')
}

export async function confirmExchange(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const conversationId = formData.get('conversation_id') as string
  const text = (key: string) => ((formData.get(key) as string) || '').trim()
  const rawState = text('state')

  // These come from the seller's confirm-and-review popup — a one-time
  // override for this exchange only. confirm_exchange (supabase/schema.sql,
  // shared backend 4/6) validates the pickup time, stores it, marks the
  // listing sold and posts the confirmation message.
  await supabase.rpc('confirm_exchange', {
    p_conversation_id: conversationId,
    p_pickup: {
      address: text('address'),
      address_unit: text('address_unit'),
      city: text('city'),
      state: isValidStateCode(rawState) ? rawState : '',
      pickup: text('pickup'),
      pickup_mode: text('pickup_mode'),
      pickup_date: text('pickup_date'),
      pickup_time_start: text('pickup_time_start'),
      pickup_time_end: text('pickup_time_end'),
    },
  })

  redirect('/profile?tab=exchanges')
}

export async function denyPurchase(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const conversationId = formData.get('conversation_id') as string

  await supabase.rpc('deny_request', { p_conversation_id: conversationId })

  redirect('/profile?tab=exchanges')
}

export async function startSupportConversation(): Promise<{ ok: boolean; conversationId?: string; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please sign in.' }

  const { data, error } = await supabase.rpc('start_support_conversation')
  const result = data as { status: string; id?: string } | null
  if (error || result?.status !== 'ok' || !result.id) {
    return { ok: false, error: 'Could not start a support conversation. Please try again.' }
  }
  return { ok: true, conversationId: result.id }
}

// Used by the "Message Support" link on the homepage, which — unlike ProfileCard's
// button — isn't already mounted inside DashboardClient's tab UI, so it can't just
// flip local state. Finds/creates the conversation the same way, then deep-links into
// the Messages tab via the existing tab/conversation search params (app/profile/page.tsx).
export async function startSupportConversationAndRedirect() {
  const result = await startSupportConversation()
  if (result.ok && result.conversationId) {
    redirect(`/profile?tab=messages&conversation=${result.conversationId}`)
  }
  redirect('/auth/signin?redirect=%2Fprofile%3Ftab%3Dmessages')
}
