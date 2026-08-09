export type BookSuggestion = {
  title: string
  author: string
  year: number | null
  isbn: string | null
  coverUrl: string | null
  workKey: string
}

export type OpenLibraryDoc = {
  title?: string
  author_name?: string[]
  first_publish_year?: number
  isbn?: string[]
  cover_i?: number
  key?: string
}

const COVER_URL_PATTERN = /^https:\/\/covers\.openlibrary\.org\/b\/id\/\d+-[SML]\.jpg$/

export function isValidCoverUrl(url: string): boolean {
  return COVER_URL_PATTERN.test(url)
}

export function normalizeSearchResults(docs: OpenLibraryDoc[]): BookSuggestion[] {
  return docs
    .filter((d): d is OpenLibraryDoc & { title: string; key: string } => !!d.title && !!d.key)
    .map(d => ({
      title: d.title,
      author: d.author_name?.[0] ?? '',
      year: d.first_publish_year ?? null,
      isbn: d.isbn?.[0] ?? null,
      coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
      workKey: d.key,
    }))
}
