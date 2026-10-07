import { describe, it, expect } from 'vitest'
import { formatPickupAvailability, sellerPickupReminder } from './formatPickupAvailability'

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

describe('sellerPickupReminder', () => {
  it('asks the seller to have the book ready when they chose Ready now', () => {
    expect(sellerPickupReminder({ mode: 'anytime' })).toBe('Make sure your book is ready for pickup.')
  })

  it('gives the start of a time window as the ready-by time', () => {
    expect(sellerPickupReminder({ mode: 'window', date: '2026-10-01', timeStart: '15:00', timeEnd: '17:00' }))
      .toBe('Make sure your book is ready by Thu, Oct 1 at 3:00 PM.')
  })

  it('gives the after-time as the ready-by time', () => {
    expect(sellerPickupReminder({ mode: 'after', date: '2026-10-01', timeStart: '09:30' }))
      .toBe('Make sure your book is ready by Thu, Oct 1 at 9:30 AM.')
  })

  it('falls back to the general reminder when no usable time was saved', () => {
    expect(sellerPickupReminder({ mode: null })).toBe('Make sure your book is ready for pickup.')
    expect(sellerPickupReminder({ mode: 'window', date: null, timeStart: '15:00' })).toBe('Make sure your book is ready for pickup.')
    expect(sellerPickupReminder({ mode: 'after', date: '2026-10-01', timeStart: 'soon' })).toBe('Make sure your book is ready for pickup.')
  })
})

// Supabase returns Postgres `time` columns (confirmed_pickup_time_*) as
// 'HH:MM:SS'; the popup's <input type="time"> sends 'HH:MM'. Both must work,
// or the buyer's card silently loses its "When" line.
describe('times as stored in the database (HH:MM:SS)', () => {
  it('formats a time window read back from the database', () => {
    expect(formatPickupAvailability({ mode: 'window', date: '2026-10-10', timeStart: '15:00:00', timeEnd: '17:30:00' }))
      .toBe('Sat, Oct 10 · 3:00 PM–5:30 PM')
  })

  it('formats an "after" time read back from the database', () => {
    expect(formatPickupAvailability({ mode: 'after', date: '2026-10-10', timeStart: '09:15:00' }))
      .toBe('Sat, Oct 10 · after 9:15 AM')
  })

  it("gives the seller the time-specific reminder from the database's format", () => {
    expect(sellerPickupReminder({ mode: 'window', date: '2026-10-10', timeStart: '15:00:00', timeEnd: '17:00:00' }))
      .toBe('Make sure your book is ready by Sat, Oct 10 at 3:00 PM.')
  })

  it('still rejects malformed times', () => {
    expect(formatPickupAvailability({ mode: 'after', date: '2026-10-10', timeStart: '15:00:0' })).toBeNull()
    expect(formatPickupAvailability({ mode: 'after', date: '2026-10-10', timeStart: '25:00:00' })).toBeNull()
  })
})
