import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createListing, updateListing } from './actions'

const redirectMock = vi.fn((url: string) => { const e = new Error(`REDIRECT:${url}`) as Error & { digest: string }; e.digest = `NEXT_REDIRECT;${url}`; throw e })
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirectMock(url) }))

let rpcResult: { data: unknown; error: unknown } = { data: { status: 'ok', id: 'new-id' }, error: null }
const rpcMock = vi.fn((_fn: string, _args: Record<string, unknown>) => Promise.resolve(rpcResult))
let existing: { data: unknown } = { data: { status: 'active' } }
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'seller-1' } } }) },
    rpc: (fn: string, args: Record<string, unknown>) => rpcMock(fn, args),
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ single: () => Promise.resolve(existing) }) }) }) }),
    storage: { from: () => ({ upload: vi.fn(), getPublicUrl: vi.fn() }) },
  }),
}))

function form(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}
const valid = { title: 'Dune', author: 'Frank Herbert', condition: 'Good', ol_work_key: '/works/OL1W' }

describe('createListing', () => {
  beforeEach(() => { rpcMock.mockClear(); rpcResult = { data: { status: 'ok', id: 'new-id' }, error: null } })

  it('creates the listing through create_listing and opens it', async () => {
    await expect(createListing(form(valid))).rejects.toThrow('REDIRECT:/listings/new-id')
    expect(rpcMock).toHaveBeenCalledWith('create_listing', expect.objectContaining({
      p_listing: expect.objectContaining({ title: 'Dune', photo_url: null }),
      p_books: [],
    }))
  })

  it('shows the database reason when the listing is refused', async () => {
    rpcResult = { data: { status: 'invalid_photo' }, error: null }
    await expect(createListing(form(valid))).rejects.toThrow(/REDIRECT:\/post\?error=One%20of%20your%20photos/)
  })

  it('never calls the database without an Open Library match', async () => {
    await expect(createListing(form({ ...valid, ol_work_key: '' }))).rejects.toThrow(/REDIRECT:\/post\?error=/)
    expect(rpcMock).not.toHaveBeenCalled()
  })
})

describe('updateListing', () => {
  beforeEach(() => { rpcMock.mockClear(); existing = { data: { status: 'active' } } })

  it('saves through update_listing and returns to My Listings', async () => {
    rpcResult = { data: 'ok', error: null }
    await expect(updateListing('listing-1', form(valid))).rejects.toThrow('REDIRECT:/profile?tab=listings')
    expect(rpcMock).toHaveBeenCalledWith('update_listing', expect.objectContaining({ p_listing_id: 'listing-1' }))
  })

  it('shows the reason when the database refuses the edit', async () => {
    rpcResult = { data: 'pending_request', error: null }
    await expect(updateListing('listing-1', form(valid))).rejects.toThrow(/REDIRECT:\/listings\/listing-1\/edit\?error=This%20listing%20has%20a%20pending/)
  })

  it('redirects with the sold message without calling the database', async () => {
    existing = { data: { status: 'sold' } }
    await expect(updateListing('listing-1', form(valid))).rejects.toThrow(/REDIRECT:\/listings\/listing-1\/edit\?error=This%20book%20has%20already%20been%20sold/)
    expect(rpcMock).not.toHaveBeenCalled()
  })
})
