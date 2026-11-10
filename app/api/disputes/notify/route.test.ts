// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

vi.mock('server-only', () => ({}))
const notify = vi.fn((_: string) => Promise.resolve(true))
vi.mock('@/lib/disputes/notifyAdmins', () => ({ notifyAdminsOfDispute: (id: string) => notify(id) }))
let auth: { user: { id: string }; supabase: unknown } | null
let ownDispute: { id: string } | null
vi.mock('@/lib/supabase/fromBearer', () => ({ userFromBearer: () => Promise.resolve(auth) }))

const req = (body: unknown) => new Request('http://x/api/disputes/notify', { method: 'POST', body: JSON.stringify(body), headers: { authorization: 'Bearer t' } })

describe('POST /api/disputes/notify', () => {
  beforeEach(() => {
    notify.mockClear()
    ownDispute = { id: 'd-1' }
    auth = {
      user: { id: 'buyer-1' },
      supabase: { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: ownDispute }) }) }) }) }) },
    }
  })

  it('emails the admins about a dispute the caller filed', async () => {
    const res = await POST(req({ dispute_id: 'd-1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: true })
    expect(notify).toHaveBeenCalledWith('d-1')
  })

  it('refuses a caller without a valid token', async () => {
    auth = null
    expect((await POST(req({ dispute_id: 'd-1' }))).status).toBe(401)
    expect(notify).not.toHaveBeenCalled()
  })

  it("refuses a dispute the caller didn't file", async () => {
    ownDispute = null
    expect((await POST(req({ dispute_id: 'd-1' }))).status).toBe(404)
    expect(notify).not.toHaveBeenCalled()
  })
})
