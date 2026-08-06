'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { parseListingForm, parseBundleBooks } from '@/lib/parseListingForm'

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

    const { data: prof } = await supabase.from('profiles').select('city').eq('id', user!.id).single()

    const [photo_url, photo_url_2, photo_url_3] = await Promise.all([
      uploadPhoto(supabase, user!.id, formData, 'photo', 1),
      uploadPhoto(supabase, user!.id, formData, 'photo_2', 2),
      uploadPhoto(supabase, user!.id, formData, 'photo_3', 3),
    ])

    const fields = parseListingForm(formData)
    const isBundle = formData.get('is_bundle') === 'true'
    const bundleBooks = isBundle ? parseBundleBooks(formData) : []
    const bundleName = (formData.get('bundle_name') as string)?.trim() || null

    const { data: listing, error } = await supabase.from('listings').insert({
      user_id: user!.id,
      ...fields,
      photo_url,
      photo_url_2,
      photo_url_3,
      city: prof?.city ?? '',
      is_bundle: isBundle && bundleBooks.length > 0,
      bundle_name: isBundle && bundleBooks.length > 0 ? bundleName : null,
    }).select('id').single()

    if (error) redirect(`/post?error=${encodeURIComponent(error.message || 'Failed to post listing')}`)
    if (!listing) redirect('/post?error=No+listing+returned')

    if (isBundle && bundleBooks.length > 0) {
      const { error: booksError } = await supabase.from('listing_books').insert(
        bundleBooks.map((b, i) => ({ listing_id: listing!.id, title: b.title, author: b.author, position: i }))
      )
      if (booksError) console.error('Failed to insert bundle books:', booksError)
    }

    redirect(`/listings/${listing!.id}`)
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

    const { data: existing } = await supabase
      .from('listings').select('photo_url, photo_url_2, photo_url_3')
      .eq('id', listingId).eq('user_id', user.id).single()
    if (!existing) redirect('/profile?tab=listings')

    const [photo_url, photo_url_2, photo_url_3] = await Promise.all([
      uploadPhoto(supabase, user.id, formData, 'photo', 1),
      uploadPhoto(supabase, user.id, formData, 'photo_2', 2),
      uploadPhoto(supabase, user.id, formData, 'photo_3', 3),
    ])

    const fields = parseListingForm(formData)

    const { error } = await supabase.from('listings').update({
      ...fields,
      photo_url:   photo_url   ?? existing.photo_url,
      photo_url_2: photo_url_2 ?? existing.photo_url_2,
      photo_url_3: photo_url_3 ?? existing.photo_url_3,
    }).eq('id', listingId).eq('user_id', user.id)

    if (error) redirect(`/listings/${listingId}/edit?error=${encodeURIComponent(error.message)}`)
    redirect('/profile?tab=listings')
  } catch (err: any) {
    if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
    const msg = err?.message || String(err) || 'Unknown error'
    console.error('updateListing error:', err)
    redirect(`/listings/${listingId}/edit?error=${encodeURIComponent(msg)}`)
  }
}
