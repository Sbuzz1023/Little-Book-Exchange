import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifyPhoneOtp } from './verification'

let verifyOtpResult: { error: { message: string } | null }
let profileUpdateResult: { error: { message: string } | null }

const verifyOtpMock = vi.fn((_args: unknown) => Promise.resolve(verifyOtpResult))
const eqMock = vi.fn(() => Promise.resolve(profileUpdateResult))
const updateMock = vi.fn((_payload: Record<string, unknown>) => ({ eq: eqMock }))
const fromMock = vi.fn((_table: string) => ({ update: updateMock }))
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } } }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: getUserMock, verifyOtp: verifyOtpMock },
    from: fromMock,
  }),
}))

function buildFormData(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

describe('verifyPhoneOtp', () => {
  beforeEach(() => {
    verifyOtpMock.mockClear()
    fromMock.mockClear()
    updateMock.mockClear()
    eqMock.mockClear()
    verifyOtpResult = { error: null }
    profileUpdateResult = { error: null }
  })

  it('saves the newly verified number to profiles.phone so it cannot desync from phone_verified', async () => {
    const res = await verifyPhoneOtp(buildFormData({ phone: '3125550100', token: '123456' }))
    expect(res).toEqual({ ok: true })
    expect(fromMock).toHaveBeenCalledWith('profiles')
    expect(updateMock).toHaveBeenCalledWith({ phone: '3125550100' })
    expect(eqMock).toHaveBeenCalledWith('id', 'user-1')
  })

  it('stores the phone raw (not E164-normalized), matching how profiles.phone is written elsewhere', async () => {
    await verifyPhoneOtp(buildFormData({ phone: '(312) 555-0100', token: '123456' }))
    expect(updateMock).toHaveBeenCalledWith({ phone: '(312) 555-0100' })
    // ...while the OTP itself is verified against the E164 form
    expect(verifyOtpMock).toHaveBeenCalledWith(expect.objectContaining({ phone: '+13125550100' }))
  })

  it('does not touch profiles.phone when the code is invalid', async () => {
    verifyOtpResult = { error: { message: 'Token has expired or is invalid' } }
    const res = await verifyPhoneOtp(buildFormData({ phone: '3125550100', token: '000000' }))
    expect(res).toEqual({ ok: false, error: 'Token has expired or is invalid' })
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('still reports success when the secondary profile write fails (the phone really is verified)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    profileUpdateResult = { error: { message: 'permission denied' } }
    const res = await verifyPhoneOtp(buildFormData({ phone: '3125550100', token: '123456' }))
    expect(res).toEqual({ ok: true })
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('rejects a missing code without calling verifyOtp', async () => {
    const res = await verifyPhoneOtp(buildFormData({ phone: '3125550100' }))
    expect(res).toEqual({ ok: false, error: 'Enter the code you received.' })
    expect(verifyOtpMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
  })
})
