import { createClient } from '@/lib/supabase/server'
import BookCard from '@/components/BookCard'
import Link from 'next/link'
import type { Listing } from '@/lib/types'

async function getListings(city: string, type: string, q: string): Promise<Listing[]> {
  try {
    const supabase = createClient()
    let query = supabase
      .from('listings')
      .select('*, profiles(name, city)')
      .eq('status', 'active')
      .order('created_at', { ascending: false })

    if (city) query = query.ilike('city', `%${city}%`)
    if (type === 'free') query = query.is('price', null)
    if (type === 'sale') query = query.not('price', 'is', null)
    if (q) query = query.or(`title.ilike.%${q}%,author.ilike.%${q}%`)

    const { data } = await query
    return (data as Listing[]) ?? []
  } catch {
    return []
  }
}

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: { city?: string; type?: string; q?: string }
}) {
  const city = searchParams.city ?? ''
  const type = searchParams.type ?? 'all'
  const q = searchParams.q ?? ''
  const listings = await getListings(city, type, q)

  return (
    <div className="max-w-6xl mx-auto px-8 py-10">
      <h1 className="font-display text-3xl mb-2">Browse Books 📚</h1>
      <p className="text-gray-400 font-semibold mb-6">{listings.length} books available</p>

      <form className="flex gap-3 flex-wrap mb-6">
        <input
          name="city"
          defaultValue={city}
          placeholder="City..."
          className="border-2 border-orange-200 rounded-xl px-4 py-2 font-bold text-sm bg-white focus:outline-none focus:border-bk-orange"
        />
        <input
          name="q"
          defaultValue={q}
          placeholder="Search title or author..."
          className="flex-1 min-w-[200px] border-2 border-orange-200 rounded-xl px-4 py-2 font-bold text-sm bg-white focus:outline-none focus:border-bk-orange"
        />
        <select
          name="type"
          defaultValue={type}
          className="border-2 border-orange-200 rounded-xl px-3 py-2 font-bold text-sm bg-white focus:outline-none"
        >
          <option value="all">All</option>
          <option value="sale">For Sale</option>
          <option value="free">Free Only</option>
        </select>
        <button
          type="submit"
          className="bg-bk-orange text-white px-6 py-2 rounded-xl font-extrabold text-sm shadow-[0_3px_0_#c2410c]"
        >
          Search
        </button>
      </form>

      {listings.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
          {listings.map(l => <BookCard key={l.id} listing={l}/>)}
        </div>
      ) : (
        <div className="text-center py-24 text-gray-400 font-bold">
          <div className="text-5xl mb-4">📭</div>
          <p className="mb-4">No books found. Try a different city or search term.</p>
          <Link href="/post" className="bg-bk-orange text-white px-6 py-2.5 rounded-full font-extrabold text-sm shadow-[0_3px_0_#c2410c]">
            Post the first one →
          </Link>
        </div>
      )}
    </div>
  )
}
