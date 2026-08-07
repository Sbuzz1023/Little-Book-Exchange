import { describe, it, expect } from 'vitest'
import { unreadCounts, unreadEntityIds, dashboardAlertTotal, type NotificationRow } from './notifications'

describe('unreadCounts', () => {
  it('returns all zeros for an empty list', () => {
    expect(unreadCounts([])).toEqual({ total: 0, exchanges: 0, tbr: 0, messages: 0 })
  })

  it('buckets purchase_request, purchase_decision, and pickup into "exchanges"', () => {
    const rows: NotificationRow[] = [
      { type: 'purchase_request', entity_id: 'c1' },
      { type: 'purchase_decision', entity_id: 'c2' },
      { type: 'pickup', entity_id: 'c3' },
    ]
    expect(unreadCounts(rows)).toEqual({ total: 3, exchanges: 3, tbr: 0, messages: 0 })
  })

  it('counts tbr_match and message into their own buckets', () => {
    const rows: NotificationRow[] = [
      { type: 'tbr_match', entity_id: 't1' },
      { type: 'tbr_match', entity_id: 't2' },
      { type: 'message', entity_id: 'c1' },
    ]
    expect(unreadCounts(rows)).toEqual({ total: 3, exchanges: 0, tbr: 2, messages: 1 })
  })

  it('total is the sum across all buckets regardless of type mix', () => {
    const rows: NotificationRow[] = [
      { type: 'purchase_request', entity_id: 'c1' },
      { type: 'tbr_match', entity_id: 't1' },
      { type: 'message', entity_id: 'c2' },
    ]
    expect(unreadCounts(rows).total).toBe(3)
  })
})

describe('unreadEntityIds', () => {
  it('returns entity_id values only for the requested types', () => {
    const rows: NotificationRow[] = [
      { type: 'purchase_decision', entity_id: 'c1' },
      { type: 'pickup', entity_id: 'c2' },
      { type: 'message', entity_id: 'c3' },
    ]
    expect(unreadEntityIds(rows, ['purchase_decision', 'pickup'])).toEqual(['c1', 'c2'])
  })

  it('returns an empty array when no rows match the requested types', () => {
    const rows: NotificationRow[] = [{ type: 'message', entity_id: 'c1' }]
    expect(unreadEntityIds(rows, ['tbr_match'])).toEqual([])
  })

  it('returns an empty array for an empty input list', () => {
    expect(unreadEntityIds([], ['message'])).toEqual([])
  })
})

describe('dashboardAlertTotal', () => {
  it('adds a wallet alert to the notification count when the onboarding bonus is unclaimed', () => {
    expect(dashboardAlertTotal(2, false)).toBe(3)
  })

  it('does not add a wallet alert when the onboarding bonus is already claimed', () => {
    expect(dashboardAlertTotal(2, true)).toBe(2)
  })

  it('treats a null/undefined claimed flag as unclaimed, matching the Wallet tab badge', () => {
    expect(dashboardAlertTotal(0, null)).toBe(1)
    expect(dashboardAlertTotal(0, undefined)).toBe(1)
  })

  it('returns the notification count alone when there are no notifications and the bonus is claimed', () => {
    expect(dashboardAlertTotal(0, true)).toBe(0)
  })
})
