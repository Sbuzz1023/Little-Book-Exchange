'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

const DESCRIPTION_MAX_LENGTH = 500

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

    const priceRaw = formData.get('price') as string
    const price = priceRaw && priceRaw.trim() !== '' ? parseFloat(priceRaw) : null

    const { data: listing, error } = await supabase.from('listings').insert({
      user_id: user!.id,
      title:       formData.get('title')       as string,
      author:      formData.get('author')      as string,
      condition:   formData.get('condition')   as string,
      price,
      description: ((formData.get('description') as string) || '').slice(0, DESCRIPTION_MAX_LENGTH) || null,
      genre:       (formData.get('genre')       as string) || null,
      format:      (formData.get('format')      as string) || null,
      photo_url,
      photo_url_2,
      photo_url_3,
      city: prof?.city ?? '',
      pickup_description: (formData.get('pickup_description') as string) || null,
    }).select('id').single()

    if (error) redirect(`/post?error=${encodeURIComponent(error.message || 'Failed to post listing')}`)
    if (!listing) redirect('/post?error=No+listing+returned')
    redirect(`/listings/${listing!.id}`)
  } catch (err: any) {
    if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
    const msg = err?.message || String(err) || 'Unknown error'
    console.error('createListing error:', err)
    redirect(`/post?error=${encodeURIComponent(msg)}`)
  }
}
