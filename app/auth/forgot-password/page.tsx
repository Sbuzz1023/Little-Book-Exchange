import Link from 'next/link'

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
    <div className="flex items-center justify-center px-4 md:px-8 py-8 md:py-10" style={{ minHeight: 'calc(100vh - 68px)' }}>
      <div className="bg-white rounded-[28px] p-6 md:p-10 w-full max-w-[440px] border-2 border-gray-100 shadow-[0_8px_0_#e5e7eb]">
        <h1 className="font-display text-[28px] text-bk-orange text-center mb-1.5">Reset Password</h1>
        <p className="text-[14px] font-bold text-center mb-7" style={{ color: '#aaa' }}>
          Enter your email and we'll send you a link to reset your password.
        </p>

        {searchParams.sent === '1' ? (
          <div className="bg-teal-50 border-2 border-teal-200 rounded-xl px-4 py-3 text-teal-700 font-bold text-sm">
            If that email has an account, we've sent a reset link. Check your inbox.
          </div>
        ) : (
          <form action={requestReset} className="space-y-4">
            <div>
              <label
                className="block mb-1.5"
                style={{ fontSize: 12, fontWeight: 900, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}
              >
                Email
              </label>
              <input
                name="email"
                type="email"
                placeholder="you@email.com"
                required
                autoComplete="email"
                className="w-full border-2 border-[#fed7aa] rounded-[14px] px-4 bg-cream font-bold text-[15px] focus:outline-none focus:border-bk-orange"
                style={{ padding: '13px 16px' }}
              />
            </div>
            <button
              type="submit"
              className="w-full bg-bk-orange text-white rounded-[14px] font-black text-base shadow-[0_5px_0_#c2410c] hover:shadow-[0_3px_0_#c2410c] hover:translate-y-0.5 transition-all mt-2"
              style={{ padding: 15, border: 'none' }}
            >
              Send Reset Link →
            </button>
          </form>
        )}

        <p className="text-center font-bold text-[14px] mt-5" style={{ color: '#aaa' }}>
          <Link href="/auth/signin" className="text-bk-orange font-extrabold hover:underline">Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}
