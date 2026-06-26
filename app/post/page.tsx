import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import PostForm from './PostForm'
import { MOCK_PROFILE } from '@/lib/mock-data'

export default async function PostPage({
  searchParams,
}: {
  searchParams: { error?: string }
}) {
  let profile: { city: string } | null = null
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/auth/signin?redirect=/post')
    const { data } = await supabase.from('profiles').select('city').eq('id', user.id).single()
    profile = data
  } catch {
    profile = { city: MOCK_PROFILE.city }
  }

  async function createListing(formData: FormData) {
    'use server'
    const { redirect: redir } = await import('next/navigation')
    try {
      const { createClient: createSrv } = await import('@/lib/supabase/server')
      const supabase = createSrv()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) redir('/auth/signin')

      const { data: prof } = await supabase.from('profiles').select('city').eq('id', user!.id).single()

      let photo_url: string | null = null
      const file = formData.get('photo') as File
      if (file && file.size > 0) {
        const ext = file.name.split('.').pop()
        const path = `${user!.id}/${Date.now()}.${ext}`
        const { data: upload } = await supabase.storage.from('book-photos').upload(path, file)
        if (upload) {
          const { data: { publicUrl } } = supabase.storage.from('book-photos').getPublicUrl(path)
          photo_url = publicUrl
        }
      }

      const priceRaw = formData.get('price') as string
      const price = priceRaw && priceRaw.trim() !== '' ? parseFloat(priceRaw) : null

      const { data: listing, error } = await supabase.from('listings').insert({
        user_id: user!.id,
        title: formData.get('title') as string,
        author: formData.get('author') as string,
        condition: formData.get('condition') as string,
        price,
        description: (formData.get('description') as string) || null,
        genre: (formData.get('genre') as string) || null,
        format: (formData.get('format') as string) || null,
        photo_url,
        city: prof?.city ?? '',
      }).select('id').single()

      if (error || !listing) redir('/post?error=Failed to post listing')
      redir(`/listings/${listing!.id}`)
    } catch (err: any) {
      if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
      // Supabase not connected — redirect to mock listing as demo success
      redir('/listings/mock-1?demo=posted')
    }
  }

  return (
    <div className="max-w-[600px] mx-auto px-8 py-10">
      <h1 className="font-display text-[30px] text-bk-orange mb-1">Post a Book</h1>
      <p className="font-bold text-[14px] mb-7" style={{ color: '#aaa' }}>
        Share a book with your neighbors in{' '}
        <strong style={{ color: '#2d2d2d' }}>{profile?.city ?? 'your city'}</strong>
      </p>
      <PostForm
        city={profile?.city}
        action={createListing}
        error={searchParams.error ? decodeURIComponent(searchParams.error) : undefined}
      />
    </div>
  )
}
