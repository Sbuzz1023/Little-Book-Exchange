import { describe, it, expect, vi, beforeEach } from 'vitest'
import { markPickedUp } from './actions'

// The nav's coin show reads unseen credits in the root layout. A redirect
// from a server action doesn't re-render the (unchanged) root layout, so
// after the pickup that completes an exchange the layout must be
// revalidated or the show wouldn't play until a later hard load.

const calls: string[] = []
const redirectMock = vi.fn((url: string) => { calls.push(`redirect:${url}`); throw new Error(`REDIRECT:${url}`) })
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirectMock(url) }))
const revalidatePathMock = vi.fn((path: string, type?: string) => { calls.push(`revalidate:${path}:${type}`) })
vi.mock('next/cache', () => ({ revalidatePath: (p: string, t?: string) => revalidatePathMock(p, t) }))

let updated: { id: string } | null = { id: 'convo-1' }
let rpcResult = 'completed_manual'

const convoChain: Record<string, unknown> = {}
for (const m of ['select', 'eq', 'is', 'update']) convoChain[m] = () => convoChain
convoChain.single = () => Promise.resolve({ data: { buyer_id: 'user-1', seller_id: 'seller-1' } })
convoChain.maybeSingle = () => Promise.resolve({ data: updated })

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
    from: (table: string) => {
      if (table === 'conversations') return convoChain
      if (table === 'profiles') return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { username: 'me' } }) }) }) }
      if (table === 'messages') return { insert: () => Promise.resolve({ error: null }) }
      throw new Error(`unexpected table ${table}`)
    },
    rpc: () => Promise.resolve({ data: rpcResult }),
  }),
}))

function form() {
  const fd = new FormData()
  fd.set('conversation_id', 'convo-1')
  return fd
}

describe('markPickedUp — refreshing the nav for the coin show', () => {
  beforeEach(() => {
    calls.length = 0
    vi.clearAllMocks()
    updated = { id: 'convo-1' }
    rpcResult = 'completed_manual'
  })

  it('revalidates the root layout before redirecting when the pickup completes the exchange', async () => {
    await expect(markPickedUp(form())).rejects.toThrow('REDIRECT:/profile?tab=exchanges')
    expect(calls).toEqual(['revalidate:/:layout', 'redirect:/profile?tab=exchanges'])
  })

  it('does not revalidate the layout while still waiting on the other party', async () => {
    rpcResult = 'waiting'
    await expect(markPickedUp(form())).rejects.toThrow('REDIRECT:/profile?tab=exchanges')
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})
