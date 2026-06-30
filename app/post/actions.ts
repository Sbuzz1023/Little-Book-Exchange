'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function createListing(formData: FormData) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/auth/signin')

    const { data: prof } = await supabase.from('profiles').select('city').eq('id', user!.id).single()

    let photo_url: string | null = null
    const file = formData.get('photo') as File
    console.log('Photo file:', file?.name, 'size:', file?.size, 'type:', file?.type)
    if (file && file.size > 0) {
      const ext = file.name.split('.').pop()
      const path = `${user!.id}/${Date.now()}.${ext}`
      const { data: upload, error: uploadError } = await supabase.storage.from('book-photos').upload(path, file)
      console.log('Upload result:', upload, 'error:', uploadError)
      if (upload) {
        const { data: { publicUrl } } = supabase.storage.from('book-photos').getPublicUrl(path)
        photo_url = publicUrl
      }
    }

    const priceRaw = formData.get('price') as string
    const price = priceRaw && priceRaw.trim() !== '' ? parseFloat(priceRaw) : null

    const { data: listing, error } = await supabase.from('listings').insert({
      user_id: user!.id,
      title:       formData.get('title')       as string,
      author:      formData.get('author')      as string,
      condition:   formData.get('condition')   as string,
      price,
      description: (formData.get('description') as string) || null,
      genre:       (formData.get('genre')       as string) || null,
      format:      (formData.get('format')      as string) || null,
      photo_url,
      city: prof?.city ?? '',
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
