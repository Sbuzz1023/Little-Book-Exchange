import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { lookupEmailForUsername } from '@/lib/auth/usernameLookup'

const WRONG = { error: 'Wrong username or password.' }

// The iPhone app's "sign in with username". Email sign-in goes straight to
// Supabase Auth; this exists only because the username → email lookup needs
// the service role. Returns session tokens for supabase.auth.setSession().
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!username || !password) return NextResponse.json({ error: 'Enter your username and password.' }, { status: 400 })

  const email = await lookupEmailForUsername(username)
  if (!email) return NextResponse.json(WRONG, { status: 401 })

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.session) return NextResponse.json(WRONG, { status: 401 })

  const { access_token, refresh_token, expires_at } = data.session
  return NextResponse.json({ access_token, refresh_token, expires_at })
}
