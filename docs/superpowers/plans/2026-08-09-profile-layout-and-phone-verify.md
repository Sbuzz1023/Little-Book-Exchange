# Profile Card Reorganization + Editable Username + Inline Phone Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the `/profile` page's Profile card so related fields are grouped (Username → Email → Phone → Address → Pickup), make Username editable with duplicate-name handling, and let users verify their phone directly in the Profile card (locked once verified), reusing the existing OTP mechanism via one shared component instead of duplicating it.

**Architecture:** `app/profile/ProfileCard.tsx` is restructured (view mode gains section headers matching edit mode; both modes reordered). A new shared client component, `components/PhoneVerify.tsx`, extracts the send-code/confirm-code UI that exists today only inline in `app/profile/DashboardClient.tsx`'s Wallet tab; both the Wallet tab and the new Profile-card Phone row use it. `app/profile/actions.ts`'s `updateProfile` gains username handling with unique-constraint error redirect; `app/profile/page.tsx` forwards that error to the client tree.

**Tech Stack:** Next.js 14 App Router, React (client components), Supabase (Postgres + Auth), Vitest + @testing-library/react.

## Global Constraints

- Match existing code style exactly: inline `style={{...}}` objects + Tailwind utility classes, as used throughout `ProfileCard.tsx`/`DashboardClient.tsx` — no new CSS files, no new styling approach.
- All new/changed server-action error handling follows the existing app pattern: redirect to `/profile?error=<encodeURIComponent(message)>`, decoded and shown via a red banner (`bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-red-700 font-bold text-sm mb-4`) — the exact pattern already used on `/auth/signup`.
- Tests use Vitest with explicit `import { describe, it, expect, vi, ... } from 'vitest'` (matches existing test files even though `globals: true` is set in `vitest.config.ts`).
- Run tests with `npx vitest run <path>` (or no path for the whole suite) — matches this project's prior plans.
- No database/schema changes — `username`, `phone`, `phone_verified`, `email`, `email_verified` already exist on `profiles`.

---

## Task 1: `updateProfile` — editable username with duplicate-name handling

**Files:**
- Modify: `app/profile/actions.ts:8-31` (the `updateProfile` function)
- Test: `app/profile/actions.test.ts` (new)

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `updateProfile(formData: FormData): Promise<never>` (throws via `redirect`) — now writes `username` and, on a Postgres unique-violation (`error.code === '23505'`), redirects to `/profile?error=<encoded "That username is already taken — try another.">` instead of `/profile?success=1`. Any other Supabase error redirects to `/profile?error=<encoded "Something went wrong saving your changes. Please try again.">`. Later tasks (`ProfileCard.test.tsx`) don't call this function directly, but Task 3's `ProfileCard.tsx` username `<input>` must be named `username` to match what this reads via `formData.get('username')`.

- [ ] **Step 1: Write the failing test**

Create `app/profile/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { updateProfile } from './actions'

const redirectMock = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) })
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}))

let updateResult: { error: { code?: string; message?: string } | null }
const eqMock = vi.fn(() => Promise.resolve(updateResult))
const updateMock = vi.fn(() => ({ eq: eqMock }))
const fromMock = vi.fn(() => ({ update: updateMock }))
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } } }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
  }),
}))

function buildFormData(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

const baseFields = {
  username: 'newname',
  city: 'Chicago',
  state: 'IL',
  phone: '3125550100',
  address: '',
  address_unit: '',
  zip: '',
  share_address: 'true',
  pickup_description: '',
  share_pickup: 'true',
  notify_message: 'true',
  notify_purchase_request: 'true',
  notify_purchase_decision: 'true',
  notify_tbr_match: 'true',
  notify_pickup: 'true',
}

describe('updateProfile', () => {
  beforeEach(() => {
    redirectMock.mockClear()
    fromMock.mockClear()
    updateMock.mockClear()
    eqMock.mockClear()
  })

  it('saves the username along with the rest of the profile and redirects to success', async () => {
    updateResult = { error: null }
    await expect(updateProfile(buildFormData(baseFields))).rejects.toThrow('REDIRECT:/profile?success=1')
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ username: 'newname' }))
  })

  it('lowercases and strips whitespace from the submitted username, matching signup', async () => {
    updateResult = { error: null }
    await expect(updateProfile(buildFormData({ ...baseFields, username: ' New Name ' })))
      .rejects.toThrow('REDIRECT:/profile?success=1')
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ username: 'newname' }))
  })

  it('redirects with a clear message when the username is already taken', async () => {
    updateResult = { error: { code: '23505', message: 'duplicate key value violates unique constraint "profiles_username_key"' } }
    await expect(updateProfile(buildFormData(baseFields)))
      .rejects.toThrow(`REDIRECT:/profile?error=${encodeURIComponent('That username is already taken — try another.')}`)
  })

  it('redirects with a generic message on any other save failure', async () => {
    updateResult = { error: { code: '42501', message: 'permission denied' } }
    await expect(updateProfile(buildFormData(baseFields)))
      .rejects.toThrow(`REDIRECT:/profile?error=${encodeURIComponent('Something went wrong saving your changes. Please try again.')}`)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/profile/actions.test.ts`
Expected: FAIL — `updateProfile` doesn't yet write `username` or check `error`, so the "already taken"/"generic error" tests fail (no error redirect happens today), and the success-path assertions may pass already but the file should still be run as one whole to confirm the two error tests fail for the right reason (no error branch exists).

- [ ] **Step 3: Implement `updateProfile`**

Replace `app/profile/actions.ts:8-31` (the whole `updateProfile` function) with:

```ts
export async function updateProfile(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')
  const rawState = (formData.get('state') as string) ?? ''
  const state = isValidStateCode(rawState) ? rawState : ''
  const username = ((formData.get('username') as string) || '').toLowerCase().replace(/\s+/g, '')
  const { error } = await supabase.from('profiles').update({
    username,
    city:               formData.get('city')                as string,
    state,
    phone:              formData.get('phone')               as string,
    address:            (formData.get('address')            as string) || '',
    address_unit:       (formData.get('address_unit')       as string) || '',
    zip:                (formData.get('zip')                as string) || '',
    share_address:      formData.get('share_address')       === 'true',
    pickup_description: (formData.get('pickup_description') as string) || '',
    share_pickup:       formData.get('share_pickup')        === 'true',
    notify_message:          formData.get('notify_message')          === 'true',
    notify_purchase_request: formData.get('notify_purchase_request') === 'true',
    notify_purchase_decision: formData.get('notify_purchase_decision') === 'true',
    notify_tbr_match:        formData.get('notify_tbr_match')        === 'true',
    notify_pickup:           formData.get('notify_pickup')           === 'true',
  }).eq('id', user!.id)

  if (error) {
    const message = error.code === '23505'
      ? 'That username is already taken — try another.'
      : 'Something went wrong saving your changes. Please try again.'
    redirect(`/profile?error=${encodeURIComponent(message)}`)
  }

  redirect('/profile?success=1')
}
```

(The `.toLowerCase().replace(/\s+/g, '')` normalization matches the exact convention already used for username at signup in `app/auth/signup/page.tsx:25`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/profile/actions.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add app/profile/actions.ts app/profile/actions.test.ts
git commit -m "feat: make username editable on profile save, handle duplicate-name error"
```

---

## Task 2: Shared `PhoneVerify` component

**Files:**
- Create: `components/PhoneVerify.tsx`
- Test: `components/PhoneVerify.test.tsx`

**Interfaces:**
- Consumes: nothing from other tasks — built and tested standalone against fake `sendPhoneOtp`/`verifyPhoneOtp` functions.
- Produces: `export default function PhoneVerify(props: PhoneVerifyProps)`, where:
  ```ts
  type PhoneVerifyProps = {
    phone: string
    onPhoneChange?: (value: string) => void
    phoneVerified: boolean
    sendPhoneOtp: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
    verifyPhoneOtp: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
    onVerified: () => void
  }
  ```
  Renders `null` when `phoneVerified` is `true`. Otherwise renders a "Verify Phone" button; clicking it reveals (if `onPhoneChange` was passed) an editable phone `<input>`, a "Send code" button, a code `<input placeholder="Enter 6-digit code">`, and a "Confirm code" button. On a successful `verifyPhoneOtp`, calls `onVerified()` and resets to the idle button state. Task 3 (`ProfileCard.tsx`) and Task 4 (`DashboardClient.tsx`'s Wallet tab) both import and render this.

- [ ] **Step 1: Write the failing test**

Create `components/PhoneVerify.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import PhoneVerify from './PhoneVerify'

describe('PhoneVerify', () => {
  it('renders nothing when the phone is already verified', () => {
    const { container } = render(
      <PhoneVerify
        phone="3125550100"
        phoneVerified={true}
        sendPhoneOtp={vi.fn()}
        verifyPhoneOtp={vi.fn()}
        onVerified={vi.fn()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('sends a code and confirms it, calling onVerified on success', async () => {
    const sendPhoneOtp = vi.fn(() => Promise.resolve({ ok: true }))
    const verifyPhoneOtp = vi.fn(() => Promise.resolve({ ok: true }))
    const onVerified = vi.fn()

    render(
      <PhoneVerify
        phone="3125550100"
        phoneVerified={false}
        sendPhoneOtp={sendPhoneOtp}
        verifyPhoneOtp={verifyPhoneOtp}
        onVerified={onVerified}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Verify Phone/ }))
    fireEvent.click(screen.getByRole('button', { name: /Send code/ }))
    expect(sendPhoneOtp).toHaveBeenCalled()

    fireEvent.change(screen.getByPlaceholderText(/6-digit code/), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /Confirm code/ }))

    await waitFor(() => expect(onVerified).toHaveBeenCalled())
    const [fd] = verifyPhoneOtp.mock.calls[0]
    expect(fd.get('phone')).toBe('3125550100')
    expect(fd.get('token')).toBe('123456')
  })

  it('shows an error and does not call onVerified when the code is wrong', async () => {
    const verifyPhoneOtp = vi.fn(() => Promise.resolve({ ok: false, error: 'Invalid code.' }))
    const onVerified = vi.fn()

    render(
      <PhoneVerify
        phone="3125550100"
        phoneVerified={false}
        sendPhoneOtp={vi.fn(() => Promise.resolve({ ok: true }))}
        verifyPhoneOtp={verifyPhoneOtp}
        onVerified={onVerified}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Verify Phone/ }))
    fireEvent.change(screen.getByPlaceholderText(/6-digit code/), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: /Confirm code/ }))

    expect(await screen.findByText('Invalid code.')).toBeInTheDocument()
    expect(onVerified).not.toHaveBeenCalled()
  })

  it('renders an editable phone input only when onPhoneChange is provided', () => {
    render(
      <PhoneVerify
        phone="3125550100"
        phoneVerified={false}
        sendPhoneOtp={vi.fn()}
        verifyPhoneOtp={vi.fn()}
        onVerified={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Verify Phone/ }))
    expect(screen.queryByDisplayValue('3125550100')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/PhoneVerify.test.tsx`
Expected: FAIL with "Failed to resolve import './PhoneVerify'" (file doesn't exist yet)

- [ ] **Step 3: Implement `PhoneVerify`**

Create `components/PhoneVerify.tsx`:

```tsx
'use client'

import { useState } from 'react'

type Props = {
  phone: string
  onPhoneChange?: (value: string) => void
  phoneVerified: boolean
  sendPhoneOtp: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
  verifyPhoneOtp: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
  onVerified: () => void
}

export default function PhoneVerify({ phone, onPhoneChange, phoneVerified, sendPhoneOtp, verifyPhoneOtp, onVerified }: Props) {
  const [step, setStep] = useState<'idle' | 'code_sent'>('idle')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (phoneVerified) return null

  if (step === 'idle') {
    return (
      <button
        type="button"
        onClick={() => setStep('code_sent')}
        className="font-extrabold text-[12px]"
        style={{ background: 'none', border: 'none', color: '#059669', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}
      >
        Verify Phone
      </button>
    )
  }

  return (
    <div className="mt-2 flex flex-col" style={{ gap: 6 }}>
      {onPhoneChange && (
        <input
          type="tel" value={phone} onChange={e => onPhoneChange(e.target.value)}
          className="border-2 border-[#a7f3d0] rounded-lg px-2 py-1.5 font-bold text-[12px]"
        />
      )}
      <button
        type="button"
        onClick={async () => {
          const fd = new FormData()
          fd.set('phone', phone)
          const res = await sendPhoneOtp(fd)
          setError(res.ok ? null : (res.error ?? 'Failed to send code.'))
        }}
        className="font-extrabold text-[12px] self-start"
        style={{ background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
      >
        Send code
      </button>
      <input
        type="text" placeholder="Enter 6-digit code" value={code} onChange={e => setCode(e.target.value)}
        className="border-2 border-[#a7f3d0] rounded-lg px-2 py-1.5 font-bold text-[12px]"
      />
      <button
        type="button"
        onClick={async () => {
          const fd = new FormData()
          fd.set('phone', phone)
          fd.set('token', code)
          const res = await verifyPhoneOtp(fd)
          if (res.ok) {
            setStep('idle'); setError(null); setCode('')
            onVerified()
          } else {
            setError(res.error ?? 'Invalid code.')
          }
        }}
        className="font-extrabold text-[12px] self-start"
        style={{ background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
      >
        Confirm code
      </button>
      {error && <p className="font-bold text-[11px]" style={{ color: '#e11d48' }}>{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/PhoneVerify.test.tsx`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add components/PhoneVerify.tsx components/PhoneVerify.test.tsx
git commit -m "feat: extract shared PhoneVerify component from the Wallet tab's inline OTP flow"
```

---

## Task 3: Reorganize `ProfileCard` — Username, read-only Email, locked/verifiable Phone, grouped Address

**Files:**
- Modify: `app/profile/page.tsx` (searchParams type + forward `error`)
- Modify: `app/profile/DashboardClient.tsx` (Props type + `<ProfileCard>` call site only — Wallet tab changes are Task 4)
- Modify: `app/profile/ProfileCard.tsx` (full reorg)
- Test: `app/profile/ProfileCard.test.tsx` (new)

**Interfaces:**
- Consumes: `PhoneVerify` from Task 2 (`components/PhoneVerify.tsx`, default export, props as documented above).
- Produces: `ProfileCard` now requires 3 new props beyond today's `profile`/`updateAction`/`success`: `error?: string | null`, `sendPhoneOtp`/`verifyPhoneOtp` (same signatures as `PhoneVerify` expects), and `onPhoneVerified: () => void`. Task 4 doesn't consume anything from this task directly (Wallet tab is independent), but must not break `DashboardClient`'s `<ProfileCard>` call site added here.

- [ ] **Step 1: Write the failing tests**

Create `app/profile/ProfileCard.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ProfileCard from './ProfileCard'

const baseProfile = {
  username: 'demouser',
  email: 'demo@example.com',
  city: 'Chicago',
  state: 'IL',
  phone: '3125550100',
  phone_verified: false,
  created_at: '2026-01-15T00:00:00.000Z',
}

const baseProps = {
  updateAction: vi.fn(() => Promise.resolve()),
  sendPhoneOtp: vi.fn(() => Promise.resolve({ ok: true })),
  verifyPhoneOtp: vi.fn(() => Promise.resolve({ ok: true })),
  onPhoneVerified: vi.fn(),
}

describe('ProfileCard — view mode', () => {
  it('renders Username, Email, Phone, and Member Since together, ahead of Address', () => {
    render(<ProfileCard profile={baseProfile} {...baseProps} />)
    const text = document.body.textContent ?? ''
    expect(text.indexOf('Username')).toBeLessThan(text.indexOf('📍 Address'))
    expect(text.indexOf('Email')).toBeLessThan(text.indexOf('📍 Address'))
    expect(text.indexOf('Phone')).toBeLessThan(text.indexOf('📍 Address'))
    expect(text.indexOf('Member Since')).toBeLessThan(text.indexOf('📍 Address'))
  })

  it('does not render an Address section when no address fields are set', () => {
    render(<ProfileCard profile={{ ...baseProfile, city: null, state: null }} {...baseProps} />)
    expect(screen.queryByText('📍 Address')).not.toBeInTheDocument()
  })

  it('shows a verified badge next to the phone number once verified', () => {
    render(<ProfileCard profile={{ ...baseProfile, phone_verified: true }} {...baseProps} />)
    expect(screen.getByText(/3125550100/)).toHaveTextContent('✅')
  })
})

describe('ProfileCard — edit mode', () => {
  function openEdit(profile = baseProfile) {
    render(<ProfileCard profile={profile} {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
  }

  it('has an editable Username input', () => {
    openEdit()
    expect(screen.getByDisplayValue('demouser')).toBeInTheDocument()
  })

  it('shows Email as plain text, not an input', () => {
    openEdit()
    expect(screen.getByText('demo@example.com')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('demo@example.com')).not.toBeInTheDocument()
  })

  it('phone stays editable and shows a Verify control when unverified', () => {
    openEdit()
    const phoneInput = screen.getByDisplayValue('3125550100') as HTMLInputElement
    expect(phoneInput).not.toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: /Verify Phone/ })).toBeInTheDocument()
  })

  it('locks the phone field and hides Verify once verified', () => {
    openEdit({ ...baseProfile, phone_verified: true })
    expect(screen.queryByRole('button', { name: /Verify Phone/ })).not.toBeInTheDocument()
    expect(screen.getByText(/✅ Verified/)).toBeInTheDocument()
  })

  it('shows the error banner when an error prop is passed', () => {
    render(<ProfileCard profile={baseProfile} {...baseProps} error="That username is already taken — try another." />)
    expect(screen.getByText('That username is already taken — try another.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run app/profile/ProfileCard.test.tsx`
Expected: FAIL — `ProfileCard` doesn't yet accept `sendPhoneOtp`/`verifyPhoneOtp`/`onPhoneVerified`/`error`, has no Username input, no Address section header, no phone lock/verify UI.

- [ ] **Step 3: Rewrite `ProfileCard.tsx`**

Replace the full contents of `app/profile/ProfileCard.tsx` with:

```tsx
'use client'

import { useState } from 'react'
import ShareToggle from '@/components/ShareToggle'
import AddressAutofillField from '@/components/AddressAutofillField'
import PhoneVerify from '@/components/PhoneVerify'

type Props = {
  profile: {
    id?: string | null
    name?: string | null
    username?: string | null
    email?: string | null
    city?: string | null
    state?: string | null
    phone?: string | null
    phone_verified?: boolean | null
    address?: string | null
    address_unit?: string | null
    zip?: string | null
    share_address?: boolean | null
    pickup_description?: string | null
    share_pickup?: boolean | null
    notify_message?: boolean | null
    notify_purchase_request?: boolean | null
    notify_purchase_decision?: boolean | null
    notify_tbr_match?: boolean | null
    notify_pickup?: boolean | null
    created_at?: string | null
  } | null
  updateAction: (formData: FormData) => Promise<void>
  success?: boolean
  error?: string | null
  sendPhoneOtp: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
  verifyPhoneOtp: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
  onPhoneVerified: () => void
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 900, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px',
}

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 900, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12,
}

const inputClass = "w-full border-2 border-[#fed7aa] rounded-[12px] px-4 bg-cream font-bold text-[15px] focus:outline-none focus:border-bk-orange"

const staticValueStyle: React.CSSProperties = {
  padding: '12px 16px', borderRadius: 12, background: '#f3f4f6', border: '2px solid #e5e7eb',
  color: '#555', fontWeight: 700, fontSize: 15,
}

function Field({ label, value, full }: { label: string; value?: string | null; full?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 min-w-0 ${full ? 'col-span-2' : ''}`}>
      <span style={labelStyle}>{label}</span>
      <span className="font-black text-[18px] text-[#1a1a1a] break-words">{value || '—'}</span>
    </div>
  )
}

function EditLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block mb-1.5" style={{ fontSize: 12, fontWeight: 900, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      {children}
    </label>
  )
}

function formatDate(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export default function ProfileCard({ profile, updateAction, success, error, sendPhoneOtp, verifyPhoneOtp, onPhoneVerified }: Props) {
  const [editing, setEditing] = useState(false)
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const phoneVerified = !!profile?.phone_verified
  const hasAddressInfo = !!(profile?.city || profile?.state || profile?.address || profile?.zip)

  return (
    <div
      id="profile"
      className="bg-white border-2 border-gray-100 shadow-[0_6px_0_#e5e7eb]"
      style={{ borderRadius: 24, padding: 28 }}
    >
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-display text-[22px] text-bk-orange">Profile</h2>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="font-extrabold text-[13px] transition-colors hover:border-bk-orange hover:text-bk-orange"
            style={{
              border: '2px solid #e5e7eb',
              color: '#555',
              padding: '7px 16px',
              borderRadius: 999,
              background: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            ✏️ Edit
          </button>
        )}
      </div>

      {success && (
        <div className="bg-green-50 border-2 border-green-200 rounded-xl px-4 py-2 text-green-700 font-bold text-sm mb-4">
          Profile updated!
        </div>
      )}

      {error && (
        <div className="bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-red-700 font-bold text-sm mb-4">
          {error}
        </div>
      )}

      {editing ? (
        <form action={updateAction} onSubmit={() => setEditing(false)}>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <EditLabel>Username</EditLabel>
              <input name="username" defaultValue={profile?.username ?? ''} type="text"
                className={inputClass} style={{ padding: '12px 16px' }} />
            </div>

            <div>
              <EditLabel>Email</EditLabel>
              <div style={staticValueStyle}>{profile?.email || '—'}</div>
            </div>

            <div>
              <EditLabel>Phone</EditLabel>
              {phoneVerified ? (
                <div style={staticValueStyle}>
                  {phone} <span style={{ color: '#059669' }}>✅ Verified</span>
                </div>
              ) : (
                <>
                  <input name="phone" value={phone} onChange={e => setPhone(e.target.value)} type="tel"
                    className={inputClass} style={{ padding: '12px 16px' }} />
                  <PhoneVerify
                    phone={phone}
                    phoneVerified={false}
                    sendPhoneOtp={sendPhoneOtp}
                    verifyPhoneOtp={verifyPhoneOtp}
                    onVerified={onPhoneVerified}
                  />
                </>
              )}
            </div>

            {/* Address section */}
            <div style={{ borderTop: '2px dashed #fed7aa', paddingTop: 16, marginTop: 4 }}>
              <p style={sectionHeaderStyle}>
                📍 Address
              </p>
              <div className="flex flex-col gap-4">
                <AddressAutofillField
                  defaultAddress={profile?.address ?? ''}
                  defaultCity={profile?.city ?? ''}
                  defaultState={profile?.state ?? ''}
                  defaultZip={profile?.zip ?? ''}
                  inputClassName={inputClass}
                  inputStyle={{ padding: '12px 16px' }}
                  labelStyle={{ fontSize: 12, fontWeight: 900, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}
                />
                <div>
                  <EditLabel>Apt / Unit #</EditLabel>
                  <input name="address_unit" defaultValue={profile?.address_unit ?? ''}
                    placeholder="e.g. Apt 2B"
                    className={inputClass} style={{ padding: '12px 16px' }} />
                </div>
                <ShareToggle
                  name="share_address"
                  defaultValue={profile?.share_address ?? true}
                  label="Share address after approval"
                  hint="🏠 Your street address is only revealed to a buyer after you approve their purchase request."
                />
              </div>
            </div>

            {/* Pickup section */}
            <div style={{ borderTop: '2px dashed #fed7aa', paddingTop: 16, marginTop: 4 }}>
              <p style={sectionHeaderStyle}>
                📦 Pickup Spot
              </p>
              <div className="flex flex-col gap-4">
                <div>
                  <EditLabel>Default Pickup Description</EditLabel>
                  <input name="pickup_description" defaultValue={profile?.pickup_description ?? ''}
                    placeholder="e.g. front porch, behind the garden gnome"
                    className={inputClass} style={{ padding: '12px 16px' }} />
                </div>
                <ShareToggle
                  name="share_pickup"
                  defaultValue={profile?.share_pickup ?? true}
                  label="Share pickup spot after approval"
                  hint="📦 Only revealed to a buyer after you approve their purchase."
                />
              </div>
            </div>

            {/* Notifications section */}
            <div style={{ borderTop: '2px dashed #fed7aa', paddingTop: 16, marginTop: 4 }}>
              <p style={sectionHeaderStyle}>
                🔔 Notifications
              </p>
              <div className="flex flex-col gap-3">
                <ShareToggle
                  name="notify_message"
                  defaultValue={profile?.notify_message ?? true}
                  label="New messages"
                  hint="Get notified when someone messages you about a listing."
                />
                <ShareToggle
                  name="notify_purchase_request"
                  defaultValue={profile?.notify_purchase_request ?? true}
                  label="Purchase requests"
                  hint="Get notified when someone requests one of your books."
                />
                <ShareToggle
                  name="notify_purchase_decision"
                  defaultValue={profile?.notify_purchase_decision ?? true}
                  label="Purchase decisions"
                  hint="Get notified when a seller confirms or declines your request."
                />
                <ShareToggle
                  name="notify_tbr_match"
                  defaultValue={profile?.notify_tbr_match ?? true}
                  label="TBR matches"
                  hint="Get notified when a book on your TBR list becomes available."
                />
                <ShareToggle
                  name="notify_pickup"
                  defaultValue={profile?.notify_pickup ?? true}
                  label="Pickup confirmations"
                  hint="Get notified when the other party marks a book picked up."
                />
              </div>
            </div>
          </div>
          <div className="flex gap-2.5 mt-5">
            <button
              type="submit"
              className="text-white font-extrabold text-[15px] shadow-[0_3px_0_#c2410c]"
              style={{ background: '#f97316', padding: '12px 28px', borderRadius: 12, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Save Changes
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="font-extrabold text-[14px] hover:border-red-300 hover:text-red-400 transition-colors"
              style={{ border: '2px solid #e5e7eb', color: '#aaa', padding: '10px 20px', borderRadius: 12, background: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col" style={{ gap: 20 }}>
          <div className="grid grid-cols-2 gap-x-8 gap-y-5">
            <Field label="Username" value={profile?.username} />
            <Field label="Email" value={profile?.email} />
            <Field label="Phone" value={profile?.phone ? `${profile.phone}${phoneVerified ? ' ✅' : ''}` : null} />
            <Field label="Member Since" value={formatDate(profile?.created_at)} />
          </div>

          {hasAddressInfo && (
            <div style={{ borderTop: '2px dashed #fed7aa', paddingTop: 16 }}>
              <p style={sectionHeaderStyle}>📍 Address</p>
              <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                {profile?.address && (
                  <Field label="Address" value={[profile.address, profile.address_unit].filter(Boolean).join(' ')} full />
                )}
                <Field label="City" value={profile?.city} />
                <Field label="State" value={profile?.state} />
                {profile?.zip && <Field label="Zip" value={profile.zip} />}
              </div>
            </div>
          )}

          {profile?.pickup_description && (
            <div style={{ borderTop: '2px dashed #fed7aa', paddingTop: 16 }}>
              <p style={sectionHeaderStyle}>📦 Pickup Spot</p>
              <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                <Field label="Pickup Spot" value={profile.pickup_description} full />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Wire the new props through `DashboardClient.tsx` and `page.tsx`**

In `app/profile/DashboardClient.tsx`, add `error?: string | null` to the `Props` type, change:

```tsx
  success?: boolean
  defaultTab?: Tab
  queryError?: string | null
  tbrError?: string | null
  isDemo: boolean
```

to:

```tsx
  success?: boolean
  defaultTab?: Tab
  queryError?: string | null
  tbrError?: string | null
  error?: string | null
  isDemo: boolean
```

Then update the component signature — change:

```tsx
export default function DashboardClient({ profile, listings, exchanges, savedListings, tbrEntries, transactions, updateAction, updateListingStatus, completeExchange, hideExchangeHistory, submitReview, confirmExchange, denyPurchase, cancelPurchase, removeSavedListing, addTbrEntry, removeTbrEntry, success, defaultTab, queryError, tbrError, isDemo, initialConversationId, unreadCounts, unreadEntityIds, resendEmailConfirmation, sendPhoneOtp, verifyPhoneOtp }: Props) {
```

to:

```tsx
export default function DashboardClient({ profile, listings, exchanges, savedListings, tbrEntries, transactions, updateAction, updateListingStatus, completeExchange, hideExchangeHistory, submitReview, confirmExchange, denyPurchase, cancelPurchase, removeSavedListing, addTbrEntry, removeTbrEntry, success, defaultTab, queryError, tbrError, error, isDemo, initialConversationId, unreadCounts, unreadEntityIds, resendEmailConfirmation, sendPhoneOtp, verifyPhoneOtp }: Props) {
```

Then change the `<ProfileCard>` call site from:

```tsx
<ProfileCard profile={profile} updateAction={updateAction} success={success} />
```

to:

```tsx
<ProfileCard
  profile={profile}
  updateAction={updateAction}
  success={success}
  error={error}
  sendPhoneOtp={sendPhoneOtp}
  verifyPhoneOtp={verifyPhoneOtp}
  onPhoneVerified={() => router.refresh()}
/>
```

In `app/profile/page.tsx`, the `searchParams` type already declares `error?: string` (line 18) — no change needed there. In the `return` block, add `error={searchParams.error ? decodeURIComponent(searchParams.error) : null}` to the `<DashboardClient>` call, alongside the existing `queryError={queryError}` line:

```tsx
      queryError={queryError}
      tbrError={searchParams.tbr_error ?? null}
```

becomes:

```tsx
      queryError={queryError}
      tbrError={searchParams.tbr_error ?? null}
      error={searchParams.error ? decodeURIComponent(searchParams.error) : null}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run app/profile/ProfileCard.test.tsx`
Expected: PASS (all 8 tests)

Then run the full suite to confirm nothing else broke from the prop-type changes:

Run: `npx vitest run`
Expected: PASS (existing `DashboardClient.test.tsx` still passes — it doesn't assert on `ProfileCard`'s internals, only renders `DashboardClient` as a whole)

- [ ] **Step 6: Commit**

```bash
git add app/profile/ProfileCard.tsx app/profile/ProfileCard.test.tsx app/profile/DashboardClient.tsx app/profile/page.tsx
git commit -m "feat: reorganize Profile card (username/email/phone/address grouping), editable username, inline phone verify"
```

---

## Task 4: Wallet tab uses the shared `PhoneVerify` component

**Files:**
- Modify: `app/profile/DashboardClient.tsx` (Wallet tab phone-verification block; remove now-unused state)

**Interfaces:**
- Consumes: `PhoneVerify` from Task 2.
- Produces: no new exports — this is an internal refactor of the Wallet tab. No other task depends on it.

- [ ] **Step 1: Replace the inline phone-verification block**

In `app/profile/DashboardClient.tsx`, remove these three state declarations (they move into `PhoneVerify`):

```tsx
  const [phoneStep, setPhoneStep] = useState<'idle' | 'code_sent'>('idle')
  const [phoneCode, setPhoneCode] = useState('')
  const [phoneError, setPhoneError] = useState<string | null>(null)
```

Keep `const [phoneNumber, setPhoneNumber] = useState(profile?.phone ?? '')` — the Wallet tab still needs its own editable phone input, passed into `PhoneVerify` via `onPhoneChange`.

Add the import at the top of the file (alongside the other component imports):

```tsx
import PhoneVerify from '@/components/PhoneVerify'
```

Replace this block (the phone-verification checklist item, originally spanning the `<div>` that contains the "☐ Verify phone" span through its closing `</div>`):

```tsx
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[13px]">{profile?.phone_verified ? '✅' : '☐'} Verify phone</span>
                    {!profile?.phone_verified && phoneStep === 'idle' && (
                      <button
                        type="button"
                        onClick={() => setPhoneStep('code_sent')}
                        className="font-extrabold text-[12px]"
                        style={{ background: 'none', border: 'none', color: '#059669', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}
                      >
                        Verify Phone
                      </button>
                    )}
                  </div>
                  {!profile?.phone_verified && phoneStep === 'code_sent' && (
                    <div className="mt-2 flex flex-col" style={{ gap: 6 }}>
                      <input
                        type="tel" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
                        className="border-2 border-[#a7f3d0] rounded-lg px-2 py-1.5 font-bold text-[12px]"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          const fd = new FormData()
                          fd.set('phone', phoneNumber)
                          const res = await sendPhoneOtp(fd)
                          setPhoneError(res.ok ? null : (res.error ?? 'Failed to send code.'))
                        }}
                        className="font-extrabold text-[12px] self-start"
                        style={{ background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        Send code
                      </button>
                      <input
                        type="text" placeholder="Enter 6-digit code" value={phoneCode} onChange={e => setPhoneCode(e.target.value)}
                        className="border-2 border-[#a7f3d0] rounded-lg px-2 py-1.5 font-bold text-[12px]"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          const fd = new FormData()
                          fd.set('phone', phoneNumber)
                          fd.set('token', phoneCode)
                          const res = await verifyPhoneOtp(fd)
                          if (res.ok) {
                            setPhoneStep('idle'); setPhoneError(null); setPhoneCode('')
                            // The server-rendered `profile` prop still says phone_verified: false.
                            // Without this the checklist row stays unchecked and the "Bonus earned"
                            // card never appears until a manual reload.
                            router.refresh()
                          }
                          else setPhoneError(res.error ?? 'Invalid code.')
                        }}
                        className="font-extrabold text-[12px] self-start"
                        style={{ background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        Confirm code
                      </button>
                      {phoneError && <p className="font-bold text-[11px]" style={{ color: '#e11d48' }}>{phoneError}</p>}
                    </div>
                  )}
                </div>
```

with:

```tsx
                <div>
                  <span className="font-bold text-[13px]">{profile?.phone_verified ? '✅' : '☐'} Verify phone</span>
                  <PhoneVerify
                    phone={phoneNumber}
                    onPhoneChange={setPhoneNumber}
                    phoneVerified={!!profile?.phone_verified}
                    sendPhoneOtp={sendPhoneOtp}
                    verifyPhoneOtp={verifyPhoneOtp}
                    // The server-rendered `profile` prop still says phone_verified: false.
                    // Without this the checklist row stays unchecked and the "Bonus earned"
                    // card never appears until a manual reload.
                    onVerified={() => router.refresh()}
                  />
                </div>
```

Note: this drops the `flex items-center justify-between` row that placed the "Verify Phone" button beside the label — the button (and, once clicked, the send/confirm panel) now stacks below the label instead of sitting inline beside it. This is a minor, deliberate cosmetic trade-off for having one shared component instead of two copies of this UI; nothing about the Wallet tab's behavior or test coverage changes.

- [ ] **Step 2: Run the existing test suite to confirm no regressions**

Run: `npx vitest run app/profile/DashboardClient.test.tsx`
Expected: PASS — the existing "DashboardClient — phone verification" tests (`refreshes the server-rendered profile after a successful verification`, `does not refresh when verification fails`, `sends an OTP and then verifies it`) query by role/text (`Verify Phone`, `6-digit code`, `Send code`, `Confirm code`), which `PhoneVerify` renders identically, so these should pass unchanged.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS (all tests, across all 4 tasks)

- [ ] **Step 4: Commit**

```bash
git add app/profile/DashboardClient.tsx
git commit -m "refactor: Wallet tab phone verification now uses the shared PhoneVerify component"
```

---

## Manual verification (after all tasks)

Automated tests cover behavior in isolation; do this pass in a real browser against the dev server to confirm the full flow end-to-end, consistent with prior features on this project:

1. `npm run dev`, sign in, go to `/profile`.
2. **View mode:** confirm Username, Email, Phone, Member Since appear together at the top, followed by a "📍 Address" section (City/State/Zip/Address together), then "📦 Pickup Spot" if set.
3. Click **Edit**: confirm Username is now an editable box, Email shows as plain (non-editable) text, Phone is editable with a "Verify Phone" link beneath it.
4. Enter a phone number, click **Verify Phone → Send code**, retrieve the real OTP (via however this project's Supabase phone-auth provider delivers it in this environment), enter it, click **Confirm code** — confirm the Phone field locks (read-only, "✅ Verified" shown) and the Verify control disappears, without a page reload.
5. Change Username to something else and **Save Changes** — confirm it saves and shows on reload.
6. Try saving a Username that's already taken by another account (e.g. a demo/test account) — confirm the red "already taken" banner appears instead of a silent failure.
7. Go to the **Wallet** tab's "Earn Your First Credit" card — confirm phone verification still works there too (same shared component, independent phone number entry).
