import { redirect } from 'next/navigation'
import Link from 'next/link'
import ContactToggle from './ContactToggle'
import AddressAutofillField from '@/components/AddressAutofillField'
import { isValidStateCode } from '@/lib/usStates'

export default function SignUpPage({
  searchParams,
}: {
  searchParams: { error?: string }
}) {
  async function signUp(formData: FormData) {
    'use server'
    try {
      const { createClient } = await import('@/lib/supabase/server')
      const supabase = createClient()
      const rawState = (formData.get('state') as string) ?? ''
      const state = isValidStateCode(rawState) ? rawState : ''
      const { error } = await supabase.auth.signUp({
        email: formData.get('email') as string,
        password: formData.get('password') as string,
        options: {
          data: {
            username:           (formData.get('username') as string).replace(/\s+/g, ''),
            city:               formData.get('city') as string,
            state,
            phone:              formData.get('phone') as string,
            contact_preference: formData.get('contact_preference') as string,
            address:            (formData.get('address') as string) || '',
            address_unit:       (formData.get('address_unit') as string) || '',
            pickup_description: (formData.get('pickup_description') as string) || '',
            zip:                (formData.get('zip') as string) || '',
          },
        },
      })
      if (error) {
        const rawMsg = error.message || error.code || ''
        // GoTrue sometimes can't produce a normal error body when the
        // handle_new_user() database trigger fails (e.g. the profiles.username
        // unique constraint rejects a duplicate) — supabase-js falls back to a
        // raw, unhelpful string like "{}" in that case. Don't show that to the
        // user; fall back to a friendly message instead.
        const msg = rawMsg && !/^\{.*\}$/.test(rawMsg.trim()) ? rawMsg : ''
        if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('already exists') || (error as any).code === 'user_already_exists') {
          redirect('/auth/signin?info=already_registered')
        }
        redirect(`/auth/signup?error=${encodeURIComponent(msg || 'That username may already be taken, or something else went wrong. Please try a different username, or try again in a moment.')}`)
      }
      redirect('/?welcome=1')
    } catch (err: any) {
      if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
      redirect(`/auth/signup?error=${encodeURIComponent('Unable to connect. Please try again later.')}`)
    }
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 900, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px',
  }
  const req = <span style={{ color: '#f97316', marginLeft: 2 }}>*</span>
  const inputClass = "w-full border-2 border-[#fed7aa] rounded-[14px] px-4 bg-cream font-bold text-[15px] focus:outline-none focus:border-bk-orange"
  const inputStyle: React.CSSProperties = { padding: '13px 16px' }
  const hintStyle: React.CSSProperties = { fontSize: 11, color: '#bbb', fontWeight: 600, marginTop: 5 }

  return (
    <div className="flex items-center justify-center px-4 md:px-8 py-8 md:py-10" style={{ minHeight: 'calc(100vh - 68px)' }}>
      <div className="bg-white rounded-[28px] p-6 md:p-10 w-full max-w-[440px] border-2 border-gray-100 shadow-[0_8px_0_#e5e7eb]">
        <h1 className="font-display text-[28px] text-bk-orange text-center mb-1.5">Join the Exchange</h1>
        <p className="text-[14px] font-bold text-center mb-7" style={{ color: '#aaa' }}>Free to join. Free to browse. 📚</p>

        {searchParams.error && (
          <div className="bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-red-700 font-bold text-sm mb-4">
            {decodeURIComponent(searchParams.error)}
          </div>
        )}

        <p className="text-[11px] font-semibold mb-4" style={{ color: '#bbb' }}>
          Fields marked <span style={{ color: '#f97316' }}>*</span> are required.
        </p>

        <form action={signUp} className="space-y-4">

          {/* Username */}
          <div>
            <label className="block mb-1.5" style={labelStyle}>Username{req}</label>
            <input name="username" type="text" placeholder="e.g. sarahreads" required
              className={inputClass} style={inputStyle} />
          </div>

          {/* Street Address / City / State / Zip — Mapbox autofill */}
          <AddressAutofillField
            inputClassName={inputClass}
            inputStyle={inputStyle}
            labelStyle={labelStyle}
            requiredMark={req}
            noteAfterAddress={
              <p style={{ fontSize: 11, color: '#bbb', fontWeight: 600 }}>
                🔒 Your street address is only shared with a buyer after you confirm their purchase.
              </p>
            }
          />

          {/* Apt / Unit */}
          <div>
            <label className="block mb-1.5" style={labelStyle}>Apt / Unit # <span style={{ color: '#bbb', fontWeight: 600, fontSize: 11, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
            <input name="address_unit" type="text" placeholder="e.g. Apt 2B"
              className={inputClass} style={inputStyle} />
          </div>

          {/* Pickup Spot */}
          <div>
            <label className="block mb-1.5" style={labelStyle}>Default Pickup Spot <span style={{ color: '#bbb', fontWeight: 600, fontSize: 11, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
            <input name="pickup_description" type="text" placeholder="e.g. front porch, behind the garden gnome"
              className={inputClass} style={inputStyle} />
          </div>

          {/* Phone */}
          <div>
            <label className="block mb-1.5" style={labelStyle}>Phone Number{req}</label>
            <input name="phone" type="tel" placeholder="e.g. (312) 555-0100" required
              className={inputClass} style={inputStyle} />
            <p style={hintStyle}>📱 Used for notifications only. We will never share your number.</p>
          </div>

          {/* Email */}
          <div>
            <label className="block mb-1.5" style={labelStyle}>Email Address{req}</label>
            <input name="email" type="email" placeholder="you@email.com" required
              className={inputClass} style={inputStyle} />
            <p style={hintStyle}>✉️ Used for notifications only. We will never share your email.</p>
          </div>

          {/* Preferred contact toggle */}
          <div>
            <label className="block mb-2" style={labelStyle}>Preferred Contact{req}</label>
            <ContactToggle />
          </div>

          {/* Password */}
          <div>
            <label className="block mb-1.5" style={labelStyle}>Password{req}</label>
            <input name="password" type="password" placeholder="At least 6 characters" required minLength={6}
              className={inputClass} style={inputStyle} />
          </div>

          <button
            type="submit"
            className="w-full bg-bk-orange text-white rounded-[14px] font-black text-base shadow-[0_5px_0_#c2410c] hover:shadow-[0_3px_0_#c2410c] hover:translate-y-0.5 transition-all mt-2"
            style={{ padding: 15, border: 'none' }}
          >
            Create My Account →
          </button>
        </form>

        <p className="text-center font-bold text-[14px] mt-5" style={{ color: '#aaa' }}>
          Already have an account?{' '}
          <Link href="/auth/signin" className="text-bk-orange font-extrabold hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
