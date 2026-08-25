'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

export async function saveListing(listingId: string, redirectTo: string): Promise<void> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin?redirect=' + redirectTo)

  await supabase
    .from('saved_listings')
    .upsert({ user_id: user.id, listing_id: listingId }, { onConflict: 'user_id,listing_id', ignoreDuplicates: true })

  revalidatePath(redirectTo)
  revalidatePath('/profile')
}

export async function unsaveListing(listingId: string, redirectTo: string): Promise<void> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin?redirect=' + redirectTo)

  await supabase
    .from('saved_listings')
    .delete()
    .eq('user_id', user.id)
    .eq('listing_id', listingId)

  revalidatePath(redirectTo)
  revalidatePath('/profile')
}

export async function removeSavedListing(formData: FormData): Promise<void> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const listingId = formData.get('listing_id') as string

  await supabase
    .from('saved_listings')
    .delete()
    .eq('user_id', user.id)
    .eq('listing_id', listingId)

  redirect('/profile')
}

// For a saved listing that's sold — copies its title/author/city into a new
// To Be Read wishlist entry, then removes it from Saved. Only removes the
// saved listing once the TBR entry is actually confirmed added; on any
// failure it's left in place rather than silently lost, so the worst case is
// "click the button again," not "the book is just gone."
export async function moveSavedListingToTbr(formData: FormData): Promise<void> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const listingId = formData.get('listing_id') as string

  const { data: listing } = await supabase
    .from('listings')
    .select('title, author, city')
    .eq('id', listingId)
    .single()
  if (!listing) redirect('/profile')

  const { error: insertError } = await supabase.from('tbr_entries').insert({
    user_id: user.id,
    title: listing.title,
    author: listing.author,
    city: listing.city || '',
    state: '',
  })
  if (insertError) redirect('/profile')

  await supabase
    .from('saved_listings')
    .delete()
    .eq('user_id', user.id)
    .eq('listing_id', listingId)

  redirect('/profile')
}
