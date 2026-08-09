export type BookSuggestion = {
  title: string
  author: string
  year: number | null
  isbn: string | null
  coverUrl: string | null
  workKey: string
  genre: string | null
}

export type OpenLibraryDoc = {
  title?: string
  author_name?: string[]
  first_publish_year?: number
  isbn?: string[]
  cover_i?: number
  key?: string
  subject?: string[]
}

const COVER_URL_PATTERN = /^https:\/\/covers\.openlibrary\.org\/b\/id\/\d+-[SML]\.jpg$/

export function isValidCoverUrl(url: string): boolean {
  return COVER_URL_PATTERN.test(url)
}

// Priority-ordered: checked top to bottom, first keyword match wins. Order matters —
// e.g. a book tagged with both "Fiction" and "Science fiction" must resolve to Sci-Fi,
// so Sci-Fi is checked well before the generic Fiction catch-all at the bottom.
const GENRE_KEYWORDS: [string, string[]][] = [
  ["Children's", ['juvenile', "children's stories", 'picture books']],
  ['Mystery', ['mystery', 'detective', 'thriller', 'crime']],
  ['Sci-Fi', ['science fiction', 'fantasy']],
  ['Romance', ['romance', 'love stories']],
  ['Biography', ['biography', 'autobiography']],
  ['Self-Help', ['self-help', 'self help', 'personal growth']],
  ['Cooking', ['cooking', 'cookery', 'cookbooks']],
  ['Art', ['art', 'design', 'photography']],
  ['History', ['history', 'historical']],
  ['Non-Fiction', ['non-fiction', 'nonfiction']],
  ['Fiction', ['fiction']],
]

export function mapSubjectsToGenre(subjects: string[]): string | null {
  const joined = subjects.join(' | ').toLowerCase()
  for (const [genre, keywords] of GENRE_KEYWORDS) {
    if (keywords.some(kw => joined.includes(kw))) return genre
  }
  return null
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
      genre: mapSubjectsToGenre(d.subject ?? []),
    }))
}
