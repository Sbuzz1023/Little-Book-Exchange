import { NextRequest, NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  // Defense-in-depth against an open redirect: reaching this line already
  // requires a valid one-time token, but `next` is still attacker-controllable
  // in the link. Only same-origin absolute paths are allowed — note that `//evil.com`
  // is protocol-relative and would take the browser off-site, so it's rejected too.
  const requestedNext = searchParams.get('next') || '/'
  const next = requestedNext.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/'

  if (!token_hash || !type) {
    return NextResponse.redirect(`${origin}/auth/signin?error=${encodeURIComponent('That link is invalid or incomplete.')}`)
  }

  const supabase = createClient()
  const { error } = await supabase.auth.verifyOtp({ type, token_hash })
  if (error) {
    return NextResponse.redirect(`${origin}/auth/signin?error=${encodeURIComponent('That link has expired or already been used.')}`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
