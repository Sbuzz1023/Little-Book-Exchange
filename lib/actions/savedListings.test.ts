import { describe, it, expect, vi, beforeEach } from 'vitest'
import { moveSavedListingToTbr, saveListingAndGoToWallet } from './savedListings'

const redirectMock = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) })
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}))

let upsertResult: { error: unknown } = { error: null }
const upsertMock = vi.fn((_payload: Record<string, unknown>, _opts: Record<string, unknown>) => Promise.resolve(upsertResult))

const fromMock = vi.fn((table: string) => {
  if (table === 'saved_listings') return { upsert: upsertMock }
  throw new Error(`unexpected table ${table}`)
})

const rpcMock = vi.fn((_f: string, _a: Record<string, unknown>) => Promise.resolve({ data: 'ok', error: null }))

const getUserMock = vi.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } as { id: string } | null } }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: getUserMock }, from: fromMock, rpc: (f: string, a: Record<string, unknown>) => rpcMock(f, a) }),
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
  })

  it('redirects to sign in when not authenticated, without touching anything', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    await expect(moveSavedListingToTbr(buildFormData('l1'))).rejects.toThrow('REDIRECT:/auth/signin')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('moves the listing to TBR through move_saved_to_tbr', async () => {
    await expect(moveSavedListingToTbr(buildFormData('listing-1'))).rejects.toThrow('REDIRECT:/profile?tab=saved')
    expect(rpcMock).toHaveBeenCalledWith('move_saved_to_tbr', { p_listing_id: 'listing-1' })
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
