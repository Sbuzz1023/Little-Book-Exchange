import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import DashboardClient from './DashboardClient'
import { MOCK_PROFILE, MOCK_LISTINGS, MOCK_USER_ID } from '@/lib/mock-data'
import { updateProfile, updateListingStatus } from './actions'

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

  if (isDemo()) {
    profile = MOCK_PROFILE
    listings = MOCK_LISTINGS.filter(l => l.user_id === MOCK_USER_ID)
  } else {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) redirect('/auth/signin?redirect=/profile')

      const [{ data: p }, { data: l }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('listings').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      ])
      profile = p
      listings = l ?? []
    } catch {
      profile = MOCK_PROFILE
      listings = MOCK_LISTINGS.filter(l => l.user_id === MOCK_USER_ID)
    }
  }

  return (
    <DashboardClient
      profile={profile}
      listings={listings}
      updateAction={updateProfile}
      updateListingStatus={updateListingStatus}
      success={!!searchParams.success}
    />
  )
}
