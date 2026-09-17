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
    <div className="home-v2">
      <div className="wrap" style={{ maxWidth: 680 }}>
        <div className="pf-page-head">
          <h1>Post a Book</h1>
          <p className="sub">
            Share a book with your neighbors in <b style={{ color: 'var(--ink)' }}>{profile?.city ?? 'your city'}</b>
          </p>
        </div>
        <PostForm
          city={profile?.city}
          action={createListing}
          error={searchParams.error ? decodeURIComponent(searchParams.error) : undefined}
        />
      </div>
    </div>
  )
}
