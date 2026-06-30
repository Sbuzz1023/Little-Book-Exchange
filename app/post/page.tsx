import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import PostForm from './PostForm'
import { MOCK_PROFILE } from '@/lib/mock-data'
import { createListing } from './actions'

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

  return (
    <div className="max-w-[600px] mx-auto px-4 py-6 md:px-8 md:py-10">
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
