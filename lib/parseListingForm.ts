import { isValidCoverUrl } from './openLibrary'

const DESCRIPTION_MAX_LENGTH = 500

export type ParsedListingForm = {
  title: string
  author: string
  condition: string
  price: number | null
  description: string | null
  genre: string | null
  format: string | null
  pickup_description: string | null
  ol_work_key: string | null
  cover_url: string | null
  isbn: string | null
}

export function parseListingForm(formData: FormData): ParsedListingForm {
  const priceRaw = formData.get('price') as string
  const price = priceRaw && priceRaw.trim() !== '' ? parseFloat(priceRaw) : null
  const rawCoverUrl = (formData.get('cover_url') as string) || ''
  return {
    title:       formData.get('title')       as string,
    author:      formData.get('author')      as string,
    condition:   formData.get('condition')   as string,
    price,
    description: ((formData.get('description') as string) || '').slice(0, DESCRIPTION_MAX_LENGTH) || null,
    genre:       (formData.get('genre')       as string) || null,
    format:      (formData.get('format')      as string) || null,
    pickup_description: (formData.get('pickup_description') as string) || null,
    ol_work_key: (formData.get('ol_work_key') as string) || null,
    cover_url:   isValidCoverUrl(rawCoverUrl) ? rawCoverUrl : null,
    isbn:        (formData.get('isbn') as string) || null,
  }
}

// Books can only be posted from an Open Library match — title/author are never
// freehand, so the one thing worth re-checking server-side (in case a client
// bypasses the form's own disabled-submit gating) is that a match was actually made.
export function validateOpenLibraryMatch(
  main: Pick<ParsedListingForm, 'ol_work_key'>,
  bundleBooks: { ol_work_key: string | null }[],
): string | null {
  if (!main.ol_work_key) return 'Please search and select your book from the results — it can\'t be posted without a match.'
  if (bundleBooks.some(b => !b.ol_work_key)) return 'Every book in the bundle needs to be selected from search results too.'
  return null
}

const MAX_BUNDLE_BOOKS = 20

export function parseBundleBooks(formData: FormData): { title: string; author: string; ol_work_key: string | null; cover_url: string | null }[] {
  const rawCount = parseInt((formData.get('book_rows') as string) || '0', 10)
  const count = Math.min(Number.isFinite(rawCount) ? Math.max(rawCount, 0) : 0, MAX_BUNDLE_BOOKS)

  const books: { title: string; author: string; ol_work_key: string | null; cover_url: string | null }[] = []
  for (let i = 1; i <= count; i++) {
    const title = ((formData.get(`book_title_${i}`) as string) || '').trim()
    const author = ((formData.get(`book_author_${i}`) as string) || '').trim()
    if (title === '' && author === '') continue
    const rawCoverUrl = (formData.get(`book_cover_url_${i}`) as string) || ''
    books.push({
      title,
      author,
      ol_work_key: (formData.get(`book_ol_work_key_${i}`) as string) || null,
      cover_url:   isValidCoverUrl(rawCoverUrl) ? rawCoverUrl : null,
    })
  }
  return books
}
