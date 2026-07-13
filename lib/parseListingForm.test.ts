import { describe, it, expect } from 'vitest'
import { parseListingForm } from './parseListingForm'

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
