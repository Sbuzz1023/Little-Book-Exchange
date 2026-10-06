import { describe, it, expect, vi, beforeEach } from 'vitest'
import { markCreditsSeen } from './creditsSeen'

const ltMock = vi.fn(() => Promise.resolve({ error: null }))
const eqMock = vi.fn(() => ({ lt: ltMock }))
const updateMock = vi.fn((_v: Record<string, unknown>) => ({ eq: eqMock }))
const fromMock = vi.fn((_t: string) => ({ update: updateMock }))
let user: { id: string } | null = { id: 'user-1' }
const getUserMock = vi.fn(() => Promise.resolve({ data: { user } }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: getUserMock }, from: fromMock }),
}))

describe('markCreditsSeen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    user = { id: 'user-1' }
  })

  it("moves the caller's credits_seen_at forward to the given time only", async () => {
    await markCreditsSeen('2026-10-06T10:00:05.123456+00:00')
    expect(fromMock).toHaveBeenCalledWith('profiles')
    expect(updateMock).toHaveBeenCalledWith({ credits_seen_at: '2026-10-06T10:00:05.123456+00:00' })
    expect(eqMock).toHaveBeenCalledWith('id', 'user-1')
    expect(ltMock).toHaveBeenCalledWith('credits_seen_at', '2026-10-06T10:00:05.123456+00:00')
  })

  it('does nothing when signed out', async () => {
    user = null
    await markCreditsSeen('2026-10-06T10:00:00Z')
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('ignores a value that is not a timestamp', async () => {
    await markCreditsSeen('not a date')
    expect(getUserMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('never throws, even if Supabase does', async () => {
    getUserMock.mockImplementationOnce(() => Promise.reject(new Error('down')))
    await expect(markCreditsSeen('2026-10-06T10:00:00Z')).resolves.toBeUndefined()
  })
})
