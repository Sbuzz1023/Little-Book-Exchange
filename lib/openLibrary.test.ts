import { describe, it, expect } from 'vitest'
import { normalizeSearchResults, isValidCoverUrl } from './openLibrary'

describe('normalizeSearchResults', () => {
  it('maps a full Open Library doc to a BookSuggestion', () => {
    const result = normalizeSearchResults([{
      title: 'Dune',
      author_name: ['Frank Herbert'],
      first_publish_year: 1965,
      isbn: ['9780441013593', '0441013597'],
      cover_i: 12345,
      key: '/works/OL893415W',
    }])
    expect(result).toEqual([{
      title: 'Dune',
      author: 'Frank Herbert',
      year: 1965,
      isbn: '9780441013593',
      coverUrl: 'https://covers.openlibrary.org/b/id/12345-M.jpg',
      workKey: '/works/OL893415W',
    }])
  })

  it('defaults author to an empty string when author_name is missing', () => {
    const result = normalizeSearchResults([{ title: 'Anonymous Work', key: '/works/OL1W' }])
    expect(result[0].author).toBe('')
  })

  it('defaults year and isbn to null when missing', () => {
    const result = normalizeSearchResults([{ title: 'Dune', key: '/works/OL1W' }])
    expect(result[0].year).toBeNull()
    expect(result[0].isbn).toBeNull()
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
