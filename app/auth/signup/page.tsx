import { redirect } from 'next/navigation'
import Link from 'next/link'
import ContactToggle from './ContactToggle'
import AddressAutofillField from '@/components/AddressAutofillField'
import { isValidStateCode } from '@/lib/usStates'
import { normalizeCity } from '@/lib/normalizeCity'
import '../../home.css'
import '../../post/postform.css'

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
            city:               normalizeCity((formData.get('city') as string) ?? ''),
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
    fontSize: 11, fontWeight: 800, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '.5px',
    fontFamily: 'var(--sans)', display: 'block', marginBottom: 8,
  }
  const req = <span className="pf-required">*</span>
  const inputStyle: React.CSSProperties = {}
  const hintStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: 'var(--ink-faint)', marginTop: 6, lineHeight: 1.4 }

  return (
    <div className="home-v2">
    <div className="pf-auth-wrap">
      <div className="pf-card pf-auth-card">
        <div className="pf-auth-head">
          <h1>Join the Exchange</h1>
          <p className="sub">Free to join. Free to browse. 📚</p>
        </div>

        {searchParams.error && (
          <div className="pf-error-box">{decodeURIComponent(searchParams.error)}</div>
        )}

        <p style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-faint)', marginBottom: 16 }}>
          Fields marked <span className="pf-required">*</span> are required.
        </p>

        <form action={signUp}>

          {/* Username */}
          <div className="pf-f-group">
            <label className="pf-f-label">Username{req}</label>
            <input name="username" type="text" placeholder="e.g. sarahreads" required className="pf-input" />
          </div>

          {/* Street Address / City / State / Zip — Mapbox autofill */}
          <AddressAutofillField
            inputClassName="pf-input"
            inputStyle={inputStyle}
            labelStyle={labelStyle}
            requiredMark={req}
            noteAfterAddress={
              <p style={hintStyle}>🔒 Your street address is only shared with a buyer after you confirm their purchase.</p>
            }
          />

          {/* Apt / Unit */}
          <div className="pf-f-group">
            <label className="pf-f-label">Apt / Unit # <span className="opt">(optional)</span></label>
            <input name="address_unit" type="text" placeholder="e.g. Apt 2B" className="pf-input" />
          </div>

          {/* Pickup Spot */}
          <div className="pf-f-group">
            <label className="pf-f-label">Default Pickup Spot <span className="opt">(optional)</span></label>
            <input name="pickup_description" type="text" placeholder="e.g. front porch, behind the garden gnome" className="pf-input" />
          </div>

          {/* Phone */}
          <div className="pf-f-group">
            <label className="pf-f-label">Phone Number{req}</label>
            <input name="phone" type="tel" placeholder="e.g. (312) 555-0100" required className="pf-input" />
            <p className="pf-hint">📱 Used for notifications only. We will never share your number.</p>
          </div>

          {/* Email */}
          <div className="pf-f-group">
            <label className="pf-f-label">Email Address{req}</label>
            <input name="email" type="email" placeholder="you@email.com" required className="pf-input" />
            <p className="pf-hint">✉️ Used for notifications only. We will never share your email.</p>
          </div>

          {/* Preferred contact toggle */}
          <div className="pf-f-group">
            <label className="pf-f-label">Preferred Contact{req}</label>
            <ContactToggle />
          </div>

          {/* Password */}
          <div className="pf-f-group">
            <label className="pf-f-label">Password{req}</label>
            <input name="password" type="password" placeholder="At least 6 characters" required minLength={6} className="pf-input" />
          </div>

          <button type="submit" className="pf-submit-btn">Create My Account →</button>
        </form>

        <p className="pf-auth-footer">
          Already have an account? <Link href="/auth/signin">Sign in</Link>
        </p>
      </div>
    </div>
    </div>
  )
}
