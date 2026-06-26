import { redirect } from 'next/navigation'
import Link from 'next/link'

export default function SignInPage({
  searchParams,
}: {
  searchParams: { redirect?: string; error?: string }
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
          .from('profiles').select('email').eq('username', identifier.toLowerCase()).single()
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
    <div className="flex items-center justify-center px-4 md:px-8 py-8 md:py-10" style={{ minHeight: 'calc(100vh - 68px)' }}>
      <div className="bg-white rounded-[28px] p-6 md:p-10 w-full max-w-[440px] border-2 border-gray-100 shadow-[0_8px_0_#e5e7eb]">
        <h1 className="font-display text-[28px] text-bk-orange text-center mb-1.5">Welcome Back</h1>
        <p className="text-[14px] font-bold text-center mb-7" style={{ color: '#aaa' }}>Sign in to browse and message neighbors.</p>

        {searchParams.error && (
          <div className="bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-red-700 font-bold text-sm mb-4">
            {decodeURIComponent(searchParams.error)}
          </div>
        )}

        <form action={signIn} className="space-y-4">
          <div>
            <label
              className="block mb-1.5"
              style={{ fontSize: 12, fontWeight: 900, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}
            >
              Email or Username
            </label>
            <input
              name="identifier"
              type="text"
              placeholder="you@email.com or username"
              required
              autoComplete="username"
              className="w-full border-2 border-[#fed7aa] rounded-[14px] px-4 bg-cream font-bold text-[15px] focus:outline-none focus:border-bk-orange"
              style={{ padding: '13px 16px' }}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                style={{ fontSize: 12, fontWeight: 900, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}
              >
                Password
              </label>
              <Link
                href="/auth/forgot-password"
                className="font-bold text-[12px] hover:underline"
                style={{ color: '#aaa' }}
              >
                Forgot password?
              </Link>
            </div>
            <input
              name="password"
              type="password"
              placeholder="Your password"
              required
              autoComplete="current-password"
              className="w-full border-2 border-[#fed7aa] rounded-[14px] px-4 bg-cream font-bold text-[15px] focus:outline-none focus:border-bk-orange"
              style={{ padding: '13px 16px' }}
            />
          </div>
          <button
            type="submit"
            className="w-full bg-bk-orange text-white rounded-[14px] font-black text-base shadow-[0_5px_0_#c2410c] hover:shadow-[0_3px_0_#c2410c] hover:translate-y-0.5 transition-all mt-2"
            style={{ padding: 15, border: 'none' }}
          >
            Sign In →
          </button>
        </form>

        <p className="text-center font-bold text-[14px] mt-5" style={{ color: '#aaa' }}>
          No account?{' '}
          <Link href="/auth/signup" className="text-bk-orange font-extrabold hover:underline">Join free</Link>
        </p>
      </div>
    </div>
  )
}
