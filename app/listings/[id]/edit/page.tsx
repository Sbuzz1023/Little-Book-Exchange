import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import PostForm from '@/app/post/PostForm'
import { updateListing } from '@/app/post/actions'

export default async function EditListingPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { error?: string }
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/auth/signin?redirect=/listings/${params.id}/edit`)

  const { data: listing } = await supabase.from('listings').select('*').eq('id', params.id).single()
  if (!listing) notFound()
  if (listing.user_id !== user.id) redirect(`/listings/${params.id}`)

  let bundleBooks: { title: string; author: string; ol_work_key: string | null; cover_url: string | null }[] = []
  if (listing.is_bundle) {
    const { data: books } = await supabase
      .from('listing_books').select('title, author, ol_work_key, cover_url').eq('listing_id', listing.id).order('position', { ascending: true })
    bundleBooks = books ?? []
  }

  return (
    <div className="home-v2">
      <div className="wrap" style={{ maxWidth: 680 }}>
        <div className="pf-page-head">
          <h1>Edit Listing</h1>
          <p className="sub">
            Update the details for <b style={{ color: 'var(--ink)' }}>{listing.title}</b>
          </p>
        </div>
        <PostForm
          action={updateListing.bind(null, listing.id)}
          submitLabel="Save Changes"
          error={searchParams.error ? decodeURIComponent(searchParams.error) : undefined}
          initialValues={{
            title: listing.title,
            author: listing.author,
            condition: listing.condition,
            genre: listing.genre ?? 'Fiction',
            format: listing.format ?? 'Paperback',
            description: listing.description,
            pickup_description: listing.pickup_description,
            photo_url: listing.photo_url,
            photo_url_2: listing.photo_url_2,
            photo_url_3: listing.photo_url_3,
            is_bundle: listing.is_bundle ?? false,
            bundle_name: listing.bundle_name,
            books: bundleBooks,
            ol_work_key: listing.ol_work_key,
            cover_url: listing.cover_url,
            isbn: listing.isbn,
          }}
        />
      </div>
    </div>
  )
}
