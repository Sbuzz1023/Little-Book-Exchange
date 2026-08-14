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
    <div className="flex items-center justify-center px-4 md:px-8 py-8 md:py-10" style={{ minHeight: 'calc(100vh - 68px)' }}>
      <div className="bg-white rounded-[28px] p-6 md:p-10 w-full max-w-[440px] border-2 border-gray-100 shadow-[0_8px_0_#e5e7eb]">
        <h1 className="font-display text-[28px] text-bk-orange text-center mb-1.5">Set New Password</h1>
        <p className="text-[14px] font-bold text-center mb-7" style={{ color: '#aaa' }}>Choose a new password for your account.</p>

        {searchParams.error && (
          <div className="bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-red-700 font-bold text-sm mb-4">
            {decodeURIComponent(searchParams.error)}
          </div>
        )}

        <form action={setNewPassword} className="space-y-4">
          <div>
            <label className="block mb-1.5" style={{ fontSize: 12, fontWeight: 900, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              New Password
            </label>
            <input
              name="password" type="password" placeholder="At least 6 characters" required minLength={6}
              autoComplete="new-password"
              className="w-full border-2 border-[#fed7aa] rounded-[14px] px-4 bg-cream font-bold text-[15px] focus:outline-none focus:border-bk-orange"
              style={{ padding: '13px 16px' }}
            />
          </div>
          <div>
            <label className="block mb-1.5" style={{ fontSize: 12, fontWeight: 900, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Confirm Password
            </label>
            <input
              name="confirm" type="password" placeholder="Re-enter password" required minLength={6}
              autoComplete="new-password"
              className="w-full border-2 border-[#fed7aa] rounded-[14px] px-4 bg-cream font-bold text-[15px] focus:outline-none focus:border-bk-orange"
              style={{ padding: '13px 16px' }}
            />
          </div>
          <button
            type="submit"
            className="w-full bg-bk-orange text-white rounded-[14px] font-black text-base shadow-[0_5px_0_#c2410c] hover:shadow-[0_3px_0_#c2410c] hover:translate-y-0.5 transition-all mt-2"
            style={{ padding: 15, border: 'none' }}
          >
            Set Password →
          </button>
        </form>
      </div>
    </div>
  )
}
