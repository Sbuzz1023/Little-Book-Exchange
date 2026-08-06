# Credit Ledger Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "credits" a real, enforced balance — moved automatically when an exchange completes, backed by a real transaction ledger, with a one-time onboarding bonus (verify email + verify phone + post 3 books) and the UI to explain and track it.

**Architecture:** A Postgres migration (triggers + tables) does the actual value-moving and bonus-awarding atomically at the database layer, exactly at the moment `conversations.exchange_status` flips to `'completed'` or a user's verification/listing state changes. App code (Next.js server actions + React components) is a thin layer on top: it reads the resulting state, drives Supabase Auth's built-in email/phone verification APIs, and renders what the ledger already computed. No credit arithmetic happens in application code — only in the database triggers, so it can never be bypassed by a different code path.

**Tech Stack:** Next.js 14 (App Router), Supabase (Postgres + Auth), TypeScript, Vitest + React Testing Library.

## Global Constraints

- Schema changes are applied by pasting SQL into the Supabase SQL Editor by hand — this project has no local Supabase CLI/migration tooling. Every schema task's "test" is therefore a manual verification query, run and eyeballed, not an automated assertion.
- No server action (`'use server'` file) anywhere in this codebase has a unit test today — that convention holds here too. Only pure functions and React components get automated tests.
- Real-money credit purchasing is out of scope. The "Buy Credits" button becomes disabled with a "Coming soon" label, never wired to a payment flow.
- Configuring an SMS provider (e.g. Twilio) in Supabase Auth settings, and confirming "Confirm email" is enabled, are dashboard-level steps outside this codebase — the project owner does these separately. App code is written against Supabase's standard `updateUser`/`verifyOtp`/`resend` APIs regardless, and has nothing to send until those are configured.
- A buyer's balance is checked at purchase-request time only, not re-checked at completion (see spec's Known Limitation) — do not add a completion-time balance guard.

---

### Task 1: Database migration — credit ledger schema

**Files:**
- Modify: `supabase/schema.sql` (append new migration block at end of file)

**Interfaces:**
- Produces: `profiles.credits` (int), `profiles.email_verified`/`phone_verified`/`onboarding_bonus_claimed` (bool), `listings.book_count` (int, default 1), `credit_transactions` table (`user_id`, `amount`, `reason`, `listing_id`, `conversation_id`, `created_at`) — every later task in this plan reads or writes these.

- [ ] **Step 1: Append the migration block to `supabase/schema.sql`**

Add this at the end of the file, following the existing `-- ── Migration: ... ──` convention:

```sql
-- ── Migration: credit ledger foundation ───────────────────────────────────────

-- 1. Real balance + verification/bonus tracking on profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS credits integer NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_bonus_claimed boolean NOT NULL DEFAULT false;

-- 2. book_count defaults to 1 (today's single-book behavior). The separate
-- bundle-listings feature populates it for multi-book listings later.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS book_count integer NOT NULL DEFAULT 1;

-- 3. Transaction ledger
create table if not exists credit_transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  amount integer not null, -- positive = credited, negative = spent
  reason text not null check (reason in ('purchase_spent', 'sale_earned', 'onboarding_bonus', 'admin_adjustment')),
  listing_id uuid references listings(id) on delete set null,
  conversation_id uuid references conversations(id) on delete set null,
  created_at timestamptz default now()
);

alter table credit_transactions enable row level security;
create policy "Users can view own transactions" on credit_transactions
  for select using (auth.uid() = user_id);
-- No insert/update/delete policy for `authenticated` — every row is written by
-- security-definer trigger functions or the admin action, same pattern
-- notifications already uses.

-- 4. Sync Supabase Auth's own verification state onto profiles.
create or replace function sync_verification_status()
returns trigger as $$
begin
  update public.profiles
  set email_verified = (new.email_confirmed_at is not null),
      phone_verified  = (new.phone_confirmed_at is not null)
  where id = new.id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_verification_change on auth.users;
create trigger on_auth_user_verification_change
  after update of email_confirmed_at, phone_confirmed_at on auth.users
  for each row execute procedure sync_verification_status();

-- 5. Award the onboarding bonus the moment all three conditions are met.
create or replace function maybe_award_onboarding_bonus(p_user_id uuid)
returns void as $$
declare
  v_profile profiles%rowtype;
  v_books integer;
begin
  select * into v_profile from profiles where id = p_user_id;
  if v_profile.onboarding_bonus_claimed then return; end if;
  if not (v_profile.email_verified and v_profile.phone_verified) then return; end if;

  select coalesce(sum(book_count), 0) into v_books from listings where user_id = p_user_id;
  if v_books < 3 then return; end if;

  update profiles set credits = credits + 1, onboarding_bonus_claimed = true where id = p_user_id;
  insert into credit_transactions (user_id, amount, reason) values (p_user_id, 1, 'onboarding_bonus');
end;
$$ language plpgsql security definer;

create or replace function trg_award_bonus_on_verification()
returns trigger as $$
begin
  if (new.email_verified and new.phone_verified) and
     (old.email_verified is distinct from new.email_verified or old.phone_verified is distinct from new.phone_verified) then
    perform maybe_award_onboarding_bonus(new.id);
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists award_bonus_on_verification on profiles;
create trigger award_bonus_on_verification
  after update of email_verified, phone_verified on profiles
  for each row execute procedure trg_award_bonus_on_verification();

create or replace function trg_award_bonus_on_listing()
returns trigger as $$
begin
  perform maybe_award_onboarding_bonus(new.user_id);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists award_bonus_on_listing on listings;
create trigger award_bonus_on_listing
  after insert on listings
  for each row execute procedure trg_award_bonus_on_listing();

-- 6. Retroactive backfill: sync existing auth.users verification state, then
-- evaluate every existing user once. Safe to re-run.
update profiles p set
  email_verified = (u.email_confirmed_at is not null),
  phone_verified  = (u.phone_confirmed_at is not null)
from auth.users u where u.id = p.id;

do $$
declare v_id uuid;
begin
  for v_id in select id from profiles loop
    perform maybe_award_onboarding_bonus(v_id);
  end loop;
end $$;

-- 7. Move credits buyer -> seller the moment an exchange completes. Extends
-- the existing completed-exchange trigger function (already fires
-- `after update on conversations` — no trigger-registration change needed).
create or replace function complete_exchange_marks_listing_sold()
returns trigger as $$
declare
  v_book_count integer;
begin
  if new.exchange_status = 'completed' and old.exchange_status is distinct from 'completed' then
    update listings set status = 'sold' where id = new.listing_id returning book_count into v_book_count;

    update profiles set credits = credits - v_book_count where id = new.buyer_id;
    update profiles set credits = credits + v_book_count where id = new.seller_id;

    insert into credit_transactions (user_id, amount, reason, listing_id, conversation_id)
    values (new.buyer_id, -v_book_count, 'purchase_spent', new.listing_id, new.id);
    insert into credit_transactions (user_id, amount, reason, listing_id, conversation_id)
    values (new.seller_id, v_book_count, 'sale_earned', new.listing_id, new.id);
  end if;
  return new;
end;
$$ language plpgsql security definer;
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Run the migration**

Paste the entire block into the Supabase project's SQL Editor and run it. Expected: no errors; "Success. No rows returned" (except the `do $$ ... $$` backfill block, which also returns no rows but processes every existing user).

- [ ] **Step 3: Manually verify the schema landed correctly**

Run in the SQL Editor:

```sql
select column_name from information_schema.columns
where table_name = 'profiles' and column_name in ('credits', 'email_verified', 'phone_verified', 'onboarding_bonus_claimed');
```
Expected: 4 rows.

```sql
select column_name, column_default from information_schema.columns
where table_name = 'listings' and column_name = 'book_count';
```
Expected: 1 row, `column_default` = `1`.

```sql
select count(*) from listings where book_count is distinct from 1;
```
Expected: `0` (every existing listing is a single book).

- [ ] **Step 4: Manually verify the completion trigger moves credits**

Pick any two existing test/dummy accounts' `profiles.id` values (or create two throwaway ones), note their starting `credits`, then simulate a completed exchange directly:

```sql
-- substitute real ids
insert into conversations (listing_id, buyer_id, seller_id, exchange_status)
values ('<any existing listing id>', '<buyer id>', '<seller id>', 'confirmed')
returning id;
-- then, using the returned id:
update conversations set exchange_status = 'completed' where id = '<returned id>';

select id, credits from profiles where id in ('<buyer id>', '<seller id>');
select * from credit_transactions where conversation_id = '<returned id>';
```
Expected: buyer's `credits` decreased by the listing's `book_count` (1), seller's increased by 1, two new `credit_transactions` rows (`purchase_spent` and `sale_earned`). Clean up the test conversation row afterward (`delete from conversations where id = '<returned id>'`) so it doesn't pollute real exchange history.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: add credit ledger schema — balance, transactions, onboarding bonus"
```

---

### Task 2: Verification server actions

**Files:**
- Create: `lib/actions/verification.ts`

**Interfaces:**
- Consumes: `@/lib/supabase/server`'s `createClient()` (existing pattern used by every other action file).
- Produces: `resendEmailConfirmation(): Promise<{ ok: boolean; error?: string }>`, `sendPhoneOtp(formData: FormData): Promise<{ ok: boolean; error?: string }>` (reads `phone` field), `verifyPhoneOtp(formData: FormData): Promise<{ ok: boolean; error?: string }>` (reads `phone`, `token` fields) — Tasks 7 and 8 wire these into the Wallet UI.

No automated test for this file — matches this codebase's established convention that server actions aren't unit tested (see Global Constraints).

- [ ] **Step 1: Write the actions**

```ts
'use server'

import { createClient } from '@/lib/supabase/server'

export async function resendEmailConfirmation(): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { ok: false, error: 'Please sign in.' }

  const { error } = await supabase.auth.resend({ type: 'signup', email: user.email })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function sendPhoneOtp(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please sign in.' }

  const phone = formData.get('phone') as string
  if (!phone) return { ok: false, error: 'Enter a phone number.' }

  const { error } = await supabase.auth.updateUser({ phone })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function verifyPhoneOtp(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please sign in.' }

  const phone = formData.get('phone') as string
  const token = formData.get('token') as string
  if (!phone || !token) return { ok: false, error: 'Enter the code you received.' }

  const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'phone_change' })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "lib/actions/verification"`
Expected: no output (no errors in this file — the project has one pre-existing unrelated error elsewhere, e.g. `app/listings/page.tsx:103`; ignore anything not in `lib/actions/verification.ts`).

- [ ] **Step 3: Commit**

```bash
git add lib/actions/verification.ts
git commit -m "feat: add email/phone verification server actions"
```

---

### Task 3: Admin credits action

**Files:**
- Create: `lib/actions/admin.ts`

**Interfaces:**
- Consumes: `requireAdmin` from `@/lib/actions/libraryLocations` (existing helper).
- Produces: `adminUpdateUserCredits(userId: string, credits: number): Promise<{ ok: boolean; error?: string }>` — Task 10 calls this.

No automated test (server action, see Global Constraints).

- [ ] **Step 1: Write the action**

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from './libraryLocations'

export async function adminUpdateUserCredits(userId: string, credits: number): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const { data: before } = await supabase.from('profiles').select('credits').eq('id', userId).single()
  if (!before) return { ok: false, error: 'User not found.' }

  const delta = credits - before.credits
  if (delta === 0) return { ok: true }

  const { error } = await supabase.from('profiles').update({ credits }).eq('id', userId)
  if (error) return { ok: false, error: error.message }

  await supabase.from('credit_transactions').insert({
    user_id: userId,
    amount: delta,
    reason: 'admin_adjustment',
  })

  return { ok: true }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "lib/actions/admin"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add lib/actions/admin.ts
git commit -m "feat: add admin credit-adjustment action"
```

---

### Task 4: Purchase-time balance check

**Files:**
- Modify: `app/listings/[id]/page.tsx`

**Interfaces:**
- Consumes: `listing.book_count` (from Task 1's schema), `listing.credits`-check reads `profiles.credits`.

No automated test (server component page, no existing test precedent for this file — see Global Constraints). Verified manually.

- [ ] **Step 1: Add the balance check to `requestPurchase`**

Find this block (currently right after `if (!u) redirect(...)`):

```ts
      const { data: locked } = await supabase.rpc('lock_listing_for_request', { p_listing_id: listing.id })
```

Insert the balance check immediately before it:

```ts
      const { data: buyerProfile } = await supabase.from('profiles').select('credits').eq('id', u!.id).single()
      if (!buyerProfile || buyerProfile.credits < listing.book_count) {
        redirect(`/listings/${params.id}?insufficient_credits=1`)
      }

      const { data: locked } = await supabase.rpc('lock_listing_for_request', { p_listing_id: listing.id })
```

- [ ] **Step 2: Ensure `listing`'s query includes `book_count`**

Find the listing detail fetch (the `supabase.from('listings').select(...)` call earlier in this file) and confirm it uses `select('*')` or explicitly lists `book_count`. If it lists columns explicitly, add `book_count` to that list.

- [ ] **Step 3: Render the insufficient-credits notice**

Find where the page already reads other purchase-flow search params (e.g. `searchParams.purchase_failed`) and add the same pattern for `insufficient_credits`:

```ts
{searchParams.insufficient_credits === '1' && (
  <div className="bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-red-700 font-bold text-sm mb-4">
    You don't have enough credits for this. Check your Wallet balance.
  </div>
)}
```
Place it in the same banner slot the existing `purchase_failed` notice uses (adjacent conditional, same styling).

- [ ] **Step 4: Manual verification**

Run `npm run dev`, sign in as a test user with `credits = 0` (set directly via SQL Editor: `update profiles set credits = 0 where id = '<test user id>'`), open any listing that isn't yours, click "Purchase with 1 Credit". Expected: redirected back to the listing with the red "You don't have enough credits" banner, and no `conversations` row was created (`select * from conversations where buyer_id = '<test user id>'` returns nothing new).

- [ ] **Step 5: Commit**

```bash
git add "app/listings/[id]/page.tsx"
git commit -m "feat: block purchase requests when buyer lacks enough credits"
```

---

### Task 5: Real balance + disabled Buy Credits button

**Files:**
- Modify: `app/profile/DashboardClient.tsx`
- Test: `app/profile/DashboardClient.test.tsx`

**Interfaces:**
- Consumes: `profile.credits?: number` (new optional field on the existing `Props.profile` type).
- Produces: nothing new consumed by later tasks — this task is a self-contained display fix.

- [ ] **Step 1: Write the failing test**

Add to `app/profile/DashboardClient.test.tsx` (new `describe` block):

```ts
describe('DashboardClient — wallet balance', () => {
  it('shows the real credit balance instead of a hardcoded 0', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} profile={{ ...baseProps.profile, credits: 7 }} defaultTab="wallet" />)
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('disables the Buy Credits button with a Coming soon label', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} defaultTab="wallet" />)
    const buyButton = screen.getByRole('button', { name: /Buy Credits/ })
    expect(buyButton).toBeDisabled()
    expect(buyButton.textContent).toMatch(/Coming soon/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/profile/DashboardClient.test.tsx -t "wallet balance"`
Expected: FAIL — balance still hardcoded to `0` (so `getByText('7')` finds nothing) and the Buy Credits button isn't disabled.

- [ ] **Step 3: Add `credits` to the `Props.profile` type**

In the `Props` type's `profile` object (near the top of the file), add:

```ts
    credits?: number | null
    email_verified?: boolean | null
    phone_verified?: boolean | null
    onboarding_bonus_claimed?: boolean | null
```

- [ ] **Step 4: Wire the real balance and disable the button**

Find:

```tsx
            <div className="flex items-end gap-3 mb-2">
              <span className="font-display text-[48px] text-white leading-none">0</span>
              <span className="font-extrabold text-[18px] mb-1" style={{ color: 'rgba(255,255,255,0.7)' }}>credits</span>
            </div>
```

Replace with:

```tsx
            <div className="flex items-end gap-3 mb-2">
              <span className="font-display text-[48px] text-white leading-none">{profile?.credits ?? 0}</span>
              <span className="font-extrabold text-[18px] mb-1" style={{ color: 'rgba(255,255,255,0.7)' }}>credits</span>
            </div>
```

Find the Buy Credits button:

```tsx
            <button
              className="font-extrabold text-[14px] w-full"
              style={{
                background: '#10b981',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                padding: '13px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                boxShadow: '0 3px 0 #059669',
              }}
            >
              💳 Buy Credits — $5 each
            </button>
```

Replace with:

```tsx
            <button
              disabled
              className="font-extrabold text-[14px] w-full"
              style={{
                background: '#9ca3af',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                padding: '13px',
                cursor: 'not-allowed',
                fontFamily: 'inherit',
                boxShadow: '0 3px 0 #6b7280',
              }}
            >
              💳 Buy Credits — Coming soon
            </button>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run app/profile/DashboardClient.test.tsx -t "wallet balance"`
Expected: PASS.

- [ ] **Step 6: Run the full test file to confirm nothing else broke**

Run: `npx vitest run app/profile/DashboardClient.test.tsx`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add app/profile/DashboardClient.tsx app/profile/DashboardClient.test.tsx
git commit -m "feat: show real credit balance, disable Buy Credits button"
```

---

### Task 6: Real transaction history

**Files:**
- Modify: `app/profile/page.tsx`
- Modify: `app/profile/DashboardClient.tsx`
- Test: `app/profile/DashboardClient.test.tsx`

**Interfaces:**
- Consumes: `credit_transactions` table (Task 1).
- Produces: `Props.transactions: { id: string; amount: number; reason: string; created_at: string }[]` — no later task consumes this directly, but it's the last piece of the Wallet tab's real-data surface.

- [ ] **Step 1: Write the failing test**

```ts
describe('DashboardClient — transaction history', () => {
  const tx = [
    { id: 't1', amount: -1, reason: 'purchase_spent', created_at: '2026-08-01T00:00:00.000Z' },
    { id: 't2', amount: 1, reason: 'sale_earned', created_at: '2026-08-02T00:00:00.000Z' },
  ]

  it('renders real transactions when present', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} transactions={tx} defaultTab="wallet" />)
    expect(screen.getByText(/Spent 1 credit/)).toBeInTheDocument()
    expect(screen.getByText(/Earned 1 credit/)).toBeInTheDocument()
  })

  it('shows the empty state when there are no transactions', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} transactions={[]} defaultTab="wallet" />)
    expect(screen.getByText('No transactions yet.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/profile/DashboardClient.test.tsx -t "transaction history"`
Expected: FAIL — `transactions` prop doesn't exist yet (TS error) and the mock data still renders instead.

- [ ] **Step 3: Add the `transactions` prop and remove `MOCK_TRANSACTIONS`**

Add to `Props`:

```ts
  transactions: { id: string; amount: number; reason: string; created_at: string }[]
```

Delete the `MOCK_TRANSACTIONS` constant entirely. Destructure `transactions` in the component's prop list alongside the existing props.

- [ ] **Step 4: Render real transactions**

Replace the Transaction History block:

```tsx
          <div style={cardStyle}>
            <h3 className="font-display text-[18px] mb-4" style={{ color: '#059669' }}>Transaction History</h3>
            {transactions.length === 0 ? (
              <div className="text-center py-8 font-bold text-[14px]" style={{ color: '#aaa' }}>
                No transactions yet.
              </div>
            ) : (
              <div>
                {transactions.map((tx, i) => {
                  const label =
                    tx.reason === 'purchase_spent' ? `Spent ${Math.abs(tx.amount)} credit${Math.abs(tx.amount) === 1 ? '' : 's'}` :
                    tx.reason === 'sale_earned'    ? `Earned ${tx.amount} credit${tx.amount === 1 ? '' : 's'} from a sale` :
                    tx.reason === 'onboarding_bonus' ? 'Welcome bonus' :
                    'Admin adjustment'
                  const icon = tx.reason === 'purchase_spent' ? '💳' : tx.reason === 'sale_earned' ? '🤝' : '🎁'
                  const color = tx.amount >= 0 ? '#059669' : '#e11d48'
                  return (
                    <div key={tx.id} className="flex items-center gap-3"
                      style={{ padding: '12px 0', borderBottom: i < transactions.length - 1 ? '2px solid #f3f4f6' : 'none' }}>
                      <div className="flex items-center justify-center shrink-0"
                        style={{ width: 38, height: 38, borderRadius: 10, background: color + '18', fontSize: 18 }}>
                        {icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-[13px] truncate">{label}</p>
                        <p className="font-semibold text-[11px]" style={{ color: '#aaa' }}>
                          {new Date(tx.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      </div>
                      <span className="font-black text-[15px] shrink-0" style={{ color }}>
                        {tx.amount >= 0 ? '+' : ''}{tx.amount}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
```

- [ ] **Step 5: Fetch real transactions in `app/profile/page.tsx`**

Add `let transactions: any[] = []` alongside the other `let` declarations near the top of the file (defaults to `[]` for the demo branch, matching `savedListings`/`tbrEntries`).

In the non-demo (`else`) branch, after the existing `profile`/`listings` fetch, add:

```ts
      const { data: txRows } = await supabase
        .from('credit_transactions').select('id, amount, reason, created_at')
        .eq('user_id', user.id).order('created_at', { ascending: false })
      transactions = txRows ?? []
```

Pass it into the component:

```tsx
      transactions={transactions}
```

(add alongside the other props on the `<DashboardClient ... />` call site).

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run app/profile/DashboardClient.test.tsx -t "transaction history"`
Expected: PASS.

- [ ] **Step 7: Run the full test file**

Run: `npx vitest run app/profile/DashboardClient.test.tsx`
Expected: all tests PASS (fix any other call site in the test file that renders `<DashboardClient>` without a `transactions` prop by adding `transactions={[]}` to `baseProps`).

- [ ] **Step 8: Commit**

```bash
git add app/profile/page.tsx app/profile/DashboardClient.tsx app/profile/DashboardClient.test.tsx
git commit -m "feat: replace mock transaction history with real credit_transactions data"
```

---

### Task 7: Onboarding checklist — email step + books-posted step

**Files:**
- Modify: `app/profile/DashboardClient.tsx`
- Test: `app/profile/DashboardClient.test.tsx`

**Interfaces:**
- Consumes: `resendEmailConfirmation` from Task 2, `profile.email_verified`/`onboarding_bonus_claimed`, `listings` prop (already exists) summed by `book_count`.
- Produces: `Props.resendEmailConfirmation: () => Promise<{ ok: boolean; error?: string }>` — a new prop later wired by `app/profile/page.tsx` in this same task.

- [ ] **Step 1: Write the failing test**

```ts
describe('DashboardClient — onboarding checklist', () => {
  const unclaimedProfile = { ...baseProps.profile, email_verified: false, phone_verified: false, onboarding_bonus_claimed: false }

  it('shows the checklist with books-posted progress when the bonus is unclaimed', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} transactions={[]} profile={unclaimedProfile}
      listings={[{ id: 'l1', title: 'Dune', author: 'Herbert', condition: 'Good', status: 'active' }]}
      defaultTab="wallet" resendEmailConfirmation={vi.fn()} />)
    expect(screen.getByText('Earn Your First Credit')).toBeInTheDocument()
    expect(screen.getByText('1/3')).toBeInTheDocument()
  })

  it('shows the bonus-earned message instead of the checklist once claimed', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} transactions={[]}
      profile={{ ...unclaimedProfile, onboarding_bonus_claimed: true }}
      defaultTab="wallet" resendEmailConfirmation={vi.fn()} />)
    expect(screen.getByText(/Bonus earned/)).toBeInTheDocument()
    expect(screen.queryByText('Earn Your First Credit')).not.toBeInTheDocument()
  })

  it('calls resendEmailConfirmation when the resend button is clicked', async () => {
    const resend = vi.fn(() => Promise.resolve({ ok: true }))
    render(<DashboardClient {...baseProps} exchanges={[]} transactions={[]} profile={unclaimedProfile} defaultTab="wallet" resendEmailConfirmation={resend} />)
    fireEvent.click(screen.getByRole('button', { name: /Resend confirmation email/ }))
    expect(resend).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/profile/DashboardClient.test.tsx -t "onboarding checklist"`
Expected: FAIL — no checklist card exists yet, `resendEmailConfirmation` prop doesn't exist (TS error).

- [ ] **Step 3: Add the prop and the books-posted helper**

Add to `Props`:

```ts
  resendEmailConfirmation: () => Promise<{ ok: boolean; error?: string }>
```

Near the top of the component body (alongside other derived values), add:

```ts
  const booksPosted = listings.reduce((sum, l: any) => sum + (l.book_count ?? 1), 0)
```

- [ ] **Step 4: Render the checklist card**

Insert immediately before the existing "Balance card" `<div>` inside the `wallet` tab block:

```tsx
          {!profile?.onboarding_bonus_claimed && (
            <div style={{ ...cardStyle, border: '2px solid #a7f3d0' }}>
              <h3 className="font-display text-[16px] mb-3" style={{ color: '#059669' }}>🎯 Earn Your First Credit</h3>
              <div className="flex flex-col" style={{ gap: 10 }}>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[13px]">{profile?.email_verified ? '✅' : '☐'} Verify email</span>
                  {!profile?.email_verified && (
                    <button
                      type="button"
                      onClick={() => resendEmailConfirmation()}
                      className="font-extrabold text-[12px]"
                      style={{ background: 'none', border: 'none', color: '#059669', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}
                    >
                      Resend confirmation email
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[13px]">{profile?.phone_verified ? '✅' : '☐'} Verify phone</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[13px]">{booksPosted >= 3 ? '✅' : '☐'} Books posted</span>
                  <span className="font-extrabold text-[12px]" style={{ color: '#aaa' }}>{Math.min(booksPosted, 3)}/3</span>
                </div>
              </div>
            </div>
          )}
          {profile?.onboarding_bonus_claimed && (
            <div style={{ ...cardStyle, border: '2px solid #a7f3d0', textAlign: 'center' }}>
              <p className="font-black text-[14px]" style={{ color: '#059669' }}>🎉 Bonus earned — you got 1 free credit!</p>
            </div>
          )}
```

(The phone-verify row's button is added in Task 8 — leave it as a static status row here.)

- [ ] **Step 5: Wire the prop in `app/profile/page.tsx`**

```ts
import { resendEmailConfirmation } from '@/lib/actions/verification'
```

Add `resendEmailConfirmation={resendEmailConfirmation}` to the `<DashboardClient ... />` call site.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run app/profile/DashboardClient.test.tsx -t "onboarding checklist"`
Expected: PASS.

- [ ] **Step 7: Run the full test file**

Run: `npx vitest run app/profile/DashboardClient.test.tsx`
Expected: all tests PASS (add `resendEmailConfirmation={vi.fn()}` to `baseProps` if other existing tests in this file now fail to render the wallet tab; tests that don't visit the wallet tab are unaffected).

- [ ] **Step 8: Commit**

```bash
git add app/profile/page.tsx app/profile/DashboardClient.tsx app/profile/DashboardClient.test.tsx
git commit -m "feat: add onboarding checklist card (email + books-posted steps)"
```

---

### Task 8: Onboarding checklist — phone OTP step

**Files:**
- Modify: `app/profile/DashboardClient.tsx`
- Test: `app/profile/DashboardClient.test.tsx`

**Interfaces:**
- Consumes: `sendPhoneOtp`, `verifyPhoneOtp` from Task 2, `profile.phone`.
- Produces: `Props.sendPhoneOtp`, `Props.verifyPhoneOtp` (same `(formData) => Promise<{ok, error?}>` shape) — wired in `app/profile/page.tsx` in this task, nothing later consumes these directly.

- [ ] **Step 1: Write the failing test**

```ts
describe('DashboardClient — phone verification', () => {
  const unverifiedProfile = { ...baseProps.profile, email_verified: true, phone_verified: false, onboarding_bonus_claimed: false, phone: '3125550100' }

  it('sends an OTP and then verifies it', async () => {
    const sendOtp = vi.fn(() => Promise.resolve({ ok: true }))
    const verifyOtp = vi.fn(() => Promise.resolve({ ok: true }))
    render(<DashboardClient {...baseProps} exchanges={[]} transactions={[]} profile={unverifiedProfile}
      defaultTab="wallet" resendEmailConfirmation={vi.fn()} sendPhoneOtp={sendOtp} verifyPhoneOtp={verifyOtp} />)

    fireEvent.click(screen.getByRole('button', { name: /Verify Phone/ }))
    fireEvent.click(screen.getByRole('button', { name: /Send code/ }))
    expect(sendOtp).toHaveBeenCalled()

    const codeInput = await screen.findByPlaceholderText(/6-digit code/)
    fireEvent.change(codeInput, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /Confirm code/ }))
    expect(verifyOtp).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/profile/DashboardClient.test.tsx -t "phone verification"`
Expected: FAIL — no "Verify Phone" button exists yet, `sendPhoneOtp`/`verifyPhoneOtp` props don't exist (TS error).

- [ ] **Step 3: Add props and local state**

Add to `Props`:

```ts
  sendPhoneOtp: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
  verifyPhoneOtp: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
```

Near the top of the component body, alongside the other `useState` calls:

```ts
  const [phoneStep, setPhoneStep] = useState<'idle' | 'code_sent'>('idle')
  const [phoneError, setPhoneError] = useState<string | null>(null)
```

- [ ] **Step 4: Replace the static phone row with the interactive flow**

Replace:

```tsx
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[13px]">{profile?.phone_verified ? '✅' : '☐'} Verify phone</span>
                </div>
```

With:

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
                        id="phone-otp-number" type="tel" defaultValue={profile?.phone ?? ''}
                        className="border-2 border-[#a7f3d0] rounded-lg px-2 py-1.5 font-bold text-[12px]"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          const fd = new FormData()
                          fd.set('phone', (document.getElementById('phone-otp-number') as HTMLInputElement).value)
                          const res = await sendPhoneOtp(fd)
                          setPhoneError(res.ok ? null : (res.error ?? 'Failed to send code.'))
                        }}
                        className="font-extrabold text-[12px] self-start"
                        style={{ background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        Send code
                      </button>
                      <input
                        id="phone-otp-code" type="text" placeholder="Enter 6-digit code"
                        className="border-2 border-[#a7f3d0] rounded-lg px-2 py-1.5 font-bold text-[12px]"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          const fd = new FormData()
                          fd.set('phone', (document.getElementById('phone-otp-number') as HTMLInputElement).value)
                          fd.set('token', (document.getElementById('phone-otp-code') as HTMLInputElement).value)
                          const res = await verifyPhoneOtp(fd)
                          if (res.ok) { setPhoneStep('idle'); setPhoneError(null) }
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

- [ ] **Step 5: Wire the props in `app/profile/page.tsx`**

```ts
import { resendEmailConfirmation, sendPhoneOtp, verifyPhoneOtp } from '@/lib/actions/verification'
```

Add `sendPhoneOtp={sendPhoneOtp}` and `verifyPhoneOtp={verifyPhoneOtp}` to the `<DashboardClient ... />` call site.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run app/profile/DashboardClient.test.tsx -t "phone verification"`
Expected: PASS.

- [ ] **Step 7: Run the full test file**

Run: `npx vitest run app/profile/DashboardClient.test.tsx`
Expected: all tests PASS (add `sendPhoneOtp={vi.fn()}` and `verifyPhoneOtp={vi.fn()}` to `baseProps`).

- [ ] **Step 8: Commit**

```bash
git add app/profile/page.tsx app/profile/DashboardClient.tsx app/profile/DashboardClient.test.tsx
git commit -m "feat: add phone OTP verification flow to onboarding checklist"
```

---

### Task 9: Wallet tab badge

**Files:**
- Modify: `app/profile/DashboardClient.tsx`
- Test: `app/profile/DashboardClient.test.tsx`

**Interfaces:**
- Consumes: `profile.onboarding_bonus_claimed`.

- [ ] **Step 1: Write the failing test**

```ts
describe('DashboardClient — wallet badge', () => {
  it('shows a badge on the Wallet tab while the bonus is unclaimed', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} transactions={[]}
      profile={{ ...baseProps.profile, onboarding_bonus_claimed: false }} defaultTab="listings" />)
    const walletButton = screen.getByText('Wallet').closest('button')!
    expect(walletButton.querySelector('[data-testid="tab-badge"]')).not.toBeNull()
  })

  it('shows no badge once the bonus is claimed', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} transactions={[]}
      profile={{ ...baseProps.profile, onboarding_bonus_claimed: true }} defaultTab="listings" />)
    const walletButton = screen.getByText('Wallet').closest('button')!
    expect(walletButton.querySelector('[data-testid="tab-badge"]')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/profile/DashboardClient.test.tsx -t "wallet badge"`
Expected: FAIL — `tabBadgeCount` has no `wallet` case, so no badge ever renders.

- [ ] **Step 3: Add the `wallet` case**

Find:

```ts
  function tabBadgeCount(id: Tab): number {
    if (id === 'exchanges') return unreadCounts.exchanges
    if (id === 'tbr') return unreadCounts.tbr
    if (id === 'messages') return unreadCounts.messages
    return 0
  }
```

Replace with:

```ts
  function tabBadgeCount(id: Tab): number {
    if (id === 'exchanges') return unreadCounts.exchanges
    if (id === 'tbr') return unreadCounts.tbr
    if (id === 'messages') return unreadCounts.messages
    if (id === 'wallet') return profile?.onboarding_bonus_claimed ? 0 : 1
    return 0
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/profile/DashboardClient.test.tsx -t "wallet badge"`
Expected: PASS.

- [ ] **Step 5: Run the full test file**

Run: `npx vitest run app/profile/DashboardClient.test.tsx`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add app/profile/DashboardClient.tsx app/profile/DashboardClient.test.tsx
git commit -m "feat: badge the Wallet tab while the onboarding bonus is unclaimed"
```

---

### Task 10: Admin panel — real credits

**Files:**
- Modify: `app/admin/AdminClient.tsx`

**Interfaces:**
- Consumes: `adminUpdateUserCredits` from Task 3.

No automated test — `app/admin` has no existing test coverage at all (see Global Constraints); verified manually.

- [ ] **Step 1: Include `credits` in the Users fetch**

Find:

```ts
    supabase
      .from('profiles')
      .select('id, username, email, city, state, created_at, is_admin')
```

Replace with:

```ts
    supabase
      .from('profiles')
      .select('id, username, email, city, state, created_at, is_admin, credits')
```

Find the mapped row (`credits: 0,`) a few lines below and replace with `credits: p.credits ?? 0,`.

- [ ] **Step 2: Persist credit edits in `saveEdit`**

```ts
import { adminUpdateUserCredits } from '@/lib/actions/admin'
```

Find:

```ts
  function saveEdit() {
    if (!form) return
    setUsers(prev => prev.map(u => u.id === form.id ? form : u))
    setEditTarget(null)
  }
```

Replace with:

```ts
  async function saveEdit() {
    if (!form) return
    if (editTarget && form.credits !== editTarget.credits) {
      await adminUpdateUserCredits(form.id, form.credits)
    }
    setUsers(prev => prev.map(u => u.id === form.id ? form : u))
    setEditTarget(null)
  }
```

(`editTarget` already holds the pre-edit snapshot set by `openEdit`.)

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "AdminClient"`
Expected: no output.

- [ ] **Step 4: Manual verification**

Run `npm run dev`, sign in as an admin user, open Admin → Users, edit any user's Credits field to a new value, save. Then check in the Supabase SQL Editor: `select credits from profiles where id = '<that user id>'` reflects the new value, and `select * from credit_transactions where user_id = '<that user id>' order by created_at desc limit 1` shows a new `admin_adjustment` row with the correct `amount` (the delta, not the absolute new value).

- [ ] **Step 5: Commit**

```bash
git add app/admin/AdminClient.tsx
git commit -m "feat: wire admin credit edits to the real ledger"
```

---

### Task 11: Post-signup welcome popup

**Files:**
- Create: `components/WelcomeBonusModal.tsx`
- Test: `components/WelcomeBonusModal.test.tsx`
- Modify: `app/page.tsx`
- Modify: `app/auth/signup/page.tsx`

**Interfaces:**
- Produces: `<WelcomeBonusModal />` — a self-contained client component reading its own state from the URL, mounted once in `app/page.tsx`.

- [ ] **Step 1: Write the failing test**

Create `components/WelcomeBonusModal.test.tsx`:

```ts
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import WelcomeBonusModal from './WelcomeBonusModal'

const replaceMock = vi.fn()
let mockSearch = ''

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  useRouter: () => ({ replace: replaceMock }),
}))

describe('WelcomeBonusModal', () => {
  beforeEach(() => {
    replaceMock.mockClear()
    mockSearch = ''
  })

  it('renders nothing when the welcome param is absent', () => {
    render(<WelcomeBonusModal />)
    expect(screen.queryByText(/Welcome to Little Book Exchange/)).not.toBeInTheDocument()
  })

  it('shows the bonus explanation when ?welcome=1 is present', () => {
    mockSearch = 'welcome=1'
    render(<WelcomeBonusModal />)
    expect(screen.getByText(/Welcome to Little Book Exchange/)).toBeInTheDocument()
    expect(screen.getByText(/Verify email/)).toBeInTheDocument()
    expect(screen.getByText(/Verify phone/)).toBeInTheDocument()
    expect(screen.getByText(/[Pp]ost 3 books/)).toBeInTheDocument()
  })

  it('navigates to the wallet (replacing history, not pushing) when dismissed', () => {
    mockSearch = 'welcome=1'
    render(<WelcomeBonusModal />)
    fireEvent.click(screen.getByRole('button', { name: /Take me to my Wallet/ }))
    expect(replaceMock).toHaveBeenCalledWith('/profile?tab=wallet')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/WelcomeBonusModal.test.tsx`
Expected: FAIL — `./WelcomeBonusModal` doesn't exist.

- [ ] **Step 3: Write the component**

Create `components/WelcomeBonusModal.tsx`:

```tsx
'use client'

import { useRouter, useSearchParams } from 'next/navigation'

export default function WelcomeBonusModal() {
  const searchParams = useSearchParams()
  const router = useRouter()

  if (searchParams.get('welcome') !== '1') return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
    >
      <div
        className="bg-white max-w-[420px] w-full text-center"
        style={{ borderRadius: 24, padding: 32, border: '2px solid #fed7aa', boxShadow: '0 8px 0 #e5e7eb' }}
      >
        <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
        <h2 className="font-display text-[22px] text-bk-orange mb-2">Welcome to Little Book Exchange!</h2>
        <p className="font-semibold text-[14px] mb-5" style={{ color: '#666' }}>
          Earn your first free credit by completing three quick steps:
        </p>
        <div className="text-left font-bold text-[13px] flex flex-col mb-6" style={{ gap: 8, color: '#444' }}>
          <p>☐ Verify email</p>
          <p>☐ Verify phone</p>
          <p>☐ Post 3 books</p>
        </div>
        <button
          type="button"
          onClick={() => router.replace('/profile?tab=wallet')}
          className="block w-full text-white font-black text-[15px]"
          style={{ background: '#f97316', padding: 14, borderRadius: 14, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Take me to my Wallet →
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/WelcomeBonusModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mount it in `app/page.tsx`**

```tsx
import WelcomeBonusModal from '@/components/WelcomeBonusModal'
```

Add `<WelcomeBonusModal />` as the first child inside the top-level `<>...</>` fragment `HomePage` returns.

- [ ] **Step 6: Point signup's success redirect at it**

In `app/auth/signup/page.tsx`, find:

```ts
      redirect('/')
```

Replace with:

```ts
      redirect('/?welcome=1')
```

- [ ] **Step 7: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "WelcomeBonusModal|app/page.tsx|app/auth/signup"`
Expected: no output.

- [ ] **Step 8: Manual verification**

Run `npm run dev`, sign up a new test account, confirm the modal appears on the homepage immediately after redirect. Click "Take me to my Wallet →" and confirm it navigates to `/profile?tab=wallet`. Then navigate back to `/` (e.g. via the nav logo) and confirm the modal does not reappear, and confirm the browser's back button from `/profile?tab=wallet` does not return to a `?welcome=1` history entry (the replace navigation should have dropped it).

- [ ] **Step 9: Commit**

```bash
git add components/WelcomeBonusModal.tsx components/WelcomeBonusModal.test.tsx app/page.tsx app/auth/signup/page.tsx
git commit -m "feat: add post-signup welcome popup explaining the credit bonus"
```

---

## Self-Review Notes

- **Spec coverage:** real balance (Task 5) ✓, transaction ledger (Tasks 1, 6) ✓, credit transfer at completion (Task 1) ✓, purchase-time balance check (Task 4) ✓, onboarding bonus — email/phone/3-books, retroactive (Task 1), UI (Tasks 7, 8) ✓, badge (Task 9) ✓, welcome popup (Task 11) ✓, admin integration (Tasks 3, 10) ✓, disabled Buy Credits button (Task 5) ✓.
- **Placeholder scan:** no TBD/TODO; every step has complete, real code.
- **Type consistency:** `resendEmailConfirmation`/`sendPhoneOtp`/`verifyPhoneOtp` signatures match between Task 2 (definition) and Tasks 7/8 (props + call sites) — all `{ ok: boolean; error?: string }`, matching the existing `submitReview` action's established return shape. `adminUpdateUserCredits(userId, credits)` matches between Task 3 and Task 10.
