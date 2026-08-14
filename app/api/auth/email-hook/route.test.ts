import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const verifyMock = vi.fn()
// route.ts calls `new Webhook(...)`, so the mock implementation must be a
// constructor-capable `function`, not an arrow function (arrow functions
// throw "is not a constructor" under `new`, which route.ts's catch-all then
// mis-reports as an invalid signature).
vi.mock('standardwebhooks', () => ({
  Webhook: vi.fn().mockImplementation(function () { return { verify: verifyMock } }),
}))

// vi.mock factories are hoisted above `const` declarations, so a factory
// that references a mock var directly in its returned object literal (as
// opposed to inside a deferred closure) hits a temporal-dead-zone error.
// vi.hoisted defines the var in that same hoisted scope so it's already
// initialized when the factory runs.
const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn() }))
vi.mock('@/lib/email/resend', () => ({ sendEmail: sendEmailMock }))

let templateRow: { subject: string; body: string } | null
let templateError: { message: string } | null
let profileRow: { username: string } | null
const insertMock = vi.fn(() => Promise.resolve({ error: null }))

const fromMock = vi.fn((table: string) => {
  if (table === 'email_templates') {
    return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: templateRow, error: templateError }) }) }) }
  }
  if (table === 'profiles') {
    return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: profileRow }) }) }) }
  }
  if (table === 'email_log') {
    return { insert: insertMock }
  }
  throw new Error(`unexpected table ${table}`)
})

vi.mock('@/lib/supabase/serviceRole', () => ({
  createServiceRoleClient: () => ({ from: fromMock }),
}))

import { Webhook } from 'standardwebhooks'
import { POST } from './route'

function buildRequest(body: unknown) {
  return new NextRequest('http://localhost/api/auth/email-hook', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'webhook-id': 'id', 'webhook-timestamp': '1', 'webhook-signature': 'sig' },
  })
}

describe('POST /api/auth/email-hook', () => {
  beforeEach(() => {
    verifyMock.mockReset()
    sendEmailMock.mockReset()
    insertMock.mockClear()
    vi.mocked(Webhook).mockClear()
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'
    process.env.SUPABASE_EMAIL_HOOK_SECRET = 'whsec_c2VjcmV0'
    templateRow = { subject: 'Hi {{username}}', body: 'Click {{link}}, {{username}}' }
    templateError = null
    profileRow = { username: 'seanb' }
  })

  it('rejects a request with an invalid signature', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    verifyMock.mockImplementation(() => { throw new Error('bad signature') })
    const res = await POST(buildRequest({}))
    expect(res.status).toBe(401)
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('SIGNATURE REJECTED'), expect.anything())
    consoleError.mockRestore()
  })

  it('strips the leading `v1,` Supabase shows in its dashboard, without breaking the happy path', async () => {
    // Supabase displays the Send Email Hook secret as `v1,whsec_<base64>`, but
    // standardwebhooks only strips `whsec_` — the `v1,` makes its base64 decode
    // throw, which used to surface as a bogus 401 "invalid signature".
    process.env.SUPABASE_EMAIL_HOOK_SECRET = 'v1,whsec_c2VjcmV0'
    verifyMock.mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com' },
      email_data: { token_hash: 'th_v1', email_action_type: 'recovery' },
    })
    sendEmailMock.mockResolvedValue({ ok: true })

    const res = await POST(buildRequest({}))

    expect(Webhook).toHaveBeenCalledWith('whsec_c2VjcmV0')
    expect(res.status).toBe(200)
    expect(sendEmailMock).toHaveBeenCalled()
  })

  it('passes a `whsec_`-prefixed or bare secret through unchanged', async () => {
    verifyMock.mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com' },
      email_data: { token_hash: 'th_x', email_action_type: 'recovery' },
    })
    sendEmailMock.mockResolvedValue({ ok: true })

    process.env.SUPABASE_EMAIL_HOOK_SECRET = 'whsec_c2VjcmV0'
    await POST(buildRequest({}))
    expect(Webhook).toHaveBeenCalledWith('whsec_c2VjcmV0')

    vi.mocked(Webhook).mockClear()
    process.env.SUPABASE_EMAIL_HOOK_SECRET = 'c2VjcmV0'
    await POST(buildRequest({}))
    expect(Webhook).toHaveBeenCalledWith('c2VjcmV0')
  })

  it('logs a config error — distinct from a rejected signature — when the secret cannot build a verifier', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(Webhook).mockImplementationOnce(() => { throw new Error('Invalid base64 string') })

    const res = await POST(buildRequest({}))

    expect(res.status).toBe(401)
    expect(verifyMock).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('CONFIG ERROR'), expect.anything())
    consoleError.mockRestore()
  })

  it('returns 400 rather than throwing when a signature-valid payload has no email_data', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    verifyMock.mockReturnValue({ user: { id: 'user-1', email: 'user@example.com' } })

    const res = await POST(buildRequest({}))

    expect(res.status).toBe(400)
    expect(sendEmailMock).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('renders the password_reset template and sends via Resend for a recovery action', async () => {
    verifyMock.mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com' },
      email_data: { token_hash: 'th_123', email_action_type: 'recovery' },
    })
    sendEmailMock.mockResolvedValue({ ok: true })

    const res = await POST(buildRequest({}))

    expect(res.status).toBe(200)
    expect(fromMock).toHaveBeenCalledWith('email_templates')
    expect(sendEmailMock).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'Hi seanb',
      text: expect.stringContaining('http://localhost:3000/auth/confirm?token_hash=th_123&type=recovery&next=%2Fauth%2Freset-password'),
    })
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'password_reset', status: 'sent', recipient_email: 'user@example.com' }))
  })

  it('renders the welcome_confirmation template and points next at sign-in for a signup action', async () => {
    templateRow = { subject: 'Welcome {{username}}', body: 'Confirm: {{link}}' }
    verifyMock.mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com' },
      email_data: { token_hash: 'th_456', email_action_type: 'signup' },
    })
    sendEmailMock.mockResolvedValue({ ok: true })

    await POST(buildRequest({}))

    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('/auth/confirm?token_hash=th_456&type=signup&next=%2Fauth%2Fsignin%3Finfo%3Dconfirmed'),
    }))
  })

  it('logs a failed send and returns an error when Resend fails', async () => {
    verifyMock.mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com' },
      email_data: { token_hash: 'th_789', email_action_type: 'recovery' },
    })
    sendEmailMock.mockResolvedValue({ ok: false, error: 'Invalid API key' })

    const res = await POST(buildRequest({}))

    expect(res.status).toBe(500)
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'Invalid API key' }))
  })

  it('rejects an unsupported email action type without sending', async () => {
    verifyMock.mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com' },
      email_data: { token_hash: 'th_999', email_action_type: 'magiclink' },
    })

    const res = await POST(buildRequest({}))

    expect(res.status).toBe(400)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('fails loudly instead of sending a blank email when the template lookup errors', async () => {
    templateRow = null
    templateError = { message: 'connection reset' }
    verifyMock.mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com' },
      email_data: { token_hash: 'th_111', email_action_type: 'recovery' },
    })

    const res = await POST(buildRequest({}))

    expect(res.status).toBe(500)
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', recipient_email: 'user@example.com' }))
    expect(insertMock).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }))
  })

  it('fails loudly instead of sending a blank email when the template row is simply missing', async () => {
    templateRow = null
    templateError = null
    verifyMock.mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com' },
      email_data: { token_hash: 'th_222', email_action_type: 'signup' },
    })

    const res = await POST(buildRequest({}))

    expect(res.status).toBe(500)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })
})
