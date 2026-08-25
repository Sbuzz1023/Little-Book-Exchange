import { describe, it, expect } from 'vitest'
import { formatPickupAvailability } from './formatPickupAvailability'

describe('formatPickupAvailability', () => {
  it('returns a ready-now message for anytime mode, ignoring any date/time', () => {
    const msg = formatPickupAvailability({ mode: 'anytime', date: '2026-08-26', timeStart: '15:00', timeEnd: '17:00' })
    expect(msg).toBe('✅ Ready for pickup now')
  })

  it('returns null when mode is missing', () => {
    expect(formatPickupAvailability({ mode: null })).toBeNull()
  })

  it('formats a window as a date plus a start-end time range', () => {
    const msg = formatPickupAvailability({ mode: 'window', date: '2026-08-26', timeStart: '15:00', timeEnd: '17:00' })
    expect(msg).toMatch(/^[A-Z][a-z]{2}, Aug 26 · 3:00 PM–5:00 PM$/)
  })

  it('formats "after" as a date plus a single start time', () => {
    const msg = formatPickupAvailability({ mode: 'after', date: '2026-08-26', timeStart: '17:00' })
    expect(msg).toMatch(/^[A-Z][a-z]{2}, Aug 26 · after 5:00 PM$/)
    expect(msg).not.toContain('–')
  })

  it('does not shift the date across a timezone boundary', () => {
    const msg = formatPickupAvailability({ mode: 'after', date: '2026-01-01', timeStart: '09:00' })
    expect(msg).toContain('Jan 1')
  })

  it('formats midnight and noon correctly', () => {
    expect(formatPickupAvailability({ mode: 'after', date: '2026-08-26', timeStart: '00:00' })).toContain('12:00 AM')
    expect(formatPickupAvailability({ mode: 'after', date: '2026-08-26', timeStart: '12:00' })).toContain('12:00 PM')
  })

  it('pads single-digit minutes', () => {
    expect(formatPickupAvailability({ mode: 'after', date: '2026-08-26', timeStart: '09:05' })).toContain('9:05 AM')
  })

  it('returns null for a window missing an end time', () => {
    const msg = formatPickupAvailability({ mode: 'window', date: '2026-08-26', timeStart: '15:00', timeEnd: null })
    expect(msg).toBeNull()
  })

  it('returns null for "after" missing a date', () => {
    const msg = formatPickupAvailability({ mode: 'after', date: null, timeStart: '15:00' })
    expect(msg).toBeNull()
  })
})
