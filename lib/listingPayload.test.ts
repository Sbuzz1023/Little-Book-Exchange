import { describe, it, expect } from 'vitest'
import { buildListingPayload, listingErrorMessage } from './listingPayload'

function form(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}
const noPhotos = { photo_url: null, photo_url_2: null, photo_url_3: null }

describe('buildListingPayload', () => {
  it('builds a single-book payload with photos and no books', () => {
    const { listing, books } = buildListingPayload(
      form({ title: 'Dune', author: 'Frank Herbert', condition: 'Good', ol_work_key: '/works/OL1W' }),
      { ...noPhotos, photo_url: 'https://x/p.jpg' },
    )
    expect(listing).toMatchObject({ title: 'Dune', author: 'Frank Herbert', condition: 'Good', ol_work_key: '/works/OL1W', photo_url: 'https://x/p.jpg', is_bundle: false, bundle_name: null })
    expect(books).toEqual([])
  })

  it('includes bundle books and a trimmed bundle name for a bundle', () => {
    const { listing, books } = buildListingPayload(form({
      title: 'Dune', author: 'Frank Herbert', condition: 'Good', ol_work_key: '/works/OL1W',
      is_bundle: 'true', bundle_name: '  Sci-fi pack ', book_rows: '1',
      book_title_1: 'Hyperion', book_author_1: 'Dan Simmons', book_ol_work_key_1: '/works/OL2W',
    }), noPhotos)
    expect(listing).toMatchObject({ is_bundle: true, bundle_name: 'Sci-fi pack' })
    expect(books).toEqual([{ title: 'Hyperion', author: 'Dan Simmons', ol_work_key: '/works/OL2W', cover_url: null }])
  })
})

describe('listingErrorMessage', () => {
  it('explains each known code and falls back for unknown ones', () => {
    expect(listingErrorMessage('needs_match')).toMatch(/select your book/)
    expect(listingErrorMessage('pending_request')).toMatch(/pending purchase request/)
    expect(listingErrorMessage('sold')).toMatch(/already been sold/)
    expect(listingErrorMessage('???')).toBe('Something went wrong. Please try again.')
  })
})
