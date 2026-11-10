import { describe, it, expect, vi, beforeEach } from 'vitest'
import { openAdminChat } from './emailAdmin'

const requireAdminMock = vi.fn()
vi.mock('./libraryLocations', () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}))
vi.mock('@/lib/email/resend', () => ({ sendEmail: vi.fn() }))

let lookupResult: { data: any; error: unknown }
let insertResult: { data: any; error: unknown }

const maybeSingleMock = vi.fn(() => Promise.resolve(lookupResult))
const lookupChain: any = {
  eq: vi.fn(() => lookupChain), order: vi.fn(() => lookupChain), limit: vi.fn(() => lookupChain), maybeSingle: maybeSingleMock,
}
const selectMock = vi.fn(() => lookupChain)
const insertSingleMock = vi.fn(() => Promise.resolve(insertResult))
const insertMock = vi.fn(() => ({ select: () => ({ single: insertSingleMock }) }))
const fromMock = vi.fn(() => ({ select: selectMock, insert: insertMock }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ from: fromMock }),
}))

describe('openAdminChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAdminMock.mockResolvedValue({ ok: true, userId: 'admin-1' })
    lookupResult = { data: null, error: null }
    insertResult = { data: { id: 'new-convo' }, error: null }
  })

  it('rejects a non-admin caller without touching conversations', async () => {
    requireAdminMock.mockResolvedValue({ ok: false, error: 'Not authorized.' })
    expect(await openAdminChat('user-1')).toEqual({ ok: false, error: 'Not authorized.' })
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('returns the existing repliable admin conversation id', async () => {
    lookupResult = { data: { id: 'existing-convo' }, error: null }
    expect(await openAdminChat('user-1')).toEqual({ ok: true, conversationId: 'existing-convo' })
    expect(lookupChain.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(lookupChain.eq).toHaveBeenCalledWith('repliable', true)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('creates a repliable admin conversation when none exists', async () => {
    expect(await openAdminChat('user-1')).toEqual({ ok: true, conversationId: 'new-convo' })
    expect(insertMock).toHaveBeenCalledWith({ type: 'admin', user_id: 'user-1', repliable: true })
  })

  it('returns ok:false when creation fails', async () => {
    insertResult = { data: null, error: { message: 'denied' } }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await openAdminChat('user-1')
    expect(res).toEqual({ ok: false, error: 'Could not open the chat.' })
  })
})
