import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { formatPrice, formatCondition } from '@/lib/utils'

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: { success?: string; error?: string }
}) {
  let profile: any = null
  let listings: any[] = []
  let userId = ''

  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/auth/signin?redirect=/profile')
    userId = user.id

    const [{ data: p }, { data: l }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('listings').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
    ])
    profile = p
    listings = l ?? []
  } catch {
    redirect('/auth/signin?redirect=/profile')
  }

  async function updateProfile(formData: FormData) {
    'use server'
    const { createClient: createSrv } = await import('@/lib/supabase/server')
    const { redirect: redir } = await import('next/navigation')
    const supabase = createSrv()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redir('/auth/signin')
    await supabase.from('profiles').update({
      name: formData.get('name') as string,
      city: formData.get('city') as string,
    }).eq('id', user!.id)
    redir('/profile?success=1')
  }

  async function updateListingStatus(formData: FormData) {
    'use server'
    const { createClient: createSrv } = await import('@/lib/supabase/server')
    const { redirect: redir } = await import('next/navigation')
    const supabase = createSrv()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redir('/auth/signin')
    const id = formData.get('id') as string
    const status = formData.get('status') as string
    if (status === 'delete') {
      await supabase.from('listings').delete().eq('id', id).eq('user_id', user!.id)
    } else {
      await supabase.from('listings').update({ status }).eq('id', id).eq('user_id', user!.id)
    }
    redir('/profile')
  }

  const activeListings = listings.filter(l => l.status === 'active')
  const pastListings = listings.filter(l => l.status !== 'active')

  return (
    <div className="max-w-2xl mx-auto px-8 py-10">
      <h1 className="font-display text-3xl text-bk-orange mb-6">Your Profile</h1>

      {/* Edit Profile */}
      <div className="bg-white rounded-2xl p-6 border-2 border-gray-100 shadow-[0_4px_0_#e5e7eb] mb-8">
        <h2 className="font-black text-gray-700 mb-4">Account Info</h2>
        {searchParams.success && (
          <div className="bg-green-50 border-2 border-green-200 rounded-xl px-4 py-2 text-green-700 font-bold text-sm mb-4">
            Profile updated!
          </div>
        )}
        <form action={updateProfile} className="space-y-4">
          <div>
            <label className="block text-sm font-extrabold text-gray-600 mb-1">Name</label>
            <input
              name="name"
              defaultValue={profile?.name}
              required
              className="w-full border-2 border-orange-200 rounded-xl px-4 py-2.5 font-bold focus:outline-none focus:border-bk-orange"
            />
          </div>
          <div>
            <label className="block text-sm font-extrabold text-gray-600 mb-1">City</label>
            <input
              name="city"
              defaultValue={profile?.city}
              required
              className="w-full border-2 border-orange-200 rounded-xl px-4 py-2.5 font-bold focus:outline-none focus:border-bk-orange"
            />
          </div>
          <button
            type="submit"
            className="bg-bk-orange text-white px-6 py-2.5 rounded-xl font-extrabold text-sm shadow-[0_3px_0_#c2410c] hover:shadow-[0_1px_0_#c2410c] hover:translate-y-0.5 transition-all"
          >
            Save Changes
          </button>
        </form>
      </div>

      {/* Active Listings */}
      <h2 className="font-black text-gray-700 mb-3">My Active Listings ({activeListings.length})</h2>
      {activeListings.length === 0 ? (
        <div className="text-center py-8 text-gray-300 font-bold text-sm mb-8">
          No active listings.{' '}
          <Link href="/post" className="text-bk-orange hover:underline">Post a book →</Link>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {activeListings.map(l => (
            <div key={l.id} className="bg-white rounded-2xl p-4 border-2 border-gray-100 shadow-[0_3px_0_#e5e7eb] flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <Link href={`/listings/${l.id}`} className="font-black text-gray-800 hover:text-bk-orange truncate block">
                  {l.title}
                </Link>
                <p className="text-xs text-gray-400 font-semibold">{l.author} · {formatCondition(l.condition)} · {formatPrice(l.price)}</p>
              </div>
              <form action={updateListingStatus} className="flex gap-2 shrink-0">
                <input type="hidden" name="id" value={l.id}/>
                <select
                  name="status"
                  className="border-2 border-orange-200 rounded-lg px-2 py-1.5 font-bold text-xs focus:outline-none"
                  defaultValue="active"
                >
                  <option value="sold">Mark Sold</option>
                  <option value="given">Mark Given Away</option>
                  <option value="delete">Delete</option>
                </select>
                <button
                  type="submit"
                  className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg font-extrabold text-xs hover:bg-gray-200"
                >
                  Update
                </button>
              </form>
            </div>
          ))}
        </div>
      )}

      {/* Past Listings */}
      {pastListings.length > 0 && (
        <>
          <h2 className="font-black text-gray-400 mb-3">Past Listings</h2>
          <div className="space-y-2">
            {pastListings.map(l => (
              <div key={l.id} className="bg-gray-50 rounded-xl p-3 border border-gray-100 flex items-center justify-between gap-4 opacity-60">
                <div>
                  <p className="font-black text-gray-600 text-sm">{l.title}</p>
                  <p className="text-xs text-gray-400 font-semibold">{l.status === 'sold' ? 'Sold' : 'Given Away'}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Sign Out */}
      <div className="mt-10 pt-6 border-t-2 border-dashed border-gray-100">
        <form action="/auth/signout" method="post">
          <button className="text-gray-400 font-bold text-sm hover:text-red-400 transition-colors">
            Sign Out
          </button>
        </form>
      </div>
    </div>
  )
}
