import BookCard from '@/components/BookCard'
import ScallopDivider from '@/components/ScallopDivider'
import HeroBookshelf from '@/components/HeroBookshelf'
import Link from 'next/link'
import type { Listing } from '@/lib/types'
import { MOCK_LISTINGS } from '@/lib/mock-data'

async function getListings(city: string, type: string): Promise<Listing[]> {
  try {
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = createClient()
    let query = supabase
      .from('listings')
      .select('*, profiles(name, city)')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(12)

    if (city) query = query.ilike('city', `%${city}%`)
    if (type === 'free') query = query.is('price', null)
    if (type === 'sale') query = query.not('price', 'is', null)

    const { data } = await query
    return (data as Listing[]) ?? []
  } catch {
    let results = [...MOCK_LISTINGS]
    if (city) results = results.filter(l => l.city.toLowerCase().includes(city.toLowerCase()))
    if (type === 'free') results = results.filter(l => !l.price)
    if (type === 'sale') results = results.filter(l => !!l.price)
    return results.slice(0, 12) as unknown as Listing[]
  }
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: { city?: string; type?: string }
}) {
  const city = searchParams.city ?? ''
  const type = searchParams.type ?? 'all'
  const listings = await getListings(city, type)

  return (
    <>
      {/* Hero */}
      <section className="bg-cream" style={{ padding: '48px 16px 72px' }}>
        <HeroBookshelf />
      </section>

      {/* Search Band */}
      <ScallopDivider color="#f97316" bgColor="#fffbf0" direction="down" />
      <div className="bg-bk-orange px-4 md:px-8 pt-4 pb-7">
        <form className="bg-white rounded-[20px] p-4 md:p-[18px_24px] max-w-[640px] mx-auto shadow-[0_6px_0_rgba(0,0,0,0.12)] flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="flex items-center gap-2 sm:flex-1">
            <span className="text-[22px] shrink-0">📍</span>
            <input
              name="city"
              defaultValue={city}
              placeholder="Your city..."
              className="flex-1 border-2 border-[#fed7aa] rounded-xl px-[14px] py-[10px] font-bold text-[15px] bg-cream focus:outline-none focus:border-bk-orange"
            />
          </div>
          <div className="flex gap-3 items-center">
            <select
              name="type"
              defaultValue={type}
              className="flex-1 sm:flex-none border-2 border-[#fed7aa] rounded-xl px-3 py-[10px] font-bold text-[15px] bg-cream focus:outline-none"
            >
              <option value="all">All Books</option>
              <option value="sale">For Sale</option>
              <option value="free">Free Only</option>
            </select>
            <button
              type="submit"
              className="bg-bk-orange text-white px-6 py-[11px] rounded-xl font-extrabold text-[15px] border-none shadow-[0_3px_0_#c2410c] hover:shadow-[0_1px_0_#c2410c] hover:translate-y-0.5 transition-all whitespace-nowrap"
            >
              Find Books
            </button>
          </div>
        </form>
      </div>
      <ScallopDivider color="#f97316" bgColor="#fffbf0" direction="up" />

      {/* Listings Grid */}
      <section className="max-w-[1120px] mx-auto px-4 md:px-8 pt-8 md:pt-11 pb-[60px]">
        <h2 className="font-display text-[28px] mb-1">
          {city ? `Books near ${city} 📚` : 'Browse all books 📚'}
        </h2>
        <p className="text-[#999] text-sm font-bold mb-5">
          {listings.length} book{listings.length !== 1 ? 's' : ''} listed by your neighbors
        </p>

        <div className="flex gap-[10px] mb-7 flex-wrap">
          {[
            { val: 'all', label: 'All Books' },
            { val: 'sale', label: '📗 For Sale' },
            { val: 'free', label: '🎁 Free' },
          ].map(({ val, label }) => (
            <Link
              key={val}
              href={`/?city=${city}&type=${val}`}
              className={`px-[18px] py-[7px] rounded-full font-extrabold text-[13px] border-[2.5px] transition-colors ${
                type === val
                  ? val === 'free'
                    ? 'bg-bk-teal border-bk-teal text-white'
                    : 'bg-bk-orange border-bk-orange text-white'
                  : 'bg-white border-[#e5e7eb] text-[#2d2d2d] hover:border-bk-orange'
              }`}
            >
              {label}
            </Link>
          ))}
        </div>

        {listings.length > 0 ? (
          <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            {listings.map(l => <BookCard key={l.id} listing={l} />)}
          </div>
        ) : (
          <div className="text-center py-20 text-[#999] font-bold">
            <div className="text-5xl mb-4">📭</div>
            <p className="mb-2">No books listed yet{city ? ` in ${city}` : ''}.</p>
            <p className="text-sm mb-6">Be the first to share a book with your neighbors!</p>
            <Link
              href="/post"
              className="bg-bk-orange text-white px-6 py-2.5 rounded-full font-extrabold text-sm shadow-[0_3px_0_#c2410c]"
            >
              Post a Book →
            </Link>
          </div>
        )}
      </section>

      {/* How It Works */}
      <ScallopDivider color="#0d9488" bgColor="#fffbf0" direction="down" />
      <section id="how-it-works" className="bg-[#ecfdf5] px-4 md:px-10 pt-5 pb-[60px] text-center">
        <h2 className="font-display text-[30px] mb-1.5">How it works 🏡</h2>
        <p className="text-[#6b7280] text-[15px] font-semibold mb-10">As simple as a little free library — just online.</p>
        <div className="grid grid-cols-2 md:flex gap-5 justify-center max-w-[900px] mx-auto">
          {[
            { n: 1, icon: '🏙️', title: 'Set your city', desc: 'Create a free account and set your city to see books near you.' },
            { n: 2, icon: '📚', title: 'Browse or post', desc: 'Browse listings for free. Post books to sell or give away.' },
            { n: 3, icon: '💬', title: 'Message a neighbor', desc: 'Message the seller to arrange a local meetup.' },
            { n: 4, icon: '🤝', title: 'Meet & exchange', desc: 'Meet locally and swap the book however works for you both.' },
          ].map(s => (
            <div
              key={s.n}
              className="bg-white rounded-[20px] p-[20px_14px] md:p-[26px_18px] md:flex-1 md:max-w-[205px] border-[3px] border-[#d1fae5] shadow-[0_5px_0_#a7f3d0] text-center"
            >
              <div className="w-[38px] h-[38px] bg-bk-orange text-white font-display text-lg rounded-full flex items-center justify-center mx-auto mb-3 shadow-[0_3px_0_#c2410c]">
                {s.n}
              </div>
              <div className="text-[34px] mb-2.5">{s.icon}</div>
              <h3 className="text-[15px] font-black mb-1.5">{s.title}</h3>
              <p className="text-[13px] text-[#777] leading-relaxed font-semibold">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>
      <ScallopDivider color="#0d9488" bgColor="#fffbf0" direction="up" />

      {/* CTA Band */}
      <section className="bg-bk-orange py-[50px] px-4 md:px-8 text-center relative overflow-hidden">
        {/* Kid-drawing SVG background */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1400 220" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
          <g opacity="0.15">
            <text x="80" y="60" fontSize="30" fill="#fff">★</text>
            <text x="200" y="160" fontSize="20" fill="#fff">★</text>
            <text x="1250" y="50" fontSize="28" fill="#fff">★</text>
            <text x="1100" y="170" fontSize="18" fill="#fff">★</text>
            <circle cx="350" cy="110" r="18" fill="#fff"/>
            <circle cx="350" cy="88" r="9" fill="#fff"/>
            <circle cx="350" cy="132" r="9" fill="#fff"/>
            <circle cx="328" cy="110" r="9" fill="#fff"/>
            <circle cx="372" cy="110" r="9" fill="#fff"/>
            <circle cx="350" cy="110" r="11" fill="#f97316"/>
            <circle cx="1050" cy="110" r="16" fill="#fff"/>
            <circle cx="1050" cy="90" r="8" fill="#fff"/>
            <circle cx="1050" cy="130" r="8" fill="#fff"/>
            <circle cx="1030" cy="110" r="8" fill="#fff"/>
            <circle cx="1070" cy="110" r="8" fill="#fff"/>
            <circle cx="1050" cy="110" r="10" fill="#f97316"/>
            <circle cx="700" cy="40" r="24" fill="#fbbf24" opacity="0.6"/>
            <line x1="700" y1="8" x2="700" y2="16" stroke="#fbbf24" strokeWidth="4" opacity="0.6"/>
            <line x1="700" y1="64" x2="700" y2="72" stroke="#fbbf24" strokeWidth="4" opacity="0.6"/>
            <line x1="668" y1="40" x2="676" y2="40" stroke="#fbbf24" strokeWidth="4" opacity="0.6"/>
            <line x1="724" y1="40" x2="732" y2="40" stroke="#fbbf24" strokeWidth="4" opacity="0.6"/>
          </g>
        </svg>
        <div className="relative z-10">
          <div className="text-[30px] mb-[22px] flex justify-center gap-4 flex-wrap">🌸 🌻 🌈 ☀️ 🌼 🌿 🌷</div>
          <h2 className="font-display text-[28px] text-white mb-3">Your neighborhood deserves a little free library.</h2>
          <p className="text-[#fff7ed] text-base font-bold mb-6">Join your neighbors and start sharing books today — free to browse, free to join.</p>
          <Link
            href="/auth/signup"
            className="bg-bk-teal text-white px-8 py-3 rounded-full font-extrabold shadow-[0_4px_0_#0f766e] hover:shadow-[0_2px_0_#0f766e] hover:translate-y-0.5 transition-all inline-block"
          >
            Join Your Community →
          </Link>
        </div>
      </section>
    </>
  )
}
