import { describe, it, expect, vi, beforeEach } from 'vitest'
import { openAdminChat, getEmailHistory } from './emailAdmin'

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

describe('getEmailHistory', () => {
  let historyResult: { data: any; error: unknown }
  const historyChain: any = {}
  for (const m of ['order', 'limit', 'or', 'lt']) historyChain[m] = vi.fn(() => historyChain)
  historyChain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(historyResult).then(resolve, reject)

  const makeRows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, sent_at: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z` }))

  beforeEach(() => {
    vi.clearAllMocks()
    requireAdminMock.mockResolvedValue({ ok: true, userId: 'admin-1' })
    historyResult = { data: [], error: null }
    selectMock.mockReturnValueOnce(historyChain)
  })

  it('rejects a non-admin caller without querying', async () => {
    requireAdminMock.mockResolvedValue({ ok: false, error: 'Not authorized.' })
    expect(await getEmailHistory()).toEqual({ ok: false, error: 'Not authorized.' })
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('selects only the allowed columns, newest first, fetching 51', async () => {
    await getEmailHistory()
    expect(fromMock).toHaveBeenCalledWith('email_log')
    expect(selectMock).toHaveBeenCalledWith('id, kind, recipient_email, subject, status, error, sent_at, profiles(username)')
    expect(historyChain.order).toHaveBeenCalledWith('sent_at', { ascending: false })
    expect(historyChain.limit).toHaveBeenCalledWith(51)
    expect(historyChain.or).not.toHaveBeenCalled()
    expect(historyChain.lt).not.toHaveBeenCalled()
  })

  it('returns 50 rows with hasMore when 51 come back', async () => {
    historyResult = { data: makeRows(51), error: null }
    const res = await getEmailHistory()
    expect(res.ok).toBe(true)
    expect(res.rows).toHaveLength(50)
    expect(res.hasMore).toBe(true)
  })

  it('reports hasMore false when 50 or fewer come back', async () => {
    historyResult = { data: makeRows(50), error: null }
    const res = await getEmailHistory()
    expect(res.rows).toHaveLength(50)
    expect(res.hasMore).toBe(false)
  })

  it('applies an escaped or-filter for search', async () => {
    await getEmailHistory({ search: '  a,b%_"x ' })
    expect(historyChain.or).toHaveBeenCalledWith(
      'recipient_email.ilike."%a,b\\\\%\\\\_\\"x%",subject.ilike."%a,b\\\\%\\\\_\\"x%"'
    )
  })

  it('ignores a blank search', async () => {
    await getEmailHistory({ search: '   ' })
    expect(historyChain.or).not.toHaveBeenCalled()
  })

  it('applies the before cursor with lt', async () => {
    await getEmailHistory({ before: '2026-01-01T00:00:00Z' })
    expect(historyChain.lt).toHaveBeenCalledWith('sent_at', '2026-01-01T00:00:00Z')
  })

  it('returns the query error', async () => {
    historyResult = { data: null, error: { message: 'boom' } }
    expect(await getEmailHistory()).toEqual({ ok: false, error: 'boom' })
  })
})
