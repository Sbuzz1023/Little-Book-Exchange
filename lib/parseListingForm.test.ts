import { describe, it, expect } from 'vitest'
import { parseListingForm, parseBundleBooks } from './parseListingForm'

function makeFormData(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

describe('parseListingForm', () => {
  it('parses required fields', () => {
    const fd = makeFormData({ title: 'Dune', author: 'Frank Herbert', condition: 'Good', price: '1' })
    const result = parseListingForm(fd)
    expect(result.title).toBe('Dune')
    expect(result.author).toBe('Frank Herbert')
    expect(result.condition).toBe('Good')
    expect(result.price).toBe(1)
  })

  it('defaults price to null when blank', () => {
    const fd = makeFormData({ title: 'Dune', author: 'Frank Herbert', condition: 'Good', price: '' })
    expect(parseListingForm(fd).price).toBeNull()
  })

  it('truncates description to 500 chars', () => {
    const long = 'x'.repeat(600)
    const fd = makeFormData({ title: 'Dune', author: 'Frank Herbert', condition: 'Good', price: '1', description: long })
    expect(parseListingForm(fd).description?.length).toBe(500)
  })

  it('defaults description to null when blank', () => {
    const fd = makeFormData({ title: 'Dune', author: 'Frank Herbert', condition: 'Good', price: '1', description: '' })
    expect(parseListingForm(fd).description).toBeNull()
  })

  it('defaults genre, format, pickup_description to null when absent', () => {
    const fd = makeFormData({ title: 'Dune', author: 'Frank Herbert', condition: 'Good', price: '1' })
    const result = parseListingForm(fd)
    expect(result.genre).toBeNull()
    expect(result.format).toBeNull()
    expect(result.pickup_description).toBeNull()
  })

  it('passes through genre, format, pickup_description when present', () => {
    const fd = makeFormData({
      title: 'Dune', author: 'Frank Herbert', condition: 'Good', price: '1',
      genre: 'Sci-Fi', format: 'Hardcover', pickup_description: 'side gate',
    })
    const result = parseListingForm(fd)
    expect(result.genre).toBe('Sci-Fi')
    expect(result.format).toBe('Hardcover')
    expect(result.pickup_description).toBe('side gate')
  })
})

describe('parseBundleBooks', () => {
  it('returns an empty array when book_rows is absent', () => {
    const fd = makeFormData({})
    expect(parseBundleBooks(fd)).toEqual([])
  })

  it('parses the given number of rows', () => {
    const fd = new FormData()
    fd.set('book_rows', '2')
    fd.set('book_title_1', 'Chamber of Secrets')
    fd.set('book_author_1', 'J.K. Rowling')
    fd.set('book_title_2', 'Prisoner of Azkaban')
    fd.set('book_author_2', 'J.K. Rowling')
    expect(parseBundleBooks(fd)).toEqual([
      { title: 'Chamber of Secrets', author: 'J.K. Rowling', ol_work_key: null, cover_url: null },
      { title: 'Prisoner of Azkaban', author: 'J.K. Rowling', ol_work_key: null, cover_url: null },
    ])
  })

  it('trims whitespace and drops a row where both fields are empty', () => {
    const fd = new FormData()
    fd.set('book_rows', '2')
    fd.set('book_title_1', '  Chamber of Secrets  ')
    fd.set('book_author_1', '  J.K. Rowling  ')
    fd.set('book_title_2', '')
    fd.set('book_author_2', '')
    expect(parseBundleBooks(fd)).toEqual([
      { title: 'Chamber of Secrets', author: 'J.K. Rowling', ol_work_key: null, cover_url: null },
    ])
  })

  it('keeps a row if only one of the two fields is filled in', () => {
    const fd = new FormData()
    fd.set('book_rows', '1')
    fd.set('book_title_1', 'Chamber of Secrets')
    fd.set('book_author_1', '')
    expect(parseBundleBooks(fd)).toEqual([{ title: 'Chamber of Secrets', author: '', ol_work_key: null, cover_url: null }])
  })

  it('caps at 20 rows regardless of what book_rows claims', () => {
    const fd = new FormData()
    fd.set('book_rows', '25')
    for (let i = 1; i <= 25; i++) {
      fd.set(`book_title_${i}`, `Book ${i}`)
      fd.set(`book_author_${i}`, 'Author')
    }
    expect(parseBundleBooks(fd)).toHaveLength(20)
  })

  it('treats a non-numeric book_rows as zero', () => {
    const fd = new FormData()
    fd.set('book_rows', 'not-a-number')
    fd.set('book_title_1', 'Chamber of Secrets')
    fd.set('book_author_1', 'J.K. Rowling')
    expect(parseBundleBooks(fd)).toEqual([])
  })
})

describe('parseListingForm — Open Library fields', () => {
  it('parses ol_work_key and cover_url when present', () => {
    const fd = makeFormData({
      title: 'Dune', author: 'Frank Herbert', condition: 'Good', price: '1',
      ol_work_key: '/works/OL893415W', cover_url: 'https://covers.openlibrary.org/b/id/1-M.jpg',
    })
    const result = parseListingForm(fd)
    expect(result.ol_work_key).toBe('/works/OL893415W')
    expect(result.cover_url).toBe('https://covers.openlibrary.org/b/id/1-M.jpg')
  })

  it('defaults ol_work_key and cover_url to null when absent or blank', () => {
    const fd = makeFormData({ title: 'Dune', author: 'Frank Herbert', condition: 'Good', price: '1' })
    const result = parseListingForm(fd)
    expect(result.ol_work_key).toBeNull()
    expect(result.cover_url).toBeNull()
  })
})

describe('parseBundleBooks — Open Library fields', () => {
  it('parses ol_work_key and cover_url per row', () => {
    const fd = new FormData()
    fd.set('book_rows', '1')
    fd.set('book_title_1', 'Chamber of Secrets')
    fd.set('book_author_1', 'J.K. Rowling')
    fd.set('book_ol_work_key_1', '/works/OL82586W')
    fd.set('book_cover_url_1', 'https://covers.openlibrary.org/b/id/2-M.jpg')
    expect(parseBundleBooks(fd)).toEqual([{
      title: 'Chamber of Secrets', author: 'J.K. Rowling',
      ol_work_key: '/works/OL82586W', cover_url: 'https://covers.openlibrary.org/b/id/2-M.jpg',
    }])
  })

  it('defaults a row\'s ol_work_key and cover_url to null when absent', () => {
    const fd = new FormData()
    fd.set('book_rows', '1')
    fd.set('book_title_1', 'Chamber of Secrets')
    fd.set('book_author_1', 'J.K. Rowling')
    const result = parseBundleBooks(fd)
    expect(result[0].ol_work_key).toBeNull()
    expect(result[0].cover_url).toBeNull()
  })
})
