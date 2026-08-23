import { describe, it, expect } from 'vitest'
import { buildDirectionsUrl } from './mapsLink'

describe('buildDirectionsUrl', () => {
  it('builds a Google Maps directions URL from address, unit, city, and state', () => {
    const url = buildDirectionsUrl({ address: '555 Oak Ave', addressUnit: 'Unit 3', city: 'Oak Park', state: 'IL' })
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&destination=555%20Oak%20Ave%20Unit%203%2C%20Oak%20Park%2C%20IL')
  })

  it('omits the unit when there is none', () => {
    const url = buildDirectionsUrl({ address: '555 Oak Ave', addressUnit: '', city: 'Oak Park', state: 'IL' })
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&destination=555%20Oak%20Ave%2C%20Oak%20Park%2C%20IL')
  })

  it('still builds a URL when city/state are missing, using just the address', () => {
    const url = buildDirectionsUrl({ address: '555 Oak Ave', addressUnit: '', city: '', state: '' })
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&destination=555%20Oak%20Ave')
  })

  it('returns null when there is no street address to build from', () => {
    expect(buildDirectionsUrl({ address: '', addressUnit: '', city: 'Oak Park', state: 'IL' })).toBeNull()
    expect(buildDirectionsUrl({ address: '   ', addressUnit: '', city: 'Oak Park', state: 'IL' })).toBeNull()
  })

  it('URL-encodes special characters in the address', () => {
    const url = buildDirectionsUrl({ address: '#3 Main & 2nd', addressUnit: '', city: '', state: '' })
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&destination=%233%20Main%20%26%202nd')
  })
})
