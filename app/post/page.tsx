import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

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
    redirect('/auth/signin?redirect=/post')
  }

  async function createListing(formData: FormData) {
    'use server'
    const { createClient: createSrv } = await import('@/lib/supabase/server')
    const { redirect: redir } = await import('next/navigation')
    const supabase = createSrv()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redir('/auth/signin')

    const { data: prof } = await supabase.from('profiles').select('city').eq('id', user!.id).single()

    let photo_url: string | null = null
    const file = formData.get('photo') as File
    if (file && file.size > 0) {
      const ext = file.name.split('.').pop()
      const path = `${user!.id}/${Date.now()}.${ext}`
      const { data: upload } = await supabase.storage.from('book-photos').upload(path, file)
      if (upload) {
        const { data: { publicUrl } } = supabase.storage.from('book-photos').getPublicUrl(path)
        photo_url = publicUrl
      }
    }

    const priceRaw = formData.get('price') as string
    const price = priceRaw && priceRaw.trim() !== '' ? parseFloat(priceRaw) : null

    const { data: listing, error } = await supabase.from('listings').insert({
      user_id: user!.id,
      title: formData.get('title') as string,
      author: formData.get('author') as string,
      condition: formData.get('condition') as string,
      price,
      description: (formData.get('description') as string) || null,
      photo_url,
      city: prof?.city ?? '',
    }).select('id').single()

    if (error || !listing) redir('/post?error=Failed to post listing')
    redir(`/listings/${listing!.id}`)
  }

  return (
    <div className="max-w-xl mx-auto px-8 py-12">
      <h1 className="font-display text-3xl text-bk-orange mb-2">Post a Book</h1>
      <p className="text-gray-400 font-semibold mb-8">
        Share a book with your neighbors in <strong className="text-gray-600">{profile?.city}</strong>.
      </p>

      {searchParams.error && (
        <div className="bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-red-700 font-bold text-sm mb-6">
          {decodeURIComponent(searchParams.error)}
        </div>
      )}

      <form
        action={createListing}
        className="bg-white rounded-3xl p-8 border-2 border-gray-100 shadow-[0_8px_0_#e5e7eb] space-y-5"
        encType="multipart/form-data"
      >
        <div>
          <label className="block text-sm font-extrabold text-gray-700 mb-1.5">Book Title *</label>
          <input
            name="title"
            required
            placeholder="e.g. The Great Gatsby"
            className="w-full border-2 border-orange-200 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-bk-orange"
          />
        </div>
        <div>
          <label className="block text-sm font-extrabold text-gray-700 mb-1.5">Author *</label>
          <input
            name="author"
            required
            placeholder="e.g. F. Scott Fitzgerald"
            className="w-full border-2 border-orange-200 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-bk-orange"
          />
        </div>
        <div>
          <label className="block text-sm font-extrabold text-gray-700 mb-1.5">Condition *</label>
          <select
            name="condition"
            required
            className="w-full border-2 border-orange-200 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-bk-orange bg-white"
          >
            <option value="good">Good</option>
            <option value="fair">Fair</option>
            <option value="well-loved">Well-Loved</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-extrabold text-gray-700 mb-1.5">Price (leave blank = Free)</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-gray-400">$</span>
            <input
              name="price"
              type="number"
              min="0"
              step="0.50"
              placeholder="0.00"
              className="w-full border-2 border-orange-200 rounded-xl pl-8 pr-4 py-3 font-bold focus:outline-none focus:border-bk-orange"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-extrabold text-gray-700 mb-1.5">Description (optional)</label>
          <textarea
            name="description"
            rows={3}
            placeholder="Any notes about the book..."
            className="w-full border-2 border-orange-200 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-bk-orange resize-none"
          />
        </div>
        <div>
          <label className="block text-sm font-extrabold text-gray-700 mb-1.5">Photo (optional)</label>
          <input
            name="photo"
            type="file"
            accept="image/*"
            className="w-full border-2 border-orange-200 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-bk-orange file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-bk-orange file:text-white file:font-bold file:text-sm"
          />
        </div>
        <button
          type="submit"
          className="w-full bg-bk-orange text-white py-3.5 rounded-xl font-extrabold shadow-[0_4px_0_#c2410c] hover:shadow-[0_2px_0_#c2410c] hover:translate-y-0.5 transition-all"
        >
          Post My Book →
        </button>
      </form>
    </div>
  )
}
