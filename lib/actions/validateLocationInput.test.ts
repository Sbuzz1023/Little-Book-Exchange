import { describe, it, expect } from 'vitest'
import { validateLocationInput } from './validateLocationInput'

const base = {
  name: 'Corner Street LFL',
  type: 'lfl' as const,
  lat: 45.5,
  lng: -122.6,
  street: 'Oak Street',
  city: 'Portland, OR',
  description: '',
}

describe('validateLocationInput', () => {
  it('returns null when all required fields are present', () => {
    expect(validateLocationInput(base)).toBeNull()
  })

  it('requires a name', () => {
    expect(validateLocationInput({ ...base, name: '  ' })).toBe('Library name is required.')
  })

  it('requires a street', () => {
    expect(validateLocationInput({ ...base, street: '' })).toBe('Street is required.')
  })

  it('requires a city', () => {
    expect(validateLocationInput({ ...base, city: '' })).toBe('City is required.')
  })

  it('requires a start date for a fair', () => {
    expect(validateLocationInput({ ...base, type: 'fair', endDate: '2026-07-20' })).toBe('Start date is required for a fair.')
  })

  it('requires an end date for a fair', () => {
    expect(validateLocationInput({ ...base, type: 'fair', startDate: '2026-07-18' })).toBe('End date is required for a fair.')
  })

  it('requires end date on or after start date for a fair', () => {
    expect(validateLocationInput({ ...base, type: 'fair', startDate: '2026-07-20', endDate: '2026-07-18' })).toBe('End date must be on or after the start date.')
  })

  it('accepts a valid fair date range', () => {
    expect(validateLocationInput({ ...base, type: 'fair', startDate: '2026-07-18', endDate: '2026-07-20' })).toBeNull()
  })
})
