import { describe, it, expect, vi, beforeEach } from 'vitest'
import { moveSavedListingToTbr, saveListingAndGoToWallet } from './savedListings'

const redirectMock = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) })
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}))

let listingResult: { data: { title: string; author: string; city: string } | null; error: unknown }
let insertResult: { error: unknown }
let deleteEq2Result: { error: unknown }

const singleMock = vi.fn(() => Promise.resolve(listingResult))
const selectEqMock = vi.fn(() => ({ single: singleMock }))
const selectMock = vi.fn(() => ({ eq: selectEqMock }))

const insertMock = vi.fn(() => Promise.resolve(insertResult))

const deleteEq2Mock = vi.fn(() => Promise.resolve(deleteEq2Result))
const deleteEq1Mock = vi.fn(() => ({ eq: deleteEq2Mock }))
const deleteMock = vi.fn(() => ({ eq: deleteEq1Mock }))

let upsertResult: { error: unknown } = { error: null }
const upsertMock = vi.fn((_payload: Record<string, unknown>, _opts: Record<string, unknown>) => Promise.resolve(upsertResult))

const fromMock = vi.fn((table: string) => {
  if (table === 'listings') return { select: selectMock }
  if (table === 'tbr_entries') return { insert: insertMock }
  if (table === 'saved_listings') return { delete: deleteMock, upsert: upsertMock }
  throw new Error(`unexpected table ${table}`)
})

const getUserMock = vi.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } as { id: string } | null } }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: getUserMock }, from: fromMock }),
}))

function buildFormData(listingId: string) {
  const fd = new FormData()
  fd.set('listing_id', listingId)
  return fd
}

describe('moveSavedListingToTbr', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    listingResult = { data: { title: 'Dune', author: 'Frank Herbert', city: 'Chicago' }, error: null }
    insertResult = { error: null }
    deleteEq2Result = { error: null }
  })

  it('redirects to sign in when not authenticated, without touching anything', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    await expect(moveSavedListingToTbr(buildFormData('l1'))).rejects.toThrow('REDIRECT:/auth/signin')
    expect(insertMock).not.toHaveBeenCalled()
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('adds a TBR entry copied from the listing, then removes it from saved listings', async () => {
    await expect(moveSavedListingToTbr(buildFormData('l1'))).rejects.toThrow('REDIRECT:')
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1', title: 'Dune', author: 'Frank Herbert', city: 'Chicago',
    }))
    expect(deleteMock).toHaveBeenCalled()
    expect(deleteEq1Mock).toHaveBeenCalledWith('user_id', 'user-1')
    expect(deleteEq2Mock).toHaveBeenCalledWith('listing_id', 'l1')
  })

  it('does not remove the saved listing when the listing itself cannot be found', async () => {
    listingResult = { data: null, error: { message: 'not found' } }
    await expect(moveSavedListingToTbr(buildFormData('l1'))).rejects.toThrow('REDIRECT:')
    expect(insertMock).not.toHaveBeenCalled()
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('does not remove the saved listing when adding to TBR fails — never silently loses it', async () => {
    insertResult = { error: { message: 'db exploded' } }
    await expect(moveSavedListingToTbr(buildFormData('l1'))).rejects.toThrow('REDIRECT:')
    expect(deleteMock).not.toHaveBeenCalled()
  })
})

describe('saveListingAndGoToWallet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    upsertResult = { error: null }
  })

  it('redirects to sign in when not authenticated, without saving anything', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    await expect(saveListingAndGoToWallet(buildFormData('l1'))).rejects.toThrow('REDIRECT:/auth/signin')
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('saves the listing for the current user', async () => {
    await expect(saveListingAndGoToWallet(buildFormData('l1'))).rejects.toThrow('REDIRECT:')
    expect(upsertMock).toHaveBeenCalledWith(
      { user_id: 'user-1', listing_id: 'l1' },
      expect.objectContaining({ onConflict: 'user_id,listing_id' }),
    )
  })

  it('redirects to the Wallet tab after saving', async () => {
    await expect(saveListingAndGoToWallet(buildFormData('l1'))).rejects.toThrow('REDIRECT:/profile?tab=wallet')
  })
})
