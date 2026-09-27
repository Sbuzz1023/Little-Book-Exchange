import '../../home.css'
import '../../post/postform.css'

export default function ResetPasswordPage({ searchParams }: { searchParams: { error?: string } }) {
  async function setNewPassword(formData: FormData) {
    'use server'
    const { redirect } = await import('next/navigation')
    const password = formData.get('password') as string
    const confirm = formData.get('confirm') as string

    if (!password || password.length < 6) {
      redirect(`/auth/reset-password?error=${encodeURIComponent('Password must be at least 6 characters.')}`)
    }
    if (password !== confirm) {
      redirect(`/auth/reset-password?error=${encodeURIComponent('Passwords do not match.')}`)
    }

    const { createClient } = await import('@/lib/supabase/server')
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      redirect(`/auth/reset-password?error=${encodeURIComponent('That reset link has expired. Request a new one.')}`)
    }
    redirect('/auth/signin?info=password_reset')
  }

  return (
    <div className="home-v2">
    <div className="pf-auth-wrap">
      <div className="pf-card pf-auth-card">
        <div className="pf-auth-head">
          <h1>Set New Password</h1>
          <p className="sub">Choose a new password for your account.</p>
        </div>

        {searchParams.error && (
          <div className="pf-error-box">{decodeURIComponent(searchParams.error)}</div>
        )}

        <form action={setNewPassword}>
          <div className="pf-f-group">
            <label className="pf-f-label">New Password</label>
            <input
              name="password" type="password" placeholder="At least 6 characters" required minLength={6}
              autoComplete="new-password"
              className="pf-input"
            />
          </div>
          <div className="pf-f-group">
            <label className="pf-f-label">Confirm Password</label>
            <input
              name="confirm" type="password" placeholder="Re-enter password" required minLength={6}
              autoComplete="new-password"
              className="pf-input"
            />
          </div>
          <button type="submit" className="pf-submit-btn">Set Password →</button>
        </form>
      </div>
    </div>
    </div>
  )
}
