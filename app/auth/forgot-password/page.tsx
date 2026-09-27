import Link from 'next/link'
import '../../home.css'
import '../../post/postform.css'

export default function ForgotPasswordPage({ searchParams }: { searchParams: { sent?: string } }) {
  async function requestReset(formData: FormData) {
    'use server'
    const { redirect } = await import('next/navigation')
    const email = (formData.get('email') as string ?? '').trim()

    if (email) {
      const { createClient } = await import('@/lib/supabase/server')
      const supabase = createClient()
      // Errors are intentionally swallowed here — always show the same
      // "check your email" message, so this can't be used to test which
      // addresses have an account.
      await supabase.auth.resetPasswordForEmail(email)
    }
    redirect('/auth/forgot-password?sent=1')
  }

  return (
    <div className="home-v2">
    <div className="pf-auth-wrap">
      <div className="pf-card pf-auth-card">
        <div className="pf-auth-head">
          <h1>Reset Password</h1>
          <p className="sub">Enter your email and we'll send you a link to reset your password.</p>
        </div>

        {searchParams.sent === '1' ? (
          <div className="pf-info-box">If that email has an account, we've sent a reset link. Check your inbox.</div>
        ) : (
          <form action={requestReset}>
            <div className="pf-f-group">
              <label className="pf-f-label">Email</label>
              <input
                name="email"
                type="email"
                placeholder="you@email.com"
                required
                autoComplete="email"
                className="pf-input"
              />
            </div>
            <button type="submit" className="pf-submit-btn">Send Reset Link →</button>
          </form>
        )}

        <p className="pf-auth-footer">
          <Link href="/auth/signin">Back to sign in</Link>
        </p>
      </div>
    </div>
    </div>
  )
}
