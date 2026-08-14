import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let verifyOtpResult: { error: { message: string } | null }
const verifyOtpMock = vi.fn((_args: unknown) => Promise.resolve(verifyOtpResult))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { verifyOtp: verifyOtpMock },
  }),
}))

import { GET } from './route'

function buildRequest(query: string) {
  return new NextRequest(`http://localhost:3000/auth/confirm${query}`)
}

// NextResponse.redirect sets a 3xx with a Location header.
function locationOf(res: Response) {
  return res.headers.get('location') ?? ''
}

describe('GET /auth/confirm', () => {
  beforeEach(() => {
    verifyOtpMock.mockClear()
    verifyOtpResult = { error: null }
  })

  it('verifies the emailed token and redirects to the requested next path', async () => {
    const res = await GET(buildRequest('?token_hash=th_123&type=recovery&next=%2Fauth%2Freset-password'))

    expect(verifyOtpMock).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'th_123' })
    expect(locationOf(res)).toBe('http://localhost:3000/auth/reset-password')
  })

  it('keeps the query string of the next path (the sign-in banner depends on it)', async () => {
    const res = await GET(buildRequest(`?token_hash=th_456&type=signup&next=${encodeURIComponent('/auth/signin?info=confirmed')}`))

    expect(verifyOtpMock).toHaveBeenCalledWith({ type: 'signup', token_hash: 'th_456' })
    expect(locationOf(res)).toBe('http://localhost:3000/auth/signin?info=confirmed')
  })

  it('falls back to the home page when no next param is supplied', async () => {
    const res = await GET(buildRequest('?token_hash=th_789&type=signup'))
    expect(locationOf(res)).toBe('http://localhost:3000/')
  })

  it('redirects to sign-in with an error when token_hash is missing, without verifying', async () => {
    const res = await GET(buildRequest('?type=recovery'))

    expect(verifyOtpMock).not.toHaveBeenCalled()
    expect(locationOf(res)).toContain('/auth/signin?error=')
    expect(decodeURIComponent(locationOf(res))).toContain('invalid or incomplete')
  })

  it('redirects to sign-in with an error when type is missing, without verifying', async () => {
    const res = await GET(buildRequest('?token_hash=th_123'))

    expect(verifyOtpMock).not.toHaveBeenCalled()
    expect(locationOf(res)).toContain('/auth/signin?error=')
    expect(decodeURIComponent(locationOf(res))).toContain('invalid or incomplete')
  })

  it('tells the user the link expired or was already used when verifyOtp fails', async () => {
    verifyOtpResult = { error: { message: 'Token has expired or is invalid' } }

    const res = await GET(buildRequest('?token_hash=th_expired&type=recovery&next=%2Fauth%2Freset-password'))

    expect(verifyOtpMock).toHaveBeenCalled()
    expect(locationOf(res)).toContain('/auth/signin?error=')
    expect(decodeURIComponent(locationOf(res))).toContain('expired or already been used')
  })

  it('refuses to redirect off-site via the next param', async () => {
    // Absolute URL
    const absolute = await GET(buildRequest('?token_hash=th_1&type=signup&next=https%3A%2F%2Fevil.example.com'))
    expect(locationOf(absolute)).toBe('http://localhost:3000/')

    // Protocol-relative — browsers read `//evil.example.com` as another origin
    const protocolRelative = await GET(buildRequest('?token_hash=th_2&type=signup&next=%2F%2Fevil.example.com'))
    expect(locationOf(protocolRelative)).toBe('http://localhost:3000/')
  })
})
