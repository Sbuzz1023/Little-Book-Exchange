import { redirect } from 'next/navigation'
import Link from 'next/link'

export default function SignInPage({
  searchParams,
}: {
  searchParams: { redirect?: string; error?: string }
}) {
  async function signIn(formData: FormData) {
    'use server'
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: formData.get('email') as string,
      password: formData.get('password') as string,
    })
    if (error) redirect(`/auth/signin?error=${encodeURIComponent(error.message)}`)
    redirect(searchParams.redirect ?? '/')
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-8">
      <div className="bg-white rounded-3xl p-10 w-full max-w-md border-2 border-gray-100 shadow-[0_8px_0_#e5e7eb]">
        <h1 className="font-display text-3xl text-bk-orange mb-2 text-center">Welcome Back</h1>
        <p className="text-gray-400 font-semibold text-center mb-8">
          Sign in to post books and message neighbors.
        </p>

        {searchParams.error && (
          <div className="bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-red-700 font-bold text-sm mb-4">
            {decodeURIComponent(searchParams.error)}
          </div>
        )}

        <form action={signIn} className="space-y-4">
          <input
            name="email"
            type="email"
            placeholder="Email address"
            required
            className="w-full border-2 border-orange-200 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-bk-orange"
          />
          <input
            name="password"
            type="password"
            placeholder="Password"
            required
            className="w-full border-2 border-orange-200 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-bk-orange"
          />
          <button
            type="submit"
            className="w-full bg-bk-orange text-white py-3 rounded-xl font-extrabold shadow-[0_4px_0_#c2410c] hover:shadow-[0_2px_0_#c2410c] hover:translate-y-0.5 transition-all"
          >
            Sign In →
          </button>
        </form>

        <p className="text-center text-gray-400 font-semibold mt-6 text-sm">
          No account?{' '}
          <Link href="/auth/signup" className="text-bk-orange font-bold hover:underline">Join free</Link>
        </p>
      </div>
    </div>
  )
}
