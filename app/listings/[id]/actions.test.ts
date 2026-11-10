import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requestBookAction, startConversationAction } from './actions'

vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`) } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined, set: vi.fn() }) }))

let user: { id: string } | null = { id: 'buyer-1' }
let rpcData: unknown = { status: 'ok', id: 'convo-1' }
const rpcMock = vi.fn((_fn: string, _args: Record<string, unknown>) => Promise.resolve({ data: rpcData, error: null }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user } }) },
    rpc: (fn: string, args: Record<string, unknown>) => rpcMock(fn, args),
  }),
}))

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')
  user = { id: 'buyer-1' }
  rpcMock.mockClear()
})

describe('requestBookAction', () => {
  it('requests through request_book and shows the requested state', async () => {
    rpcData = { status: 'ok', id: 'convo-1' }
    await expect(requestBookAction('listing-1')).rejects.toThrow('REDIRECT:/listings/listing-1?requested=1')
    expect(rpcMock).toHaveBeenCalledWith('request_book', { p_listing_id: 'listing-1' })
  })

  it('explains a credit shortfall', async () => {
    rpcData = { status: 'insufficient_credits' }
    await expect(requestBookAction('listing-1')).rejects.toThrow('REDIRECT:/listings/listing-1?insufficient_credits=1')
  })

  it('reports any other refusal as a failed request', async () => {
    rpcData = { status: 'not_available' }
    await expect(requestBookAction('listing-1')).rejects.toThrow('REDIRECT:/listings/listing-1?purchase_failed=1')
  })

  it('sends signed-out visitors to sign in', async () => {
    user = null
    await expect(requestBookAction('listing-1')).rejects.toThrow('REDIRECT:/auth/signin?redirect=/listings/listing-1')
    expect(rpcMock).not.toHaveBeenCalled()
  })
})

describe('startConversationAction', () => {
  it('opens the thread in Messages', async () => {
    rpcData = { status: 'ok', id: 'convo-9' }
    await expect(startConversationAction('listing-1')).rejects.toThrow('REDIRECT:/profile?tab=messages&conversation=convo-9')
    expect(rpcMock).toHaveBeenCalledWith('start_conversation', { p_listing_id: 'listing-1' })
  })

  it('stays on the listing when the thread cannot be started', async () => {
    rpcData = { status: 'own_listing' }
    await expect(startConversationAction('listing-1')).rejects.toThrow('REDIRECT:/listings/listing-1')
  })
})
