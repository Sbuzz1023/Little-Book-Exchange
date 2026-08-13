import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendMock = vi.fn()

vi.mock('resend', () => ({
  Resend: vi.fn(function() { return { emails: { send: sendMock } } }),
}))

// Import after the mock so the mocked constructor is what sendEmail sees.
import { sendEmail } from './resend'

describe('sendEmail', () => {
  beforeEach(() => {
    sendMock.mockReset()
    process.env.RESEND_API_KEY = 'test-key'
    delete process.env.EMAIL_FROM_ADDRESS
  })

  it('sends with the default from-address when EMAIL_FROM_ADDRESS is unset', async () => {
    sendMock.mockResolvedValue({ data: { id: 'abc' }, error: null })
    const res = await sendEmail({ to: 'user@example.com', subject: 'Hi', text: 'Body' })
    expect(res).toEqual({ ok: true })
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@example.com',
      subject: 'Hi',
      text: 'Body',
      from: expect.stringContaining('resend.dev'),
    }))
  })

  it('uses EMAIL_FROM_ADDRESS when set, so swapping in a real domain later is a one-line change', async () => {
    process.env.EMAIL_FROM_ADDRESS = 'Little Book Exchange <hello@littlebookexchange.com>'
    sendMock.mockResolvedValue({ data: { id: 'abc' }, error: null })
    await sendEmail({ to: 'user@example.com', subject: 'Hi', text: 'Body' })
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ from: 'Little Book Exchange <hello@littlebookexchange.com>' }))
  })

  it('reports failure when Resend returns an error', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: 'Invalid API key' } })
    const res = await sendEmail({ to: 'user@example.com', subject: 'Hi', text: 'Body' })
    expect(res).toEqual({ ok: false, error: 'Invalid API key' })
  })

  it('reports failure when the Resend call throws', async () => {
    sendMock.mockRejectedValue(new Error('network down'))
    const res = await sendEmail({ to: 'user@example.com', subject: 'Hi', text: 'Body' })
    expect(res).toEqual({ ok: false, error: 'network down' })
  })
})
