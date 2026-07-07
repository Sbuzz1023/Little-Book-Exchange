# Address Privacy Toggles & Pickup Description Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let sellers control which private contact details (street address, pickup spot) are revealed to buyers after purchase approval, with toggles on signup and in profile settings.

**Architecture:** New DB columns on `profiles` (address, address_unit, share_address, pickup_description, share_pickup) and `listings` (pickup_description override). A shared `ShareToggle` client component handles the ON/OFF UI. A pure `buildConfirmationMessage` helper builds the post-approval message so it can be unit-tested independently of the server action.

**Tech Stack:** Next.js 14 App Router, Supabase, Tailwind CSS, Vitest + @testing-library/react

## Global Constraints

- Next.js 14.2.x — use `'use server'` / `'use client'` directives, no `use()` hook
- All styles use inline style objects or Tailwind classes matching existing site patterns (orange `#f97316`, cream `#fffbf0`, border `#fed7aa`)
- No new npm packages — use only existing dependencies
- FormData boolean values arrive as the string `'true'` or `'false'`; convert with `=== 'true'`
- `share_address` and `share_pickup` default to `true` everywhere (opt-out, not opt-in)
- Run `npm run test:run` to execute the test suite (Vitest, jsdom, globals enabled)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/schema.sql` | Modify | Add migration SQL + updated trigger |
| `components/ShareToggle.tsx` | Create | Reusable ON/OFF toggle with hidden input + hint |
| `components/ShareToggle.test.tsx` | Create | Unit tests for ShareToggle |
| `lib/buildConfirmationMessage.ts` | Create | Pure function: build post-approval message string |
| `lib/buildConfirmationMessage.test.ts` | Create | Unit tests for message builder |
| `app/auth/signup/page.tsx` | Modify | Add address fields + two ShareToggles |
| `app/profile/ProfileCard.tsx` | Modify | Add address/pickup fields + ShareToggles to edit form |
| `app/profile/actions.ts` | Modify | `updateProfile` saves new fields; `confirmExchange` uses buildConfirmationMessage |
| `app/profile/page.tsx` | Modify | Extend profiles + listings select queries; update mock data |
| `app/profile/DashboardClient.tsx` | Modify | Extend types; show address/pickup in confirmed buyer card |
| `lib/mock-data.ts` | Modify | Add new fields to MOCK_PROFILE and MOCK_CONVERSATIONS sellers |
| `app/post/PostForm.tsx` | Modify | Add per-listing pickup description field |
| `app/post/actions.ts` | Modify | Persist `pickup_description` on listing insert |

---

### Task 1: Database Migration

**Files:**
- Modify: `supabase/schema.sql`

**Interfaces:**
- Produces: `profiles` columns — `address text`, `address_unit text`, `share_address boolean`, `pickup_description text`, `share_pickup boolean`
- Produces: `listings` column — `pickup_description text nullable`

- [ ] **Step 1: Add migration SQL and updated trigger to schema.sql**

Open `supabase/schema.sql`. After the existing `-- Migration (run if table already exists):` comment block (around line 78), add a new migration section. Also replace the `handle_new_user` function (lines 21-36) with the updated version.

The full updated `handle_new_user` function (replace the existing one):

```sql
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email, username, city, state, phone, contact_preference, address, address_unit, share_address, pickup_description, share_pickup)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'username', ''),
    coalesce(new.raw_user_meta_data->>'city', ''),
    coalesce(new.raw_user_meta_data->>'state', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    coalesce(new.raw_user_meta_data->>'contact_preference', 'email'),
    coalesce(new.raw_user_meta_data->>'address', ''),
    coalesce(new.raw_user_meta_data->>'address_unit', ''),
    coalesce((new.raw_user_meta_data->>'share_address')::boolean, true),
    coalesce(new.raw_user_meta_data->>'pickup_description', ''),
    coalesce((new.raw_user_meta_data->>'share_pickup')::boolean, true)
  );
  return new;
end;
$$ language plpgsql security definer;
```

Add this migration block at the end of `supabase/schema.sql`:

```sql
-- ── Migration: address privacy toggles ────────────────────────────────────────
-- Run this block in Supabase SQL Editor if the tables already exist:
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address_unit text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS share_address boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pickup_description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS share_pickup boolean NOT NULL DEFAULT true;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS pickup_description text;
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Run migration in Supabase**

Paste only the migration block (the `ALTER TABLE` statements) into the Supabase SQL Editor and click Run. This is a no-op if columns already exist (`IF NOT EXISTS`). Also re-run the `handle_new_user` function block to update the trigger.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: add address/pickup columns to profiles and listings schema"
```

---

### Task 2: ShareToggle Component

**Files:**
- Create: `components/ShareToggle.tsx`
- Create: `components/ShareToggle.test.tsx`

**Interfaces:**
- Produces: `ShareToggle` — default export, props: `{ name: string; defaultValue?: boolean; label: string; hint: string }`
- Consumed by: Task 3 (signup), Task 5 (ProfileCard)

- [ ] **Step 1: Write the failing tests**

Create `components/ShareToggle.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ShareToggle from './ShareToggle'

describe('ShareToggle', () => {
  it('renders ON by default', () => {
    render(<ShareToggle name="share_address" label="Share address" hint="Only shared after approval" />)
    expect(screen.getByRole('button')).toHaveTextContent('ON')
  })

  it('renders OFF when defaultValue is false', () => {
    render(<ShareToggle name="share_address" defaultValue={false} label="Share address" hint="hint" />)
    expect(screen.getByRole('button')).toHaveTextContent('OFF')
  })

  it('toggles to OFF when clicked once', () => {
    render(<ShareToggle name="share_address" label="Share address" hint="hint" />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button')).toHaveTextContent('OFF')
  })

  it('toggles back to ON when clicked twice', () => {
    render(<ShareToggle name="share_address" label="Share address" hint="hint" />)
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(btn).toHaveTextContent('ON')
  })

  it('hidden input has value "true" when ON', () => {
    const { container } = render(<ShareToggle name="share_address" label="Share address" hint="hint" />)
    const input = container.querySelector('input[name="share_address"]') as HTMLInputElement
    expect(input.value).toBe('true')
  })

  it('hidden input has value "false" when toggled OFF', () => {
    const { container } = render(<ShareToggle name="share_address" label="Share address" hint="hint" />)
    fireEvent.click(container.querySelector('button')!)
    const input = container.querySelector('input[name="share_address"]') as HTMLInputElement
    expect(input.value).toBe('false')
  })

  it('displays the hint text', () => {
    render(<ShareToggle name="share_address" label="Share address" hint="Revealed after approval" />)
    expect(screen.getByText('Revealed after approval')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd "C:\Users\seanb\Desktop\Little Book Exchange" && npm run test:run -- components/ShareToggle.test.tsx
```

Expected: FAIL — `Cannot find module './ShareToggle'`

- [ ] **Step 3: Create the ShareToggle component**

Create `components/ShareToggle.tsx`:

```tsx
'use client'

import { useState } from 'react'

type Props = {
  name: string
  defaultValue?: boolean
  label: string
  hint: string
}

export default function ShareToggle({ name, defaultValue = true, label, hint }: Props) {
  const [on, setOn] = useState(defaultValue)

  return (
    <div>
      <input type="hidden" name={name} value={on ? 'true' : 'false'} />
      <button
        type="button"
        onClick={() => setOn(prev => !prev)}
        className="flex items-center gap-2 font-extrabold text-[13px] rounded-[12px] py-2.5 px-4 border-2 transition-all w-full"
        style={{
          background:  on ? '#f97316' : '#fffbf0',
          borderColor: on ? '#f97316' : '#fed7aa',
          color:       on ? '#fff'    : '#aaa',
          boxShadow:   on ? '0 3px 0 #c2410c' : '0 3px 0 #fde5c4',
          fontFamily:  'inherit',
          cursor:      'pointer',
          textAlign:   'left',
        }}
      >
        <span style={{ fontSize: 16 }}>{on ? '🔓' : '🔒'}</span>
        <span>{label}: <strong>{on ? 'ON' : 'OFF'}</strong></span>
      </button>
      <p style={{ fontSize: 11, color: '#bbb', fontWeight: 600, marginTop: 5 }}>{hint}</p>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- components/ShareToggle.test.tsx
```

Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add components/ShareToggle.tsx components/ShareToggle.test.tsx
git commit -m "feat: add ShareToggle component for privacy settings"
```

---

### Task 3: Signup Form — Address Fields + Toggles

**Files:**
- Modify: `app/auth/signup/page.tsx`

**Interfaces:**
- Consumes: `ShareToggle` from `@/components/ShareToggle`
- Produces: FormData fields `address`, `address_unit`, `share_address` ('true'/'false'), `pickup_description`, `share_pickup` ('true'/'false') passed to Supabase `options.data`

- [ ] **Step 1: Update app/auth/signup/page.tsx**

Make the following changes to `app/auth/signup/page.tsx`:

**a) Add the ShareToggle import** after the existing imports at the top of the file:

```tsx
import ShareToggle from '@/components/ShareToggle'
```

**b) Update the `signUp` server action** — add the new fields inside `options.data` (the full updated `data` object):

```ts
data: {
  username:           (formData.get('username') as string).toLowerCase().replace(/\s+/g, ''),
  city:               formData.get('city') as string,
  state:              formData.get('state') as string,
  phone:              formData.get('phone') as string,
  contact_preference: formData.get('contact_preference') as string,
  address:            (formData.get('address') as string) || '',
  address_unit:       (formData.get('address_unit') as string) || '',
  share_address:      formData.get('share_address') === 'true',
  pickup_description: (formData.get('pickup_description') as string) || '',
  share_pickup:       formData.get('share_pickup') === 'true',
},
```

**c) Add the new form fields** inside the `<form>` element, after the `{/* State */}` block and before the `{/* Phone */}` block:

```tsx
{/* Street Address */}
<div>
  <label className="block mb-1.5" style={labelStyle}>Street Address</label>
  <input name="address" type="text" placeholder="e.g. 123 Main St"
    className={inputClass} style={inputStyle} />
</div>

{/* Apt / Unit */}
<div>
  <label className="block mb-1.5" style={labelStyle}>Apt / Unit # <span style={{ color: '#bbb', fontWeight: 600, fontSize: 11, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
  <input name="address_unit" type="text" placeholder="e.g. Apt 2B"
    className={inputClass} style={inputStyle} />
</div>

{/* Address share toggle */}
<div>
  <ShareToggle
    name="share_address"
    defaultValue={true}
    label="Share address after approval"
    hint="🏠 Your street address is only revealed to a buyer after you approve their purchase request."
  />
</div>

{/* Pickup Spot */}
<div>
  <label className="block mb-1.5" style={labelStyle}>Default Pickup Spot <span style={{ color: '#bbb', fontWeight: 600, fontSize: 11, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
  <input name="pickup_description" type="text" placeholder="e.g. front porch, behind the garden gnome"
    className={inputClass} style={inputStyle} />
</div>

{/* Pickup share toggle */}
<div>
  <ShareToggle
    name="share_pickup"
    defaultValue={true}
    label="Share pickup spot after approval"
    hint="📦 Only revealed to a buyer after you approve their purchase."
  />
</div>
```

- [ ] **Step 2: Verify the page renders without TypeScript errors**

```bash
cd "C:\Users\seanb\Desktop\Little Book Exchange" && npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors related to the signup page.

- [ ] **Step 3: Commit**

```bash
git add app/auth/signup/page.tsx
git commit -m "feat: add address and pickup fields to signup form"
```

---

### Task 4: Confirmation Message Helper + Updated confirmExchange

**Files:**
- Create: `lib/buildConfirmationMessage.ts`
- Create: `lib/buildConfirmationMessage.test.ts`
- Modify: `app/profile/actions.ts` (the `confirmExchange` function only)

**Interfaces:**
- Produces: `buildConfirmationMessage(params: ConfirmationParams): string`
- Produces type: `ConfirmationParams` — exported from `lib/buildConfirmationMessage.ts`
- Consumed by: `confirmExchange` in `app/profile/actions.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/buildConfirmationMessage.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildConfirmationMessage } from './buildConfirmationMessage'

const base = {
  username: 'sarahreads',
  city: 'Chicago',
  state: 'IL',
  phone: '(312) 555-0100',
  share_address: false as boolean,
  share_pickup: false as boolean,
}

describe('buildConfirmationMessage', () => {
  it('always includes username', () => {
    expect(buildConfirmationMessage(base)).toContain('sarahreads')
  })

  it('always includes city and state', () => {
    expect(buildConfirmationMessage(base)).toContain('Chicago, IL')
  })

  it('includes phone when provided', () => {
    expect(buildConfirmationMessage(base)).toContain('(312) 555-0100')
  })

  it('omits phone line when phone is empty', () => {
    const msg = buildConfirmationMessage({ ...base, phone: '' })
    expect(msg).not.toContain('📞')
  })

  it('omits address when share_address is false', () => {
    const msg = buildConfirmationMessage({ ...base, address: '123 Main St', share_address: false })
    expect(msg).not.toContain('123 Main St')
  })

  it('includes street address when share_address is true', () => {
    const msg = buildConfirmationMessage({ ...base, address: '123 Main St', share_address: true })
    expect(msg).toContain('123 Main St')
  })

  it('includes address_unit alongside address when share_address is true', () => {
    const msg = buildConfirmationMessage({ ...base, address: '123 Main St', address_unit: 'Apt 2B', share_address: true })
    expect(msg).toContain('123 Main St Apt 2B')
  })

  it('omits address line when address is empty even if share_address is true', () => {
    const msg = buildConfirmationMessage({ ...base, address: '', address_unit: '', share_address: true })
    expect(msg).not.toContain('🏠')
  })

  it('omits pickup when share_pickup is false', () => {
    const msg = buildConfirmationMessage({ ...base, share_pickup: false, profile_pickup: 'front porch' })
    expect(msg).not.toContain('front porch')
  })

  it('includes profile pickup when share_pickup is true and no listing override', () => {
    const msg = buildConfirmationMessage({ ...base, share_pickup: true, listing_pickup: null, profile_pickup: 'front porch' })
    expect(msg).toContain('front porch')
  })

  it('prefers listing pickup over profile pickup', () => {
    const msg = buildConfirmationMessage({ ...base, share_pickup: true, listing_pickup: 'side gate', profile_pickup: 'front porch' })
    expect(msg).toContain('side gate')
    expect(msg).not.toContain('front porch')
  })

  it('omits pickup line when both listing and profile pickup are empty', () => {
    const msg = buildConfirmationMessage({ ...base, share_pickup: true, listing_pickup: null, profile_pickup: '' })
    expect(msg).not.toContain('📦')
  })

  it('omits state from city line when state is empty', () => {
    const msg = buildConfirmationMessage({ ...base, state: '' })
    expect(msg).toContain('Chicago')
    expect(msg).not.toContain('Chicago,')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- lib/buildConfirmationMessage.test.ts
```

Expected: FAIL — `Cannot find module './buildConfirmationMessage'`

- [ ] **Step 3: Create the helper**

Create `lib/buildConfirmationMessage.ts`:

```ts
export type ConfirmationParams = {
  username: string
  city: string
  state?: string | null
  phone?: string | null
  address?: string | null
  address_unit?: string | null
  share_address: boolean
  listing_pickup?: string | null
  profile_pickup?: string | null
  share_pickup: boolean
}

export function buildConfirmationMessage(p: ConfirmationParams): string {
  const lines: string[] = []
  lines.push("📍 Exchange confirmed! Here's how to connect:")
  lines.push(`👤 ${p.username}`)
  lines.push(`📌 ${p.city}${p.state ? ', ' + p.state : ''}`)
  if (p.phone) lines.push(`📞 ${p.phone}`)
  if (p.share_address && (p.address || p.address_unit)) {
    const addr = [p.address, p.address_unit].filter(Boolean).join(' ')
    lines.push(`🏠 ${addr}`)
  }
  if (p.share_pickup) {
    const pickup = p.listing_pickup || p.profile_pickup
    if (pickup) lines.push(`📦 Pickup: ${pickup}`)
  }
  return lines.join('\n')
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- lib/buildConfirmationMessage.test.ts
```

Expected: All 13 tests PASS

- [ ] **Step 5: Update confirmExchange in app/profile/actions.ts**

Replace the entire `confirmExchange` function with this updated version:

```ts
export async function confirmExchange(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const conversationId = formData.get('conversation_id') as string

  await supabase.from('conversations')
    .update({ exchange_status: 'confirmed' })
    .eq('id', conversationId)
    .eq('seller_id', user.id)

  // Fetch seller profile with privacy fields
  const { data: profile } = await supabase
    .from('profiles')
    .select('username, city, state, phone, address, address_unit, share_address, pickup_description, share_pickup')
    .eq('id', user.id)
    .single()

  // Fetch listing pickup description override
  let listingPickup: string | null = null
  const { data: convo } = await supabase
    .from('conversations')
    .select('listing_id')
    .eq('id', conversationId)
    .single()
  if (convo?.listing_id) {
    const { data: listing } = await supabase
      .from('listings')
      .select('pickup_description')
      .eq('id', convo.listing_id)
      .single()
    listingPickup = listing?.pickup_description ?? null
  }

  if (profile) {
    const { buildConfirmationMessage } = await import('@/lib/buildConfirmationMessage')
    const body = buildConfirmationMessage({
      username:        profile.username,
      city:            profile.city,
      state:           profile.state,
      phone:           profile.phone,
      address:         profile.address,
      address_unit:    profile.address_unit,
      share_address:   profile.share_address,
      listing_pickup:  listingPickup,
      profile_pickup:  profile.pickup_description,
      share_pickup:    profile.share_pickup,
    })
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body,
    })
  }

  redirect('/profile')
}
```

Note: add the `import { buildConfirmationMessage }` at the top of actions.ts (not dynamic) since it's a local module with no server-only restrictions:

Add this static import at the top of `app/profile/actions.ts` alongside the other imports:

```ts
import { buildConfirmationMessage } from '@/lib/buildConfirmationMessage'
```

And remove the dynamic import inside `confirmExchange` (replace `await import(...)` with just calling `buildConfirmationMessage` directly).

The final `confirmExchange` function (with static import at file top):

```ts
export async function confirmExchange(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const conversationId = formData.get('conversation_id') as string

  await supabase.from('conversations')
    .update({ exchange_status: 'confirmed' })
    .eq('id', conversationId)
    .eq('seller_id', user.id)

  const { data: profile } = await supabase
    .from('profiles')
    .select('username, city, state, phone, address, address_unit, share_address, pickup_description, share_pickup')
    .eq('id', user.id)
    .single()

  let listingPickup: string | null = null
  const { data: convo } = await supabase
    .from('conversations')
    .select('listing_id')
    .eq('id', conversationId)
    .single()
  if (convo?.listing_id) {
    const { data: listing } = await supabase
      .from('listings')
      .select('pickup_description')
      .eq('id', convo.listing_id)
      .single()
    listingPickup = listing?.pickup_description ?? null
  }

  if (profile) {
    const body = buildConfirmationMessage({
      username:       profile.username,
      city:           profile.city,
      state:          profile.state,
      phone:          profile.phone,
      address:        profile.address,
      address_unit:   profile.address_unit,
      share_address:  profile.share_address,
      listing_pickup: listingPickup,
      profile_pickup: profile.pickup_description,
      share_pickup:   profile.share_pickup,
    })
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body,
    })
  }

  redirect('/profile')
}
```

- [ ] **Step 6: Run full test suite to confirm no regressions**

```bash
npm run test:run
```

Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add lib/buildConfirmationMessage.ts lib/buildConfirmationMessage.test.ts app/profile/actions.ts
git commit -m "feat: privacy-aware confirmation message, fetch address/pickup on exchange confirm"
```

---

### Task 5: Profile Edit Form — Address & Pickup Fields

**Files:**
- Modify: `app/profile/ProfileCard.tsx`
- Modify: `app/profile/actions.ts` (the `updateProfile` function only)

**Interfaces:**
- Consumes: `ShareToggle` from `@/components/ShareToggle`
- Consumes: profile prop fields: `address`, `address_unit`, `share_address`, `pickup_description`, `share_pickup`
- These fields flow from `app/profile/page.tsx` → `DashboardClient` → `ProfileCard` (types updated in Task 6)

- [ ] **Step 1: Update the Props type in ProfileCard.tsx**

Replace the `Props` type definition at the top of `app/profile/ProfileCard.tsx`:

```ts
type Props = {
  profile: {
    id?: string | null
    name?: string | null
    username?: string | null
    email?: string | null
    city?: string | null
    state?: string | null
    phone?: string | null
    address?: string | null
    address_unit?: string | null
    share_address?: boolean | null
    pickup_description?: string | null
    share_pickup?: boolean | null
    created_at?: string | null
  } | null
  updateAction: (formData: FormData) => Promise<void>
  success?: boolean
}
```

- [ ] **Step 2: Add ShareToggle import to ProfileCard.tsx**

Add after the existing `'use client'` and `import { useState }` lines:

```tsx
import ShareToggle from '@/components/ShareToggle'
```

- [ ] **Step 3: Update the view mode grid in ProfileCard.tsx**

The existing view mode grid (the `!editing` block, starting with `<div className="grid grid-cols-2 gap-x-8 gap-y-5">`) shows 6 fields. Add two more fields after the Phone row:

```tsx
{profile?.address && (
  <Field label="Address" value={[profile.address, profile.address_unit].filter(Boolean).join(' ')} />
)}
{profile?.pickup_description && (
  <Field label="Pickup Spot" value={profile.pickup_description} />
)}
```

- [ ] **Step 4: Update the edit form in ProfileCard.tsx**

Inside the `<form>` element in the editing state, after the existing Phone `<div>` and before the closing `</div>` of the `grid grid-cols-1 gap-4`, add:

```tsx
{/* Address section */}
<div style={{ borderTop: '2px dashed #fed7aa', paddingTop: 16, marginTop: 4 }}>
  <p style={{ fontSize: 11, fontWeight: 900, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
    📍 Private Address
  </p>
  <div className="flex flex-col gap-4">
    <div>
      <EditLabel>Street Address</EditLabel>
      <input name="address" defaultValue={profile?.address ?? ''}
        placeholder="e.g. 123 Main St"
        className={inputClass} style={{ padding: '12px 16px' }} />
    </div>
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
  <p style={{ fontSize: 11, fontWeight: 900, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
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
```

- [ ] **Step 5: Update updateProfile in app/profile/actions.ts**

Replace the `updateProfile` function:

```ts
export async function updateProfile(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')
  await supabase.from('profiles').update({
    city:               formData.get('city')                as string,
    state:              formData.get('state')               as string,
    phone:              formData.get('phone')               as string,
    address:            (formData.get('address')            as string) || '',
    address_unit:       (formData.get('address_unit')       as string) || '',
    share_address:      formData.get('share_address')       === 'true',
    pickup_description: (formData.get('pickup_description') as string) || '',
    share_pickup:       formData.get('share_pickup')        === 'true',
  }).eq('id', user!.id)
  redirect('/profile?success=1')
}
```

- [ ] **Step 6: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: No new errors.

- [ ] **Step 7: Commit**

```bash
git add app/profile/ProfileCard.tsx app/profile/actions.ts
git commit -m "feat: add address and pickup fields to profile edit form"
```

---

### Task 6: Profile Page Queries + DashboardClient Types + Buyer Card + Mock Data

**Files:**
- Modify: `app/profile/page.tsx`
- Modify: `app/profile/DashboardClient.tsx`
- Modify: `lib/mock-data.ts`

**Interfaces:**
- Consumes: `buildConfirmationMessage` params (for understanding which fields buyer sees)
- Extends `Exchange.seller` type with: `address`, `address_unit`, `share_address`, `pickup_description`, `share_pickup`
- Extends `Exchange.listings` type with: `pickup_description`
- Extends `DashboardClient` `profile` prop type with new fields

- [ ] **Step 1: Update the profiles select query in app/profile/page.tsx**

Find this line (around line 99):
```ts
const { data: profileRows } = await supabase
  .from('profiles').select('id, username, city, state, phone').in('id', profileIds)
```

Replace with:
```ts
const { data: profileRows } = await supabase
  .from('profiles').select('id, username, city, state, phone, address, address_unit, share_address, pickup_description, share_pickup').in('id', profileIds)
```

- [ ] **Step 2: Update the listings select query in app/profile/page.tsx**

Find this line (around line 93):
```ts
const { data: listingRows } = await supabase
  .from('listings').select('id, title, author, photo_url, city, state').in('id', listingIds)
```

Replace with:
```ts
const { data: listingRows } = await supabase
  .from('listings').select('id, title, author, photo_url, city, state, pickup_description').in('id', listingIds)
```

- [ ] **Step 3: Update Exchange type in DashboardClient.tsx**

Find the `Exchange` type definition (around line 21) and replace the `seller` and `listings` shape:

```ts
type Exchange = {
  id: string
  listing_id: string
  buyer_id: string
  seller_id: string
  exchange_status: 'none' | 'requested' | 'confirmed'
  listings: {
    title: string
    author: string
    photo_url?: string | null
    city?: string | null
    state?: string | null
    pickup_description?: string | null
  }
  buyer: {
    username?: string | null
    name?: string | null
    city?: string | null
    state?: string | null
    phone?: string | null
  }
  seller: {
    username?: string | null
    name?: string | null
    city?: string | null
    state?: string | null
    phone?: string | null
    address?: string | null
    address_unit?: string | null
    share_address?: boolean | null
    pickup_description?: string | null
    share_pickup?: boolean | null
  }
}
```

- [ ] **Step 4: Update Props type in DashboardClient.tsx**

Find the `Props` type (around line 32) and update the `profile` shape to add the new fields after `phone`:

```ts
type Props = {
  profile: {
    id?: string | null
    name?: string | null
    username?: string | null
    email?: string | null
    city?: string | null
    state?: string | null
    phone?: string | null
    address?: string | null
    address_unit?: string | null
    share_address?: boolean | null
    pickup_description?: string | null
    share_pickup?: boolean | null
    created_at?: string | null
  } | null
  listings: Listing[]
  exchanges: Exchange[]
  updateAction: (formData: FormData) => Promise<void>
  updateListingStatus: (formData: FormData) => Promise<void>
  notifyPickedUp: (formData: FormData) => Promise<void>
  confirmExchange: (formData: FormData) => Promise<void>
  cancelPurchase: (formData: FormData) => Promise<void>
  success?: boolean
  defaultTab?: Tab
  queryError?: string | null
}
```

- [ ] **Step 5: Update the buyer confirmed card in DashboardClient.tsx**

Find the `role === 'buyer' && status === 'confirmed'` block (around line 313). Replace it with:

```tsx
{role === 'buyer' && status === 'confirmed' && (
  <div className="mt-2 rounded-[10px] px-3 py-2" style={{ background: '#f0fdf4', border: '1.5px solid #bbf7d0' }}>
    <p className="font-extrabold text-[12px]" style={{ color: '#166534' }}>📍 Ready for Pick Up!</p>
    {location && <p className="font-semibold text-[11px] mt-0.5" style={{ color: '#166534' }}>📌 {location}</p>}
    {ex.seller?.phone && (
      <p className="font-semibold text-[11px]" style={{ color: '#166534' }}>📞 {ex.seller.phone}</p>
    )}
    {ex.seller?.share_address && (ex.seller?.address || ex.seller?.address_unit) && (
      <p className="font-semibold text-[11px]" style={{ color: '#166534' }}>
        🏠 {[ex.seller.address, ex.seller.address_unit].filter(Boolean).join(' ')}
      </p>
    )}
    {ex.seller?.share_pickup && (() => {
      const pickup = ex.listings?.pickup_description || ex.seller?.pickup_description
      return pickup
        ? <p className="font-semibold text-[11px]" style={{ color: '#166534' }}>📦 Pickup: {pickup}</p>
        : null
    })()}
    <p className="font-semibold text-[11px]" style={{ color: '#166534' }}>Contact: <strong>{otherName}</strong></p>
  </div>
)}
```

- [ ] **Step 6: Update mock data in lib/mock-data.ts**

**a) Update MOCK_PROFILE** (add new fields after `contact_preference`):

```ts
export const MOCK_PROFILE = {
  id: MOCK_USER_ID,
  email: 'demo@littlebookexchange.com',
  username: 'demouser',
  name: 'Demo User',
  city: 'Chicago',
  state: 'IL',
  phone: '(312) 555-0100',
  contact_preference: 'email',
  address: '742 Evergreen Terrace',
  address_unit: '',
  share_address: true,
  pickup_description: 'front porch',
  share_pickup: true,
}
```

**b) Update the seller in `MOCK_CONVERSATIONS[2]`** (mock-convo-3, the confirmed exchange where demo user is buyer). Find the seller object for that conversation and add the new fields:

```ts
seller: {
  id: 'mock-user-5',
  username: 'jamesr',
  name: 'James R.',
  city: 'Oak Park',
  state: 'IL',
  phone: '(708) 555-0105',
  address: '555 Oak Ave',
  address_unit: 'Unit 3',
  share_address: true,
  pickup_description: 'back porch, ring doorbell',
  share_pickup: true,
},
```

- [ ] **Step 7: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 8: Run full test suite**

```bash
npm run test:run
```

Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
git add app/profile/page.tsx app/profile/DashboardClient.tsx lib/mock-data.ts
git commit -m "feat: show address and pickup spot in buyer confirmed exchange card"
```

---

### Task 7: Post Form — Per-Listing Pickup Description

**Files:**
- Modify: `app/post/PostForm.tsx`
- Modify: `app/post/actions.ts`

**Interfaces:**
- Produces: FormData field `pickup_description` (optional text) → stored as `listings.pickup_description`

- [ ] **Step 1: Add pickup_description field to PostForm.tsx**

In `app/post/PostForm.tsx`, inside the `{/* Extra Details */}` section, after the existing Description `<div>` (around line 219) and before the ISBN/Language grid, add:

```tsx
<div style={{ marginBottom: 18 }}>
  <FieldLabel optional>Pickup Spot for This Book</FieldLabel>
  <input
    name="pickup_description"
    type="text"
    placeholder="e.g. front porch, side gate — overrides your profile default"
    style={inputStyle}
  />
  <p style={{ fontSize: 11, color: '#bbb', fontWeight: 600, marginTop: 5 }}>
    🏠 Shared with the buyer after you approve their purchase. Overrides your profile pickup spot for this book only.
  </p>
</div>
```

- [ ] **Step 2: Persist pickup_description in app/post/actions.ts**

In `createListing`, add `pickup_description` to the insert object. Find the `.insert({` call and add the field after `city`:

```ts
pickup_description: (formData.get('pickup_description') as string) || null,
```

The full updated insert object:

```ts
const { data: listing, error } = await supabase.from('listings').insert({
  user_id:            user!.id,
  title:              formData.get('title')       as string,
  author:             formData.get('author')      as string,
  condition:          formData.get('condition')   as string,
  price,
  description:        (formData.get('description') as string) || null,
  genre:              (formData.get('genre')       as string) || null,
  format:             (formData.get('format')      as string) || null,
  photo_url,
  city:               prof?.city ?? '',
  pickup_description: (formData.get('pickup_description') as string) || null,
}).select('id').single()
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 4: Run full test suite**

```bash
npm run test:run
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/post/PostForm.tsx app/post/actions.ts
git commit -m "feat: add per-listing pickup description to post form"
```

---

## Done

All tasks complete when:
- `npm run test:run` — all tests green
- `npx tsc --noEmit` — no errors
- Demo mode (no Supabase) shows address + pickup spot in the confirmed exchange card
- Signup form has address fields + two ShareToggles (ON by default)
- Profile edit has the same fields
- Post form has a per-listing pickup description field
- `confirmExchange` builds a privacy-aware message using only opted-in fields
