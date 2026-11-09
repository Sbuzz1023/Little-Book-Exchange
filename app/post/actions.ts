'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { validateOpenLibraryMatch } from '@/lib/parseListingForm'
import { buildListingPayload, listingErrorMessage } from '@/lib/listingPayload'

async function uploadPhoto(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  formData: FormData,
  fieldName: string,
  slot: number,
): Promise<string | null> {
  const file = formData.get(fieldName) as File
  if (!file || file.size === 0) return null
  const ext = file.name.split('.').pop()
  const path = `${userId}/${Date.now()}-${slot}.${ext}`
  const { data: upload, error: uploadError } = await supabase.storage.from('book-photos').upload(path, file)
  if (uploadError) { console.error(`Upload error (${fieldName}):`, uploadError); return null }
  if (!upload) return null
  const { data: { publicUrl } } = supabase.storage.from('book-photos').getPublicUrl(path)
  return publicUrl
}

export async function createListing(formData: FormData) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/auth/signin')

    // Validate before uploading, so a refused post doesn't leave orphan photos.
    const draft = buildListingPayload(formData, { photo_url: null, photo_url_2: null, photo_url_3: null })
    const matchError = validateOpenLibraryMatch(draft.listing, draft.books)
    if (matchError) redirect(`/post?error=${encodeURIComponent(matchError)}`)

    const [photo_url, photo_url_2, photo_url_3] = await Promise.all([
      uploadPhoto(supabase, user!.id, formData, 'photo', 1),
      uploadPhoto(supabase, user!.id, formData, 'photo_2', 2),
      uploadPhoto(supabase, user!.id, formData, 'photo_3', 3),
    ])
    const { listing, books } = buildListingPayload(formData, { photo_url, photo_url_2, photo_url_3 })

    const { data, error } = await supabase.rpc('create_listing', { p_listing: listing, p_books: books })
    const result = data as { status: string; id?: string } | null
    if (error || !result) redirect(`/post?error=${encodeURIComponent(error?.message || 'Failed to post listing')}`)
    if (result!.status !== 'ok' || !result!.id) redirect(`/post?error=${encodeURIComponent(listingErrorMessage(result!.status))}`)

    redirect(`/listings/${result!.id}`)
  } catch (err: any) {
    if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
    const msg = err?.message || String(err) || 'Unknown error'
    console.error('createListing error:', err)
    redirect(`/post?error=${encodeURIComponent(msg)}`)
  }
}

export async function updateListing(listingId: string, formData: FormData) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/auth/signin')

    // Early exit before uploading photos; update_listing re-checks both.
    const { data: existing } = await supabase
      .from('listings').select('status')
      .eq('id', listingId).eq('user_id', user.id).single()
    if (!existing) redirect('/profile?tab=listings')
    if (existing.status === 'pending') {
      redirect(`/listings/${listingId}/edit?error=${encodeURIComponent(listingErrorMessage('pending_request'))}`)
    }

    const draft = buildListingPayload(formData, { photo_url: null, photo_url_2: null, photo_url_3: null })
    const matchError = validateOpenLibraryMatch(draft.listing, draft.books)
    if (matchError) redirect(`/listings/${listingId}/edit?error=${encodeURIComponent(matchError)}`)

    const [photo_url, photo_url_2, photo_url_3] = await Promise.all([
      uploadPhoto(supabase, user.id, formData, 'photo', 1),
      uploadPhoto(supabase, user.id, formData, 'photo_2', 2),
      uploadPhoto(supabase, user.id, formData, 'photo_3', 3),
    ])
    // A null photo keeps the one already on the listing (update_listing).
    const { listing, books } = buildListingPayload(formData, { photo_url, photo_url_2, photo_url_3 })

    const { data: status, error } = await supabase.rpc('update_listing', { p_listing_id: listingId, p_listing: listing, p_books: books })
    if (error) redirect(`/listings/${listingId}/edit?error=${encodeURIComponent(error.message)}`)
    if (status !== 'ok') redirect(`/listings/${listingId}/edit?error=${encodeURIComponent(listingErrorMessage(String(status)))}`)

    redirect('/profile?tab=listings')
  } catch (err: any) {
    if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
    const msg = err?.message || String(err) || 'Unknown error'
    console.error('updateListing error:', err)
    redirect(`/listings/${listingId}/edit?error=${encodeURIComponent(msg)}`)
  }
}
