import { describe, it, expect, beforeEach } from 'vitest'
import { makeUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribeToken'

describe('unsubscribe token', () => {
  beforeEach(() => {
    process.env.UNSUBSCRIBE_SECRET = 'test-secret'
  })

  it('a token generated for a user verifies for that same user', () => {
    const token = makeUnsubscribeToken('user-1')
    expect(verifyUnsubscribeToken('user-1', token)).toBe(true)
  })

  it('a token does not verify for a different user', () => {
    const token = makeUnsubscribeToken('user-1')
    expect(verifyUnsubscribeToken('user-2', token)).toBe(false)
  })

  it('a garbage token does not verify', () => {
    expect(verifyUnsubscribeToken('user-1', 'not-a-real-token')).toBe(false)
  })
})
