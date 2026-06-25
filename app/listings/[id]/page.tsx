import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { formatPrice, formatCondition, getConditionBadgeClass } from '@/lib/utils'

export default async function ListingDetailPage({ params }: { params: { id: string } }) {
  let listing: any = null
  let user: any = null

  try {
    const supabase = createClient()
    const [{ data: l }, { data: { user: u } }] = await Promise.all([
      supabase.from('listings').select('*, profiles(id, name, city)').eq('id', params.id).single(),
      supabase.auth.getUser(),
    ])
    listing = l
    user = u
  } catch {
    // Supabase not connected
  }

  if (!listing) notFound()

  const isFree = !listing.price
  const isOwner = user?.id === listing.user_id

  async function startConversation(formData: FormData) {
    'use server'
    const { createClient: createSrv } = await import('@/lib/supabase/server')
    const { redirect } = await import('next/navigation')
    const supabase = createSrv()
    const { data: { user: u } } = await supabase.auth.getUser()
    if (!u) redirect(`/auth/signin?redirect=/listings/${params.id}`)

    const { data: existing } = await supabase
      .from('conversations')
      .select('id')
      .eq('listing_id', listing.id)
      .eq('buyer_id', u!.id)
      .single()

    if (existing) redirect(`/messages/${existing.id}`)

    const { data: convo } = await supabase
      .from('conversations')
      .insert({ listing_id: listing.id, buyer_id: u!.id, seller_id: listing.profiles.id })
      .select('id')
      .single()

    redirect(`/messages/${convo!.id}`)
  }

  return (
    <div className="max-w-3xl mx-auto px-8 py-12">
      <Link href="/listings" className="text-bk-orange font-bold text-sm mb-6 inline-block hover:underline">
        ← Back to listings
      </Link>

      <div className="bg-white rounded-3xl overflow-hidden border-2 border-gray-100 shadow-[0_8px_0_#e5e7eb]">
        <div className="relative h-64 bg-gradient-to-br from-yellow-200 to-orange-200 flex items-center justify-center text-8xl">
          {listing.photo_url ? (
            <Image src={listing.photo_url} alt={listing.title} fill className="object-cover"/>
          ) : (
            <span>📚</span>
          )}
          <span className={`absolute top-4 right-4 px-4 py-1.5 rounded-full text-sm font-black ${isFree ? 'bg-bk-teal text-white' : 'bg-bk-orange text-white'}`}>
            {isFree ? 'FREE' : formatPrice(listing.price)}
          </span>
        </div>

        <div className="p-8">
          <h1 className="font-display text-3xl mb-1">{listing.title}</h1>
          <p className="text-gray-500 font-bold text-lg mb-4">by {listing.author}</p>

          <div className="flex gap-3 mb-6 flex-wrap">
            <span className={`text-sm font-bold px-3 py-1.5 rounded-xl border ${getConditionBadgeClass(listing.condition)}`}>
              {formatCondition(listing.condition)}
            </span>
            <span className="text-sm font-bold px-3 py-1.5 rounded-xl bg-gray-100 text-gray-600">
              📍 {listing.city}
            </span>
          </div>

          {listing.description && (
            <p className="text-gray-600 font-semibold leading-relaxed mb-6">{listing.description}</p>
          )}

          <div className="border-t-2 border-dashed border-gray-100 pt-6 flex items-center justify-between">
            <p className="text-gray-500 font-semibold">
              Listed by <span className="font-black text-gray-700">{listing.profiles?.name}</span>
            </p>
            {isOwner ? (
              <Link href="/profile" className="bg-gray-100 text-gray-600 px-6 py-2.5 rounded-full font-extrabold text-sm">
                Manage Listing
              </Link>
            ) : (
              <form action={startConversation}>
                <button
                  type="submit"
                  className="bg-bk-orange text-white px-8 py-2.5 rounded-full font-extrabold shadow-[0_4px_0_#c2410c] hover:shadow-[0_2px_0_#c2410c] hover:translate-y-0.5 transition-all"
                >
                  💬 Message Seller
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
