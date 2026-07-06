import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import DashboardClient from './DashboardClient'
import { MOCK_PROFILE, MOCK_LISTINGS, MOCK_USER_ID, MOCK_CONVERSATIONS } from '@/lib/mock-data'
import { updateProfile, updateListingStatus, notifyPickedUp } from './actions'

function isDemo() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http')) return true
  return !!cookies().get('lbe_demo_user')
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: { success?: string; error?: string }
}) {
  let profile: any = null
  let listings: any[] = []
  let exchanges: any[] = []

  if (isDemo()) {
    profile = MOCK_PROFILE
    listings = MOCK_LISTINGS.filter(l => l.user_id === MOCK_USER_ID)
    exchanges = MOCK_CONVERSATIONS
  } else {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) redirect('/auth/signin?redirect=/profile')

      const [{ data: p }, { data: l }, { data: c }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('listings').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
        supabase.from('conversations')
          .select('*, listings(title, author, photo_url, city, state), buyer:profiles!buyer_id(username, name, city, state), seller:profiles!seller_id(username, name, city, state)')
          .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
          .order('created_at', { ascending: false }),
      ])
      profile = p
      listings = l ?? []
      exchanges = c ?? []
    } catch {
      profile = MOCK_PROFILE
      listings = MOCK_LISTINGS.filter(l => l.user_id === MOCK_USER_ID)
      exchanges = MOCK_CONVERSATIONS
    }
  }

  return (
    <DashboardClient
      profile={profile}
      listings={listings}
      exchanges={exchanges}
      updateAction={updateProfile}
      updateListingStatus={updateListingStatus}
      notifyPickedUp={notifyPickedUp}
      success={!!searchParams.success}
    />
  )
}
