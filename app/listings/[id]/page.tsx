import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import HeartButton from '@/components/HeartButton'
import PhotoGallery from './PhotoGallery'
import { MOCK_LISTINGS, MOCK_CONVERSATIONS, MOCK_USER_ID } from '@/lib/mock-data'
import { averageRating } from '@/lib/reviewAverages'
import { StarRatingBadge } from '@/components/StarRating'
import { getListingAvailability } from '@/lib/listingAvailability'
import type { ListingStatus } from '@/lib/types'
import { addTbrEntry } from '@/lib/actions/tbrEntries'

const COVER_GRADIENTS = [
  'linear-gradient(145deg, #fde68a, #fca5a5)',
  'linear-gradient(145deg, #99f6e4, #bfdbfe)',
  'linear-gradient(145deg, #fca5a5, #fda4af)',
  'linear-gradient(145deg, #c4b5fd, #93c5fd)',
  'linear-gradient(145deg, #6ee7b7, #fde68a)',
  'linear-gradient(145deg, #fdba74, #fb7185)',
  'linear-gradient(145deg, #a5f3fc, #6ee7b7)',
  'linear-gradient(145deg, #ddd6fe, #fca5a5)',
]

function coverGradient(id: string) {
  const sum = id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return COVER_GRADIENTS[sum % COVER_GRADIENTS.length]
}

function conditionLabel(c: string) {
  if (c === 'good') return 'Good'
  if (c === 'fair') return 'Fair'
  if (c === 'well-loved') return 'Well-Loved'
  return c
}

export default async function ListingDetailPage({ params, searchParams }: { params: { id: string }, searchParams: { requested?: string; purchase_failed?: string; insufficient_credits?: string } }) {
  let listing: any = null
  let user: any = null
  let myConvoStatus: string | null = null
  let sellerRating: { average: number; count: number } | null = null

  try {
    const supabase = createClient()
    const [{ data: l }, { data: { user: u } }] = await Promise.all([
      supabase.from('listings').select('*, profiles(id, username, city)').eq('id', params.id).single(),
      supabase.auth.getUser(),
    ])
    listing = l
    user = u

    if (listing?.is_bundle) {
      const { data: books } = await supabase
        .from('listing_books').select('title, author, cover_url').eq('listing_id', listing.id).order('position', { ascending: true })
      listing.books = books ?? []
    }
    if (u) {
      const { data: c } = await supabase
        .from('conversations').select('exchange_status')
        .eq('listing_id', params.id).eq('buyer_id', u.id).maybeSingle()
      myConvoStatus = c?.exchange_status ?? null
    }
    const sellerId = (l?.profiles as any)?.id ?? l?.user_id
    if (sellerId) {
      const { data: ratingRows } = await supabase.from('reviews').select('rating').eq('seller_id', sellerId)
      sellerRating = averageRating((ratingRows ?? []).map((r: any) => r.rating))
    }
  } catch {
    const mock = MOCK_LISTINGS.find(l => l.id === params.id)
    if (mock) listing = { ...mock, profiles: mock.profiles }
  }

  if (!listing) notFound()

  const isOwner = user?.id === listing.user_id
  const isLoggedIn = !!user || !!cookies().get('lbe_demo_user')?.value

  let initialSaved = false
  if (user) {
    try {
      const supabase = createClient()
      const { data: saved } = await supabase
        .from('saved_listings').select('id').eq('user_id', user.id).eq('listing_id', params.id).maybeSingle()
      initialSaved = !!saved
    } catch {}
  }

  const gradient = coverGradient(listing.id)
  const isPending = searchParams.requested === '1' || myConvoStatus === 'requested'
  const avail = getListingAvailability((listing.status ?? 'active') as ListingStatus, {
    isOwner,
    isRequester: myConvoStatus === 'requested',
  })

  async function startConversation(formData: FormData) {
    'use server'
    const { redirect } = await import('next/navigation')
    const { cookies } = await import('next/headers')
    const { revalidatePath } = await import('next/cache')

    const isDemo = !process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http') ||
      !!cookies().get('lbe_demo_user')

    if (isDemo) {
      const { MOCK_CONVERSATIONS: convos } = await import('@/lib/mock-data')
      const mock = convos.find(c => c.listing_id === params.id)
      revalidatePath('/profile')
      redirect(`/profile?tab=messages&conversation=${mock?.id ?? 'mock-convo-1'}`)
    }

    try {
      const { createClient: createSrv } = await import('@/lib/supabase/server')
      const supabase = createSrv()
      const { data: { user: u } } = await supabase.auth.getUser()
      if (!u) redirect(`/auth/signin?redirect=/listings/${params.id}`)

      const { data: existing } = await supabase
        .from('conversations').select('id').eq('listing_id', listing.id).eq('buyer_id', u!.id).maybeSingle()
      if (existing) {
        revalidatePath('/profile')
        redirect(`/profile?tab=messages&conversation=${existing.id}`)
      }

      const sellerId = (listing.profiles as any)?.id ?? listing.user_id
      const { data: convo } = await supabase
        .from('conversations')
        .insert({ listing_id: listing.id, buyer_id: u!.id, seller_id: sellerId })
        .select('id').single()

      revalidatePath('/profile')
      redirect(`/profile?tab=messages&conversation=${convo!.id}`)
    } catch (err: any) {
      if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
      const { MOCK_CONVERSATIONS: convos } = await import('@/lib/mock-data')
      const mock = convos.find(c => c.listing_id === params.id)
      revalidatePath('/profile')
      redirect(`/profile?tab=messages&conversation=${mock?.id ?? 'mock-convo-1'}`)
    }
  }

  async function requestPurchase(formData: FormData) {
    'use server'
    const { redirect } = await import('next/navigation')
    const { cookies } = await import('next/headers')

    const isDemo = !process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http') ||
      !!cookies().get('lbe_demo_user')

    if (isDemo) {
      cookies().set('lbe_demo_pending', params.id, { maxAge: 86400, path: '/', sameSite: 'lax' })
      redirect(`/listings/${params.id}?requested=1`)
    }

    let lockAcquired = false
    try {
      const { createClient: createSrv } = await import('@/lib/supabase/server')
      const supabase = createSrv()
      const { data: { user: u } } = await supabase.auth.getUser()
      if (!u) redirect(`/auth/signin?redirect=/listings/${params.id}`)

      const { data: buyerProfile } = await supabase.from('profiles').select('credits').eq('id', u!.id).single()
      if (!buyerProfile || buyerProfile.credits < (listing.book_count ?? 1)) {
        redirect(`/listings/${params.id}?insufficient_credits=1`)
      }

      const { data: locked } = await supabase.rpc('lock_listing_for_request', { p_listing_id: listing.id })
      if (!locked) {
        redirect(`/listings/${params.id}?purchase_failed=1`)
      }
      lockAcquired = true

      // Find or create conversation (without exchange_status so it works before migration)
      let convoId: string
      const { data: existing } = await supabase
        .from('conversations').select('id').eq('listing_id', listing.id).eq('buyer_id', u!.id).maybeSingle()

      if (existing) {
        convoId = existing.id
      } else {
        const sellerId = (listing.profiles as any)?.id ?? listing.user_id
        const { data: convo, error: insertErr } = await supabase
          .from('conversations')
          .insert({ listing_id: listing.id, buyer_id: u!.id, seller_id: sellerId })
          .select('id').single()
        if (insertErr || !convo) throw new Error(insertErr?.message ?? 'insert failed')
        convoId = convo.id
      }

      // Try to set exchange_status (no-op if migration hasn't been run yet)
      await supabase.from('conversations').update({ exchange_status: 'requested' }).eq('id', convoId).then(() => {})

      // Send a purchase request message
      await supabase.from('messages').insert({
        conversation_id: convoId,
        sender_id: u!.id,
        body: '🛒 I\'d like to purchase this book! Please confirm when you\'re ready.',
        kind: 'purchase_request',
      })

      redirect(`/listings/${params.id}?requested=1`)
    } catch (err: any) {
      if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
      if (lockAcquired) {
        try {
          const { createClient: createSrv } = await import('@/lib/supabase/server')
          const supabase = createSrv()
          await supabase.rpc('reopen_listing', { p_listing_id: listing.id })
        } catch {}
      }
      redirect(`/listings/${params.id}?purchase_failed=1`)
    }
  }


  const uploadedPhotos = [listing.photo_url, listing.photo_url_2, listing.photo_url_3].filter(Boolean)
  const displayPhotos = uploadedPhotos.length > 0 ? uploadedPhotos : (listing.cover_url ? [listing.cover_url] : [])

  return (
    <div className="max-w-[680px] mx-auto px-4 py-6 md:px-8 md:py-10">
      <Link
        href="/listings"
        className="text-bk-orange font-bold text-[14px] inline-block mb-6 hover:underline"
      >
        ← Back to listings
      </Link>

      <div className="bg-white rounded-[28px] overflow-hidden border-2 border-gray-100 shadow-[0_8px_0_#e5e7eb]">
        {/* Cover */}
        <PhotoGallery
          photos={displayPhotos}
          alt={listing.title}
          gradient={gradient}
        >
          {!isOwner && (
            <HeartButton listingId={listing.id} isLoggedIn={isLoggedIn} initialSaved={initialSaved} />
          )}
          <span
            className="absolute top-5 right-5 px-5 py-2 rounded-full text-base font-black"
            style={{
              background: '#f97316',
              color: '#fff',
            }}
          >
            {listing.is_bundle ? `${listing.book_count ?? 1} credits` : '1 credit'}
          </span>
        </PhotoGallery>

        {/* Body */}
        <div className="p-5 md:p-8">
          <h1 className="font-display text-[30px] mb-1" style={{ color: '#1a1a1a' }}>
            {listing.is_bundle ? (listing.bundle_name || listing.title) : listing.title}
          </h1>
          <p className="font-bold text-[18px] mb-5" style={{ color: '#888' }}>by {listing.author}</p>

          {/* Badges */}
          <div className="flex gap-2.5 flex-wrap mb-5">
            <span
              className="text-[13px] font-extrabold"
              style={{
                padding: '8px 16px',
                borderRadius: 12,
                background: '#fef9c3',
                color: '#854d0e',
                border: '2px solid #fde047',
              }}
            >
              {conditionLabel(listing.condition)} Condition
            </span>
            {listing.genre && (
              <span
                className="text-[13px] font-extrabold"
                style={{ padding: '8px 16px', borderRadius: 12, background: '#f3f4f6', color: '#555' }}
              >
                {listing.genre}
              </span>
            )}
            {listing.isbn && (
              <span
                className="text-[13px] font-extrabold break-words"
                style={{ padding: '8px 16px', borderRadius: 12, background: '#f3f4f6', color: '#555' }}
              >
                ISBN {listing.isbn}
              </span>
            )}
            <span
              className="text-[13px] font-extrabold"
              style={{
                padding: '8px 16px',
                borderRadius: 12,
                background: '#f0fdf4',
                color: '#166534',
                border: '2px solid #bbf7d0',
              }}
            >
              📍 {listing.profiles?.city || listing.city}
            </span>
          </div>

          {listing.description && (
            <p className="font-semibold leading-[1.7] mb-7 text-[15px] break-words" style={{ color: '#666' }}>
              {listing.description}
            </p>
          )}

          {listing.is_bundle && (
            <div style={{ marginBottom: 28 }}>
              <p className="font-display text-[16px] text-bk-orange mb-3">📚 Books in this Bundle</p>
              <div className="flex flex-col" style={{ gap: 8 }}>
                <div style={{ padding: '10px 14px', borderRadius: 12, background: '#fff7ed', border: '2px solid #fed7aa', display: 'flex', alignItems: 'center', gap: 10 }}>
                  {listing.cover_url && (
                    <img src={listing.cover_url} alt="" style={{ width: 32, height: 46, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                  )}
                  <div>
                    <span className="font-black text-[14px]">{listing.title}</span>
                    <span className="font-semibold text-[13px]" style={{ color: '#888' }}> — {listing.author}</span>
                  </div>
                </div>
                {(listing.books ?? []).map((b: { title: string; author: string; cover_url: string | null }, i: number) => (
                  <div key={i} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff7ed', border: '2px solid #fed7aa', display: 'flex', alignItems: 'center', gap: 10 }}>
                    {b.cover_url && (
                      <img src={b.cover_url} alt="" style={{ width: 32, height: 46, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                    )}
                    <div>
                      <span className="font-black text-[14px]">{b.title}</span>
                      <span className="font-semibold text-[13px]" style={{ color: '#888' }}> — {b.author}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Divider + footer */}
          <div style={{ borderTop: '2px dashed #e5e7eb', marginBottom: 24 }} />
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-[14px]" style={{ color: '#888' }}>
                Listed by <strong style={{ color: '#1a1a1a', fontWeight: 900 }}>{listing.profiles?.username ?? 'a neighbor'}</strong>
              </p>
              <StarRatingBadge rating={sellerRating} sellerId={(listing.profiles as any)?.id ?? listing.user_id} />
            </div>
            {isOwner ? (
              <Link
                href="/profile"
                className="font-extrabold text-sm"
                style={{ background: '#f3f4f6', color: '#555', padding: '12px 24px', borderRadius: 999 }}
              >
                Manage Listing
              </Link>
            ) : searchParams.purchase_failed === '1' ? (
              <div style={{ background: '#fef2f2', border: '2px solid #fca5a5', color: '#b91c1c', padding: '12px 22px', borderRadius: 16, fontWeight: 800, fontSize: 14 }}>
                ❌ Purchase failed — please try again or message the seller.
              </div>
            ) : searchParams.insufficient_credits === '1' ? (
              <div style={{ background: '#fef2f2', border: '2px solid #fca5a5', color: '#b91c1c', padding: '12px 22px', borderRadius: 16, fontWeight: 800, fontSize: 14 }}>
                🪙 You don't have enough credits for this. Check your Wallet balance.
              </div>
            ) : (isPending || avail === 'pending-mine') ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end' }}>
                <div
                  className="font-extrabold text-[14px]"
                  style={{ background: '#fffbeb', border: '2px solid #fcd34d', color: '#92400e', padding: '12px 22px', borderRadius: 16, display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  ⏳ Pending — waiting for <strong>{listing.profiles?.username ?? 'seller'}</strong> to confirm
                </div>
                <Link
                  href={`/profile?demo_pending=${params.id}`}
                  className="font-bold text-[12px] hover:underline"
                  style={{ color: '#aaa' }}
                >
                  View in Exchanges tab →
                </Link>
              </div>
            ) : avail === 'pending-locked' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end' }}>
                <div
                  className="font-extrabold text-[14px]"
                  style={{ background: '#fffbeb', border: '2px solid #fcd34d', color: '#92400e', padding: '12px 22px', borderRadius: 16 }}
                >
                  ⏳ This book is currently pending with another buyer
                </div>
                <form action={addTbrEntry}>
                  <input type="hidden" name="title" value={listing.title} />
                  <input type="hidden" name="author" value={listing.author} />
                  <input type="hidden" name="ol_work_key" value={listing.ol_work_key ?? ''} />
                  <input type="hidden" name="cover_url" value={listing.cover_url ?? ''} />
                  <input type="hidden" name="redirect_to" value="/profile?tab=tbr" />
                  <button
                    type="submit"
                    className="font-extrabold text-[12px] hover:underline"
                    style={{ background: 'none', border: 'none', color: '#7c3aed', cursor: 'pointer', padding: 0 }}
                  >
                    📚 Add to my TBR — notify me if it reopens
                  </button>
                </form>
              </div>
            ) : avail === 'unavailable' ? (
              <div style={{ background: '#f3f4f6', color: '#888', padding: '12px 22px', borderRadius: 16, fontWeight: 800, fontSize: 14 }}>
                No longer available
              </div>
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                <form action={requestPurchase}>
                  <button
                    type="submit"
                    className="font-extrabold text-base text-white shadow-[0_4px_0_#0f766e] hover:shadow-[0_2px_0_#0f766e] hover:translate-y-0.5 transition-all"
                    style={{ background: '#0d9488', padding: '14px 32px', borderRadius: 999, border: 'none', cursor: 'pointer' }}
                  >
                    {listing.is_bundle ? `🪙 Purchase Bundle for ${listing.book_count ?? 1} Credits` : '🪙 Purchase with 1 Credit'}
                  </button>
                </form>
                <form action={startConversation}>
                  <button
                    type="submit"
                    className="font-extrabold text-base text-white shadow-[0_4px_0_#c2410c] hover:shadow-[0_2px_0_#c2410c] hover:translate-y-0.5 transition-all"
                    style={{ background: '#f97316', padding: '14px 32px', borderRadius: 999, border: 'none', cursor: 'pointer' }}
                  >
                    💬 Message Seller
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
