import { describe, it, expect } from 'vitest'
import { normalizeCity } from './normalizeCity'

describe('normalizeCity', () => {
  it('capitalizes an all-lowercase city', () => {
    expect(normalizeCity('arroyo grande')).toBe('Arroyo Grande')
  })

  it('capitalizes an all-uppercase city', () => {
    expect(normalizeCity('ARROYO GRANDE')).toBe('Arroyo Grande')
  })

  it('fixes only the mistyped word, leaving an already-correct one alone', () => {
    // The real bug this was written for: a phone keyboard capitalizes only
    // the first letter of the field, not each word.
    expect(normalizeCity('Arroyo grande')).toBe('Arroyo Grande')
  })

  it('never touches a word that already has internal/mixed capitalization', () => {
    // Real city names with deliberate internal capitals — re-casing these
    // would make Mapbox-correct data worse, not better.
    expect(normalizeCity('McAllen')).toBe('McAllen')
    expect(normalizeCity('DeKalb')).toBe('DeKalb')
    expect(normalizeCity('LaGrange')).toBe('LaGrange')
  })

  it('trims leading and trailing whitespace', () => {
    expect(normalizeCity('  Chicago  ')).toBe('Chicago')
  })

  it('collapses repeated internal whitespace to a single space', () => {
    expect(normalizeCity('New   York')).toBe('New York')
  })

  it('leaves an empty or blank city as an empty string', () => {
    expect(normalizeCity('')).toBe('')
    expect(normalizeCity('   ')).toBe('')
  })

  it('is idempotent — normalizing an already-normalized city changes nothing', () => {
    expect(normalizeCity('Arroyo Grande')).toBe('Arroyo Grande')
  })
})
