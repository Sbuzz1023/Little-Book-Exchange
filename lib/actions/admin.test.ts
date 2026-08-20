import { describe, it, expect, vi, beforeEach } from 'vitest'
import { adminSetDisputeStatus, adminDeleteDispute } from './admin'

const requireAdminMock = vi.fn()
vi.mock('./libraryLocations', () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}))

let selectSingleResult: { data: any; error: unknown }
let updateResult: { error: unknown }
let deleteResult: { error: unknown }

const singleMock = vi.fn(() => Promise.resolve(selectSingleResult))
const selectEqMock = vi.fn(() => ({ single: singleMock }))
const selectMock = vi.fn(() => ({ eq: selectEqMock }))

const updateEqMock = vi.fn(() => Promise.resolve(updateResult))
const updateMock = vi.fn(() => ({ eq: updateEqMock }))

const deleteEqMock = vi.fn(() => Promise.resolve(deleteResult))
const deleteMock = vi.fn(() => ({ eq: deleteEqMock }))

const fromMock = vi.fn(() => ({ select: selectMock, update: updateMock, delete: deleteMock }))
const rpcMock = vi.fn(() => Promise.resolve({ data: null, error: null }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ from: fromMock, rpc: rpcMock }),
}))

describe('adminSetDisputeStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAdminMock.mockResolvedValue({ ok: true, userId: 'admin-1' })
    selectSingleResult = { data: { conversation_id: 'convo-1' }, error: null }
    updateResult = { error: null }
  })

  it('rejects a non-admin caller', async () => {
    requireAdminMock.mockResolvedValue({ ok: false, error: 'Not authorized.' })
    const result = await adminSetDisputeStatus('dispute-1', 'resolved')
    expect(result).toEqual({ ok: false, error: 'Not authorized.' })
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('resolves a dispute, stamping resolved_at and calling resolve_pickup', async () => {
    const result = await adminSetDisputeStatus('dispute-1', 'resolved')
    expect(result).toEqual({ ok: true })
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'resolved', resolved_at: expect.any(String) }))
    expect(rpcMock).toHaveBeenCalledWith('resolve_pickup', { p_conversation_id: 'convo-1' })
  })

  it('reopens a dispute, clearing resolved_at and NOT calling resolve_pickup', async () => {
    const result = await adminSetDisputeStatus('dispute-1', 'open')
    expect(result).toEqual({ ok: true })
    expect(updateMock).toHaveBeenCalledWith({ status: 'open', resolved_at: null })
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('returns an error when the dispute cannot be found', async () => {
    selectSingleResult = { data: null, error: { message: 'not found' } }
    const result = await adminSetDisputeStatus('missing', 'resolved')
    expect(result).toEqual({ ok: false, error: 'Dispute not found.' })
  })

  it('returns an error when the update fails', async () => {
    updateResult = { error: { message: 'db exploded' } }
    const result = await adminSetDisputeStatus('dispute-1', 'resolved')
    expect(result).toEqual({ ok: false, error: 'db exploded' })
  })
})

describe('adminDeleteDispute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAdminMock.mockResolvedValue({ ok: true, userId: 'admin-1' })
    selectSingleResult = { data: { conversation_id: 'convo-1', status: 'open' }, error: null }
    deleteResult = { error: null }
  })

  it('rejects a non-admin caller', async () => {
    requireAdminMock.mockResolvedValue({ ok: false, error: 'Not authorized.' })
    const result = await adminDeleteDispute('dispute-1')
    expect(result).toEqual({ ok: false, error: 'Not authorized.' })
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('deletes an open dispute and calls resolve_pickup afterward', async () => {
    const result = await adminDeleteDispute('dispute-1')
    expect(result).toEqual({ ok: true })
    expect(deleteMock).toHaveBeenCalled()
    expect(rpcMock).toHaveBeenCalledWith('resolve_pickup', { p_conversation_id: 'convo-1' })
  })

  it('deletes a resolved dispute and does NOT call resolve_pickup', async () => {
    selectSingleResult = { data: { conversation_id: 'convo-1', status: 'resolved' }, error: null }
    const result = await adminDeleteDispute('dispute-1')
    expect(result).toEqual({ ok: true })
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('returns an error when the delete fails', async () => {
    deleteResult = { error: { message: 'db exploded' } }
    const result = await adminDeleteDispute('dispute-1')
    expect(result).toEqual({ ok: false, error: 'db exploded' })
  })
})
