import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import SaveButton from '@/components/SaveButton'
import { MOCK_LISTINGS, MOCK_CONVERSATIONS, MOCK_USER_ID } from '@/lib/mock-data'

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
    const mock = MOCK_LISTINGS.find(l => l.id === params.id)
    if (mock) listing = { ...mock, profiles: mock.profiles }
  }

  if (!listing) notFound()

  const isOwner = user?.id === listing.user_id
  const gradient = coverGradient(listing.id)

  async function startConversation(formData: FormData) {
    'use server'
    const { redirect } = await import('next/navigation')
    const { cookies } = await import('next/headers')

    // Demo mode: if no real Supabase session, go straight to the mock conversation
    const isDemo = !process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http') ||
      !!cookies().get('lbe_demo_user')

    if (isDemo) {
      const { MOCK_CONVERSATIONS: convos } = await import('@/lib/mock-data')
      const mock = convos.find(c => c.listing_id === params.id)
      redirect(`/messages/${mock?.id ?? 'mock-convo-1'}`)
    }

    try {
      const { createClient: createSrv } = await import('@/lib/supabase/server')
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
    } catch (err: any) {
      if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
      const { MOCK_CONVERSATIONS: convos } = await import('@/lib/mock-data')
      const mock = convos.find(c => c.listing_id === params.id)
      redirect(`/messages/${mock?.id ?? 'mock-convo-1'}`)
    }
  }

  return (
    <div className="max-w-[680px] mx-auto px-8 py-10">
      <Link
        href="/listings"
        className="text-bk-orange font-bold text-[14px] inline-block mb-6 hover:underline"
      >
        ← Back to listings
      </Link>

      <div className="bg-white rounded-[28px] overflow-hidden border-2 border-gray-100 shadow-[0_8px_0_#e5e7eb]">
        {/* Cover */}
        <div
          className="relative flex items-center justify-center text-[100px]"
          style={{ height: 280, background: gradient }}
        >
          {listing.photo_url ? (
            <Image src={listing.photo_url} alt={listing.title} fill className="object-cover" />
          ) : (
            <span>📚</span>
          )}
          <span
            className="absolute top-5 right-5 px-5 py-2 rounded-full text-base font-black"
            style={{
              background: '#f97316',
              color: '#fff',
            }}
          >
            1 credit
          </span>
        </div>

        {/* Body */}
        <div style={{ padding: 32 }}>
          <h1 className="font-display text-[30px] mb-1" style={{ color: '#1a1a1a' }}>{listing.title}</h1>
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
            <p className="font-semibold leading-[1.7] mb-7 text-[15px]" style={{ color: '#666' }}>
              {listing.description}
            </p>
          )}

          {/* Divider + footer */}
          <div style={{ borderTop: '2px dashed #e5e7eb', marginBottom: 24 }} />
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="font-semibold text-[14px]" style={{ color: '#888' }}>
              Listed by <strong style={{ color: '#1a1a1a', fontWeight: 900 }}>{listing.profiles?.name ?? 'a neighbor'}</strong>
            </p>
            {isOwner ? (
              <Link
                href="/profile"
                className="font-extrabold text-sm"
                style={{ background: '#f3f4f6', color: '#555', padding: '12px 24px', borderRadius: 999 }}
              >
                Manage Listing
              </Link>
            ) : (
              <div className="flex items-center gap-3">
                <SaveButton listingId={listing.id} />
                <button
                    className="font-extrabold text-base text-white shadow-[0_4px_0_#0f766e]"
                    style={{
                      background: '#0d9488',
                      padding: '14px 32px',
                      borderRadius: 999,
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    🪙 Use 1 Credit
                  </button>
                <form action={startConversation}>
                  <button
                    type="submit"
                    className="font-extrabold text-base text-white shadow-[0_4px_0_#c2410c] hover:shadow-[0_2px_0_#c2410c] hover:translate-y-0.5 transition-all"
                    style={{
                      background: '#f97316',
                      padding: '14px 32px',
                      borderRadius: 999,
                      border: 'none',
                      cursor: 'pointer',
                    }}
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
