import { describe, it, expect } from 'vitest'
import { normalizeSearchResults, isValidCoverUrl, mapSubjectsToGenre } from './openLibrary'

describe('normalizeSearchResults', () => {
  it('maps a full Open Library doc to a BookSuggestion', () => {
    const result = normalizeSearchResults([{
      title: 'Dune',
      author_name: ['Frank Herbert'],
      first_publish_year: 1965,
      isbn: ['9780441013593', '0441013597'],
      cover_i: 12345,
      key: '/works/OL893415W',
      subject: ['Science Fiction'],
    }])
    expect(result).toEqual([{
      title: 'Dune',
      author: 'Frank Herbert',
      year: 1965,
      isbn: '9780441013593',
      coverUrl: 'https://covers.openlibrary.org/b/id/12345-M.jpg',
      workKey: '/works/OL893415W',
      genre: 'Sci-Fi',
    }])
  })

  it('defaults author to an empty string when author_name is missing', () => {
    const result = normalizeSearchResults([{ title: 'Anonymous Work', key: '/works/OL1W' }])
    expect(result[0].author).toBe('')
  })

  it('defaults year, isbn, and genre to null when missing', () => {
    const result = normalizeSearchResults([{ title: 'Dune', key: '/works/OL1W' }])
    expect(result[0].year).toBeNull()
    expect(result[0].isbn).toBeNull()
    expect(result[0].genre).toBeNull()
  })

  it('defaults coverUrl to null when cover_i is missing', () => {
    const result = normalizeSearchResults([{ title: 'Dune', key: '/works/OL1W' }])
    expect(result[0].coverUrl).toBeNull()
  })

  it('drops a doc missing a title', () => {
    const result = normalizeSearchResults([{ key: '/works/OL1W' } as any])
    expect(result).toEqual([])
  })

  it('drops a doc missing a key', () => {
    const result = normalizeSearchResults([{ title: 'Dune' } as any])
    expect(result).toEqual([])
  })

  it('maps multiple docs in order', () => {
    const result = normalizeSearchResults([
      { title: 'Dune', key: '/works/OL1W' },
      { title: 'Dune Messiah', key: '/works/OL2W' },
    ])
    expect(result.map(r => r.title)).toEqual(['Dune', 'Dune Messiah'])
  })
})

describe('isValidCoverUrl', () => {
  it('accepts a real Open Library cover URL', () => {
    expect(isValidCoverUrl('https://covers.openlibrary.org/b/id/12345-M.jpg')).toBe(true)
    expect(isValidCoverUrl('https://covers.openlibrary.org/b/id/1-S.jpg')).toBe(true)
    expect(isValidCoverUrl('https://covers.openlibrary.org/b/id/999999-L.jpg')).toBe(true)
  })

  it('rejects a URL on a different host', () => {
    expect(isValidCoverUrl('https://evil.example.com/b/id/12345-M.jpg')).toBe(false)
  })

  it('rejects a URL with a different path shape', () => {
    expect(isValidCoverUrl('https://covers.openlibrary.org/b/isbn/9780441013593-M.jpg')).toBe(false)
  })

  it('rejects a non-URL string', () => {
    expect(isValidCoverUrl('not a url')).toBe(false)
  })
})

describe('mapSubjectsToGenre', () => {
  it('maps Children\'s subjects', () => {
    expect(mapSubjectsToGenre(['Juvenile fiction', 'Picture books'])).toBe("Children's")
  })

  it('maps Mystery subjects', () => {
    expect(mapSubjectsToGenre(['Detective and mystery stories'])).toBe('Mystery')
  })

  it('maps Sci-Fi subjects ahead of the generic Fiction match', () => {
    // Real Open Library data for "Children of Dune" includes both "Fiction" and
    // "Science Fiction" — Sci-Fi must win, not the generic Fiction bucket.
    expect(mapSubjectsToGenre(['Fiction', 'Science Fiction', 'American literature'])).toBe('Sci-Fi')
  })

  it('maps Romance subjects', () => {
    expect(mapSubjectsToGenre(['Romance', 'Love stories'])).toBe('Romance')
  })

  it('maps Biography subjects ahead of a co-occurring History subject', () => {
    // Real Open Library data for "Steve Jobs" (Walter Isaacson) includes both
    // "History" and "Biography" — Biography must win regardless of array order.
    expect(mapSubjectsToGenre(['History', 'Biography', 'Businesspeople'])).toBe('Biography')
  })

  it('maps Self-Help subjects', () => {
    expect(mapSubjectsToGenre(['Self-help techniques', 'Personal growth'])).toBe('Self-Help')
  })

  it('maps Cooking subjects', () => {
    expect(mapSubjectsToGenre(['Cooking', 'Cookbooks'])).toBe('Cooking')
  })

  it('maps Art subjects', () => {
    expect(mapSubjectsToGenre(['Art', 'Design'])).toBe('Art')
  })

  it('maps History subjects', () => {
    expect(mapSubjectsToGenre(['History', 'Historical events'])).toBe('History')
  })

  it('maps Non-Fiction subjects', () => {
    expect(mapSubjectsToGenre(['Non-fiction'])).toBe('Non-Fiction')
  })

  it('maps generic Fiction subjects when nothing more specific matches', () => {
    expect(mapSubjectsToGenre(['Fiction', 'American fiction'])).toBe('Fiction')
  })

  it('returns null when no keyword matches', () => {
    expect(mapSubjectsToGenre(['Reading Level-Grade 9', 'Large type books'])).toBeNull()
  })

  it('returns null for an empty subject list', () => {
    expect(mapSubjectsToGenre([])).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(mapSubjectsToGenre(['SCIENCE FICTION'])).toBe('Sci-Fi')
  })

  it('resolves "historical fiction" to Fiction, not History (regression: History used to be checked before Fiction)', () => {
    expect(mapSubjectsToGenre(['Fiction', 'Historical fiction', 'Novel'])).toBe('Fiction')
  })

  it('resolves explicit Nonfiction tagging correctly even when "art" appears as a substring elsewhere (regression: "Earth sciences" was matching the Art keyword)', () => {
    expect(mapSubjectsToGenre(['Earth sciences', 'Nonfiction', 'Geology'])).toBe('Non-Fiction')
  })

  it('does not match "crime" hiding inside "Crimean" (regression: word-boundary matching)', () => {
    expect(mapSubjectsToGenre(['Crimean War, 1853-1856', 'History'])).toBe('History')
  })

  it('does not match "art" hiding inside "Earth" (regression: word-boundary matching)', () => {
    expect(mapSubjectsToGenre(['Earth sciences', 'Geology'])).toBeNull()
  })

  it('still matches a real, correct Art subject as its own word', () => {
    expect(mapSubjectsToGenre(['Art', 'Painting'])).toBe('Art')
  })

  it('matches plural forms of keywords (e.g. "Arts" for Art, "Detectives" for Mystery)', () => {
    expect(mapSubjectsToGenre(['Decorative arts'])).toBe('Art')
    expect(mapSubjectsToGenre(['Detectives'])).toBe('Mystery')
    expect(mapSubjectsToGenre(['Romances'])).toBe('Romance')
  })

  it('does not match a plural-looking word that merely ends in "s" near an unrelated keyword substring', () => {
    expect(mapSubjectsToGenre(['Parts'])).toBeNull()
    expect(mapSubjectsToGenre(['Starts'])).toBeNull()
  })
})
