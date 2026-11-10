// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

vi.mock('server-only', () => ({}))
let email: string | null = 'sally@example.com'
vi.mock('@/lib/auth/usernameLookup', () => ({ lookupEmailForUsername: () => Promise.resolve(email) }))
let signIn: { data: { session: unknown }; error: unknown }
const signInMock = vi.fn((_: { email: string; password: string }) => Promise.resolve(signIn))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { signInWithPassword: (c: { email: string; password: string }) => signInMock(c) } }) }))

const req = (body: unknown) => new Request('http://x/api/auth/username-signin', { method: 'POST', body: JSON.stringify(body) })

describe('POST /api/auth/username-signin', () => {
  beforeEach(() => {
    email = 'sally@example.com'
    signIn = { data: { session: { access_token: 'a', refresh_token: 'r', expires_at: 123 } }, error: null }
    signInMock.mockClear()
  })

  it('signs in with the email behind the username and returns the session tokens', async () => {
    const res = await POST(req({ username: 'sally', password: 'pw' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ access_token: 'a', refresh_token: 'r', expires_at: 123 })
    expect(signInMock).toHaveBeenCalledWith({ email: 'sally@example.com', password: 'pw' })
  })

  it('gives the same answer for an unknown username and a wrong password', async () => {
    email = null
    const unknown = await POST(req({ username: 'nobody', password: 'pw' }))
    email = 'sally@example.com'
    signIn = { data: { session: null }, error: { message: 'Invalid login credentials' } }
    const wrong = await POST(req({ username: 'sally', password: 'bad' }))
    expect(unknown.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(await unknown.json()).toEqual(await wrong.json())
  })

  it('never returns the email address', async () => {
    const res = await POST(req({ username: 'sally', password: 'pw' }))
    expect(JSON.stringify(await res.json())).not.toContain('sally@example.com')
  })

  it('rejects a missing username or password', async () => {
    expect((await POST(req({ username: '' }))).status).toBe(400)
  })
})
