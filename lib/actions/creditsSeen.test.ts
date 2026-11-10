import { describe, it, expect, vi, beforeEach } from 'vitest'
import { markCreditsSeen } from './creditsSeen'

const rpcMock = vi.fn((_fn: string, _args: Record<string, unknown>) => Promise.resolve({ data: null, error: null }))
let user: { id: string } | null = { id: 'user-1' }
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user } }) },
    rpc: (fn: string, args: Record<string, unknown>) => rpcMock(fn, args),
  }),
}))

describe('markCreditsSeen', () => {
  beforeEach(() => { rpcMock.mockClear(); user = { id: 'user-1' } })

  it("moves the caller's credits_seen_at forward to the given time", async () => {
    await markCreditsSeen('2026-11-09T10:00:00.000Z')
    expect(rpcMock).toHaveBeenCalledWith('mark_credits_seen', { p_up_to: '2026-11-09T10:00:00.000Z' })
  })

  it('does nothing when signed out', async () => {
    user = null
    await markCreditsSeen('2026-11-09T10:00:00.000Z')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('ignores a value that is not a timestamp', async () => {
    await markCreditsSeen('not a date')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('never throws, even if Supabase does', async () => {
    rpcMock.mockImplementationOnce(() => { throw new Error('boom') })
    await expect(markCreditsSeen('2026-11-09T10:00:00.000Z')).resolves.toBeUndefined()
  })
})
