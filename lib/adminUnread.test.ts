import { describe, it, expect } from 'vitest'
import { hasUnreadMessage, isDisputeUnread } from './adminUnread'

describe('hasUnreadMessage', () => {
  const adminId = 'admin-1'

  it('returns false for an empty message list', () => {
    expect(hasUnreadMessage([], adminId, null)).toBe(false)
  })

  it('returns false when the only messages are from the admin themselves', () => {
    const messages = [{ sender_id: adminId, created_at: '2026-08-01T00:00:00.000Z' }]
    expect(hasUnreadMessage(messages, adminId, null)).toBe(false)
  })

  it('returns true for a message from someone else when never read before', () => {
    const messages = [{ sender_id: 'user-1', created_at: '2026-08-01T00:00:00.000Z' }]
    expect(hasUnreadMessage(messages, adminId, null)).toBe(true)
  })

  it('returns true when a non-admin message is newer than the last-read timestamp', () => {
    const messages = [{ sender_id: 'user-1', created_at: '2026-08-02T00:00:00.000Z' }]
    expect(hasUnreadMessage(messages, adminId, '2026-08-01T00:00:00.000Z')).toBe(true)
  })

  it('returns false when all non-admin messages are at or before the last-read timestamp', () => {
    const messages = [{ sender_id: 'user-1', created_at: '2026-08-01T00:00:00.000Z' }]
    expect(hasUnreadMessage(messages, adminId, '2026-08-01T00:00:00.000Z')).toBe(false)
    expect(hasUnreadMessage(messages, adminId, '2026-08-02T00:00:00.000Z')).toBe(false)
  })

  it('considers the conversation unread if any message qualifies, not just the latest', () => {
    const messages = [
      { sender_id: 'user-1', created_at: '2026-08-01T00:00:00.000Z' },
      { sender_id: adminId, created_at: '2026-08-02T00:00:00.000Z' },
      { sender_id: 'user-1', created_at: '2026-08-03T00:00:00.000Z' },
    ]
    expect(hasUnreadMessage(messages, adminId, '2026-08-02T12:00:00.000Z')).toBe(true)
  })
})

describe('isDisputeUnread', () => {
  it('is unread when open and never marked read', () => {
    expect(isDisputeUnread('open', null)).toBe(true)
  })

  it('is not unread once marked read, even while still open', () => {
    expect(isDisputeUnread('open', '2026-08-01T00:00:00.000Z')).toBe(false)
  })

  it('is never unread once resolved, regardless of read state', () => {
    expect(isDisputeUnread('resolved', null)).toBe(false)
  })

  it('is never unread once closed as unresolved, regardless of read state', () => {
    expect(isDisputeUnread('unresolved', null)).toBe(false)
  })
})
