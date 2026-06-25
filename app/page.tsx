import BookCard from '@/components/BookCard'
import ScallopDivider from '@/components/ScallopDivider'
import KidDrawingBackground from '@/components/KidDrawingBackground'
import Link from 'next/link'
import type { Listing } from '@/lib/types'

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
    return []
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
      <section className="relative bg-cream overflow-hidden min-h-[500px] flex items-center justify-center text-center px-8 py-20">
        <KidDrawingBackground />
        <div className="relative z-10">
          <h1 className="font-display text-5xl leading-tight text-gray-900 mb-4 max-w-2xl mx-auto">
            Books finding new homes with{' '}
            <span className="text-bk-orange">your neighbors.</span>
          </h1>
          <p className="text-lg text-gray-500 font-semibold max-w-md mx-auto mb-8 leading-relaxed">
            A neighborhood book exchange — online. Buy, sell, or give away used books right in your community.
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Link href="/listings" className="bg-bk-orange text-white px-8 py-3 rounded-full font-extrabold text-base shadow-[0_5px_0_#c2410c] hover:shadow-[0_3px_0_#c2410c] hover:translate-y-0.5 transition-all">
              🏙️ Browse Books Near Me
            </Link>
            <Link href="/post" className="bg-bk-teal text-white px-8 py-3 rounded-full font-extrabold text-base shadow-[0_5px_0_#0f766e] hover:shadow-[0_3px_0_#0f766e] hover:translate-y-0.5 transition-all">
              📚 Post a Book
            </Link>
          </div>
        </div>
      </section>

      {/* Search Band */}
      <ScallopDivider color="#f97316" bgColor="#fffbf0" direction="down"/>
      <div className="bg-bk-orange py-4 px-8">
        <form className="bg-white rounded-2xl p-5 max-w-2xl mx-auto flex gap-3 items-center shadow-[0_6px_0_rgba(0,0,0,0.12)]">
          <span className="text-xl">📍</span>
          <input
            name="city"
            defaultValue={city}
            placeholder="Enter your city..."
            className="flex-1 border-2 border-orange-200 rounded-xl px-4 py-2.5 font-bold text-sm bg-cream focus:outline-none focus:border-bk-orange"
          />
          <select
            name="type"
            defaultValue={type}
            className="border-2 border-orange-200 rounded-xl px-3 py-2.5 font-bold text-sm bg-cream focus:outline-none"
          >
            <option value="all">All Books</option>
            <option value="sale">For Sale</option>
            <option value="free">Free Only</option>
          </select>
          <button type="submit" className="bg-bk-orange text-white px-6 py-2.5 rounded-xl font-extrabold text-sm shadow-[0_3px_0_#c2410c] hover:shadow-[0_1px_0_#c2410c] hover:translate-y-0.5 transition-all">
            Find Books
          </button>
        </form>
      </div>
      <ScallopDivider color="#f97316" bgColor="#fffbf0" direction="up"/>

      {/* Listings Grid */}
      <section className="max-w-6xl mx-auto px-8 py-10">
        <div className="flex items-center gap-4 mb-6 flex-wrap">
          {['all','sale','free'].map(t => (
            <Link
              key={t}
              href={`/?city=${city}&type=${t}`}
              className={`px-5 py-2 rounded-full text-sm font-extrabold border-2 transition-colors ${
                type === t ? 'bg-bk-orange text-white border-bk-orange' : 'bg-white text-gray-500 border-gray-200 hover:border-bk-orange'
              }`}
            >
              {t === 'all' ? 'All Books' : t === 'sale' ? '📗 For Sale' : '🎁 Free'}
            </Link>
          ))}
        </div>

        {listings.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {listings.map(l => <BookCard key={l.id} listing={l}/>)}
          </div>
        ) : (
          <div className="text-center py-20 text-gray-400 font-bold">
            <div className="text-5xl mb-4">📭</div>
            <p className="mb-2">No books listed yet{city ? ` in ${city}` : ''}.</p>
            <p className="text-sm mb-6">Be the first to share a book with your neighbors!</p>
            <Link href="/post" className="bg-bk-orange text-white px-6 py-2.5 rounded-full font-extrabold text-sm shadow-[0_3px_0_#c2410c]">
              Post a Book →
            </Link>
          </div>
        )}
      </section>

      {/* How It Works */}
      <ScallopDivider color="#0d9488" bgColor="#fffbf0" direction="down"/>
      <section className="bg-emerald-50 py-14 px-8 text-center">
        <h2 className="font-display text-3xl mb-2">How it works 🏡</h2>
        <p className="text-gray-500 font-semibold mb-10">As simple as a little free library — just online.</p>
        <div className="flex gap-5 justify-center flex-wrap max-w-3xl mx-auto">
          {[
            { n:1, icon:'🏙️', title:'Set your city', desc:'Create a free account and set your city to see books near you.' },
            { n:2, icon:'📚', title:'Browse or post', desc:'Browse for free. Post books to sell or give away to neighbors.' },
            { n:3, icon:'💬', title:'Message a neighbor', desc:'Message the seller through the site to arrange a local meetup.' },
            { n:4, icon:'🤝', title:'Meet & exchange', desc:'Meet locally and pay however works best for both of you.' },
          ].map(s => (
            <div key={s.n} className="bg-white rounded-2xl p-6 flex-1 min-w-[160px] max-w-[200px] border-2 border-emerald-100 shadow-[0_5px_0_#a7f3d0] text-center">
              <div className="w-10 h-10 bg-bk-orange text-white font-display text-lg rounded-full flex items-center justify-center mx-auto mb-3 shadow-[0_3px_0_#c2410c]">{s.n}</div>
              <div className="text-3xl mb-2">{s.icon}</div>
              <h3 className="font-black text-sm mb-1">{s.title}</h3>
              <p className="text-xs text-gray-500 leading-relaxed font-semibold">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>
      <ScallopDivider color="#0d9488" bgColor="#fffbf0" direction="up"/>

      {/* CTA */}
      <section className="bg-bk-orange py-12 px-8 text-center">
        <div className="text-3xl mb-4">🌸 🌻 🌈 ☀️ 🌼 🌿 🌷</div>
        <h2 className="font-display text-2xl text-white mb-3">Your neighborhood deserves a little free library.</h2>
        <p className="text-orange-100 font-bold mb-6">Join your neighbors and start sharing books today — free to browse, free to join.</p>
        <Link href="/auth/signup" className="bg-bk-teal text-white px-8 py-3 rounded-full font-extrabold shadow-[0_4px_0_#0f766e] hover:shadow-[0_2px_0_#0f766e] hover:translate-y-0.5 transition-all inline-block">
          Join Your Community →
        </Link>
      </section>
    </>
  )
}
