import { redirect } from 'next/navigation'
import Link from 'next/link'
import '../../home.css'
import '../../post/postform.css'

export default function SignInPage({
  searchParams,
}: {
  searchParams: { redirect?: string; error?: string; info?: string }
}) {
  async function signIn(formData: FormData) {
    'use server'
    const { redirect: go } = await import('next/navigation')
    const identifier = (formData.get('identifier') as string ?? '').trim()
    const name = identifier.includes('@') ? identifier.split('@')[0] : identifier

    // Demo mode: Supabase not configured — accept any credentials
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http')) {
      const { cookies } = await import('next/headers')
      cookies().set('lbe_demo_user', name || 'demouser', { path: '/', maxAge: 60 * 60 * 24 * 7, sameSite: 'lax' })
      go(searchParams.redirect ?? '/profile')
    }

    // Real Supabase flow
    try {
      const { createClient } = await import('@/lib/supabase/server')
      const supabase = createClient()
      let email = identifier

      if (!identifier.includes('@')) {
        const { data: profile } = await supabase
          .from('profiles').select('email').eq('username', identifier).single()
        if (!profile?.email) go(`/auth/signin?error=${encodeURIComponent('No account found with that username.')}`)
        email = profile!.email
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password: formData.get('password') as string })
      if (error) go(`/auth/signin?error=${encodeURIComponent(error.message)}`)
      go(searchParams.redirect ?? '/')
    } catch (err: any) {
      if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
      const { cookies } = await import('next/headers')
      cookies().set('lbe_demo_user', name || 'demouser', { path: '/', maxAge: 60 * 60 * 24 * 7, sameSite: 'lax' })
      go(searchParams.redirect ?? '/profile')
    }
  }

  return (
    <div className="home-v2">
    <div className="pf-auth-wrap">
      <div className="pf-card pf-auth-card">
        <div className="pf-auth-head">
          <h1>Welcome Back</h1>
          <p className="sub">Sign in to browse and message neighbors.</p>
        </div>

        {searchParams.info === 'already_registered' && (
          <div className="pf-info-box">Looks like you already have an account! Sign in below.</div>
        )}

        {searchParams.info === 'confirmed' && (
          <div className="pf-info-box">Email confirmed! You can sign in now.</div>
        )}

        {searchParams.info === 'password_reset' && (
          <div className="pf-info-box">Password updated! Sign in with your new password.</div>
        )}

        {searchParams.error && (
          <div className="pf-error-box">{decodeURIComponent(searchParams.error)}</div>
        )}

        <form action={signIn}>
          <div className="pf-f-group">
            <label className="pf-f-label">Email or Username</label>
            <input
              name="identifier"
              type="text"
              placeholder="you@email.com or username"
              required
              autoComplete="username"
              className="pf-input"
            />
          </div>
          <div className="pf-f-group">
            <div className="flex items-center justify-between mb-2">
              <label className="pf-f-label" style={{ marginBottom: 0 }}>Password</label>
              <Link href="/auth/forgot-password" style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-faint)' }}>
                Forgot password?
              </Link>
            </div>
            <input
              name="password"
              type="password"
              placeholder="Your password"
              required
              autoComplete="current-password"
              className="pf-input"
            />
          </div>
          <button type="submit" className="pf-submit-btn">Sign In →</button>
        </form>

        <p className="pf-auth-footer">
          No account? <Link href="/auth/signup">Join free</Link>
        </p>
      </div>
    </div>
    </div>
  )
}
