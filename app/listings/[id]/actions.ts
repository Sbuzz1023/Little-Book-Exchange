'use server'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { MOCK_CONVERSATIONS } from '@/lib/mock-data'

function isDemo(): boolean {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http') || !!cookies().get('lbe_demo_user')
}

export async function startConversationAction(listingId: string): Promise<void> {
  if (isDemo()) {
    const mock = MOCK_CONVERSATIONS.find(c => c.listing_id === listingId)
    revalidatePath('/profile')
    redirect(`/profile?tab=messages&conversation=${mock?.id ?? 'mock-convo-1'}`)
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/auth/signin?redirect=/listings/${listingId}`)

  const { data } = await supabase.rpc('start_conversation', { p_listing_id: listingId })
  const result = data as { status: string; id?: string } | null
  if (result?.status !== 'ok' || !result.id) redirect(`/listings/${listingId}`)

  revalidatePath('/profile')
  redirect(`/profile?tab=messages&conversation=${result!.id}`)
}

export async function requestBookAction(listingId: string): Promise<void> {
  if (isDemo()) {
    cookies().set('lbe_demo_pending', listingId, { maxAge: 86400, path: '/', sameSite: 'lax' })
    redirect(`/listings/${listingId}?requested=1`)
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/auth/signin?redirect=/listings/${listingId}`)

  const { data } = await supabase.rpc('request_book', { p_listing_id: listingId })
  const status = (data as { status?: string } | null)?.status
  if (status === 'ok') redirect(`/listings/${listingId}?requested=1`)
  if (status === 'insufficient_credits') redirect(`/listings/${listingId}?insufficient_credits=1`)
  redirect(`/listings/${listingId}?purchase_failed=1`)
}
