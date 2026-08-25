import { describe, it, expect } from 'vitest'
import { buildRecentActivity, type RecentActivityEvent } from './recentActivity'

const NOW = new Date('2026-08-20T12:00:00.000Z')

describe('buildRecentActivity', () => {
  it('sorts events most-recent-first regardless of input order', () => {
    const events: RecentActivityEvent[] = [
      { type: 'signup', text: 'A joined', timestamp: '2026-08-20T10:00:00.000Z' },
      { type: 'post',   text: 'B posted', timestamp: '2026-08-20T11:00:00.000Z' },
      { type: 'trade',  text: 'C traded', timestamp: '2026-08-20T09:00:00.000Z' },
    ]
    const result = buildRecentActivity(events, 10, NOW)
    expect(result.map(r => r.text)).toEqual(['B posted', 'A joined', 'C traded'])
  })

  it('limits to the requested count, keeping only the most recent', () => {
    const events: RecentActivityEvent[] = Array.from({ length: 5 }, (_, i) => ({
      type: 'signup' as const, text: `event ${i}`, timestamp: `2026-08-${10 + i}T00:00:00.000Z`,
    }))
    const result = buildRecentActivity(events, 2, NOW)
    expect(result).toHaveLength(2)
    expect(result.map(r => r.text)).toEqual(['event 4', 'event 3'])
  })

  it('formats an event from under a minute ago as "just now"', () => {
    const result = buildRecentActivity([{ type: 'post', text: 'x', timestamp: '2026-08-20T11:59:30.000Z' }], 5, NOW)
    expect(result[0].timeAgo).toBe('just now')
  })

  it('formats an event from under an hour ago in minutes', () => {
    const result = buildRecentActivity([{ type: 'post', text: 'x', timestamp: '2026-08-20T11:15:00.000Z' }], 5, NOW)
    expect(result[0].timeAgo).toBe('45m ago')
  })

  it('formats an event from under a day ago in hours', () => {
    const result = buildRecentActivity([{ type: 'post', text: 'x', timestamp: '2026-08-20T05:00:00.000Z' }], 5, NOW)
    expect(result[0].timeAgo).toBe('7h ago')
  })

  it('formats an event from under a week ago in days', () => {
    const result = buildRecentActivity([{ type: 'post', text: 'x', timestamp: '2026-08-17T12:00:00.000Z' }], 5, NOW)
    expect(result[0].timeAgo).toBe('3d ago')
  })

  it('formats an event a week or more ago as a short date', () => {
    const result = buildRecentActivity([{ type: 'post', text: 'x', timestamp: '2026-08-10T12:00:00.000Z' }], 5, NOW)
    expect(result[0].timeAgo).toBe('Aug 10')
  })

  it('preserves the type and text fields unchanged', () => {
    const result = buildRecentActivity([{ type: 'report', text: 'Location report: Capitol Hill LFL', timestamp: '2026-08-20T11:00:00.000Z' }], 5, NOW)
    expect(result[0].type).toBe('report')
    expect(result[0].text).toBe('Location report: Capitol Hill LFL')
  })
})
