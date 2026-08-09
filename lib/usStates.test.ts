import { describe, it, expect } from 'vitest'
import { US_STATES, isValidStateCode, resolveStateCode } from './usStates'

describe('US_STATES', () => {
  it('has 50 states plus the District of Columbia', () => {
    expect(US_STATES).toHaveLength(51)
  })

  it('has a unique 2-letter uppercase code for every entry', () => {
    const codes = US_STATES.map(s => s.code)
    expect(new Set(codes).size).toBe(codes.length)
    codes.forEach(code => expect(code).toMatch(/^[A-Z]{2}$/))
  })

  it('is sorted alphabetically by name', () => {
    const names = US_STATES.map(s => s.name)
    const sorted = [...names].sort((a, b) => a.localeCompare(b))
    expect(names).toEqual(sorted)
  })

  it('includes California mapped to CA and Illinois mapped to IL', () => {
    expect(US_STATES.find(s => s.name === 'California')).toEqual({ code: 'CA', name: 'California' })
    expect(US_STATES.find(s => s.name === 'Illinois')).toEqual({ code: 'IL', name: 'Illinois' })
  })

  it('includes the District of Columbia mapped to DC', () => {
    expect(US_STATES.find(s => s.name === 'District of Columbia')).toEqual({ code: 'DC', name: 'District of Columbia' })
  })
})

describe('isValidStateCode', () => {
  it('returns true for a valid state code', () => {
    expect(isValidStateCode('CA')).toBe(true)
  })

  it('returns true for DC', () => {
    expect(isValidStateCode('DC')).toBe(true)
  })

  it('returns false for an empty string', () => {
    expect(isValidStateCode('')).toBe(false)
  })

  it('returns false for a lowercase code', () => {
    expect(isValidStateCode('ca')).toBe(false)
  })

  it('returns false for a full state name', () => {
    expect(isValidStateCode('California')).toBe(false)
  })

  it('returns false for a two-letter code that is not a real state', () => {
    expect(isValidStateCode('ZZ')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isValidStateCode(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isValidStateCode(undefined)).toBe(false)
  })
})

describe('resolveStateCode', () => {
  it('returns the code unchanged when given a valid code', () => {
    expect(resolveStateCode('IL')).toBe('IL')
  })

  it('resolves a full state name to its code', () => {
    expect(resolveStateCode('Illinois')).toBe('IL')
  })

  it('resolves a full state name case-insensitively', () => {
    expect(resolveStateCode('illinois')).toBe('IL')
  })

  it('resolves District of Columbia to DC', () => {
    expect(resolveStateCode('District of Columbia')).toBe('DC')
  })

  it('returns empty string for an unrecognized value', () => {
    expect(resolveStateCode('Nowhere')).toBe('')
  })

  it('returns empty string for a two-letter code that is not a real state', () => {
    expect(resolveStateCode('ZZ')).toBe('')
  })

  it('returns empty string for empty/null/undefined input', () => {
    expect(resolveStateCode('')).toBe('')
    expect(resolveStateCode(null)).toBe('')
    expect(resolveStateCode(undefined)).toBe('')
  })
})
