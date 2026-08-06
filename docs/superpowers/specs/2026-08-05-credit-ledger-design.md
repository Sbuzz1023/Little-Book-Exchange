# Credit Ledger Foundation

**Date:** 2026-08-05
**Status:** Approved

## Overview

Today "credits" is entirely cosmetic. There is no `credits` column on `profiles`, the Wallet tab's "Available Balance" is a hardcoded `0`, "💳 Buy Credits — $5 each" has no click handler, "Transaction History" renders a local `MOCK_TRANSACTIONS` array, and the Admin panel's per-user credits field only ever writes to local React state (`saveEdit` in `AdminClient.tsx` never touches the database). The purchase flow (`requestPurchase` → `confirmExchange` → `completeExchange`) never reads or writes a credit balance anywhere. "1 credit = 1 book" is page copy, not an enforced rule.

This feature makes credits real:

1. A real `credits` balance per user, moved automatically — buyer −N, seller +N — at the exact moment an exchange completes.
2. A `credit_transactions` ledger, finally backing the Wallet tab's transaction history with real rows.
3. A one-time "earn your first credit" bonus for completing three trust-building tasks: verify email, verify phone (via real SMS OTP), and post 3 books — evaluated retroactively for existing users, not just new signups.
4. A post-signup welcome popup explaining the bonus, and a persistent Wallet-tab badge (reusing the existing unread-badge mechanism) while it's unclaimed.
5. Real-money credit purchasing ("Buy Credits — $5 each") stays explicitly **out of scope** — that's a separate future payments-integration project. The button is disabled with a "Coming soon" label rather than left silently dead now that the rest of the tab is real.

This is the foundation the separate bundle/series-listings feature builds on (see `2026-08-05-bundle-listings-design.md`) — bundles need a real ledger before "costs N credits" means anything.

---

## 1. Data model

```sql
-- ── Migration: credit ledger foundation ───────────────────────────────────────

-- 1. Real balance + verification/bonus tracking on profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS credits integer NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_bonus_claimed boolean NOT NULL DEFAULT false;

-- 2. book_count lives on listings now (defaulting to 1) so this feature's credit
-- transfer logic already reads the right value once the separate bundle-listings
-- feature starts populating it for multi-book listings. Until then every listing
-- is 1 book, same as today.
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
-- security-definer trigger functions or the admin action below, same pattern
-- notifications already uses.

-- 4. Sync Supabase Auth's own verification state onto profiles, so app code
-- never needs to query the protected auth schema directly. Mirrors the existing
-- handle_new_user() trigger's shape.
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
-- Called from three triggers below (profiles update, listings insert) plus a
-- one-time backfill so existing users are evaluated retroactively.
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
-- evaluate every existing user once. One-time — safe to re-run (idempotent,
-- since maybe_award_onboarding_bonus checks onboarding_bonus_claimed).
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
-- the existing completed-exchange trigger point rather than adding a second
-- trigger on the same event (avoids ordering ambiguity between two triggers
-- both firing on completion).
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
-- (trigger itself is unchanged — already fires `after update on conversations`)
-- ──────────────────────────────────────────────────────────────────────────────
```

**Known, accepted limitation:** a buyer's balance is checked when they *request* a purchase (Section 2), not re-checked at completion. Between request and completion a buyer's balance could in theory drop below what's needed (e.g. an admin manually deducts credits elsewhere while a request is in flight) — the trigger above lets the transfer happen anyway rather than blocking a physical handoff that's already occurred over an accounting edge case. This is deliberately not hardened further; it's an extremely unlikely path and the alternative (refusing to finalize a completed real-world exchange) is worse.

---

## 2. Purchase-time balance check (`app/listings/[id]/page.tsx`)

`requestPurchase`'s non-demo path gains a balance check right after loading the user, before the existing `lock_listing_for_request` RPC call:

```ts
const { data: buyerProfile } = await supabase.from('profiles').select('credits').eq('id', u!.id).single()
if (!buyerProfile || buyerProfile.credits < listing.book_count) {
  redirect(`/listings/${params.id}?insufficient_credits=1`)
}
```

The listing detail page reads `insufficient_credits` alongside its existing `purchase_failed`/`requested` search-param handling and shows a plain "You don't have enough credits for this" notice in the same banner slot those already use.

---

## 3. Onboarding checklist (Wallet tab)

`app/profile/page.tsx` already does `select('*')` for the viewer's own profile, so `credits`, `email_verified`, `phone_verified`, `onboarding_bonus_claimed` flow into `DashboardClient` with no query changes. It additionally fetches the viewer's `credit_transactions` (newest first) to replace `MOCK_TRANSACTIONS`.

**Wallet tab (`DashboardClient.tsx`):**
- Balance card shows `profile.credits` instead of the hardcoded `0`.
- "💳 Buy Credits — $5 each" becomes disabled with a "Coming soon" label — real-money purchasing is out of scope, and leaving an active-looking dead button next to otherwise-real data would read as broken rather than unfinished.
- Transaction History renders the real `credit_transactions` rows (`purchase_spent` → 💳 red, `sale_earned` → 🤝 green, `onboarding_bonus`/`admin_adjustment` → 🎁 green), same layout as today's mock version.
- New **"🎯 Earn Your First Credit"** card above the balance card, shown only while `!onboarding_bonus_claimed`:
  - ☐/✅ **Verify email** — if `!email_verified`, a "Resend confirmation email" button calling a new `resendEmailConfirmation` action (`supabase.auth.resend({ type: 'signup', email })`).
  - ☐/✅ **Verify phone** — if `!phone_verified`, a "Verify Phone" button opens an inline two-step form: (1) confirm/enter the number, submit to a new `sendPhoneOtp` action (`supabase.auth.updateUser({ phone })`, which triggers Supabase to text a code — requires the SMS provider configured in Supabase Auth settings, done separately, see Out of Scope); (2) enter the received code, submit to `verifyPhoneOtp` (`supabase.auth.verifyOtp({ phone, token, type: 'phone_change' })`). Supabase enforces one verified phone per project account-wide, so a second account attempting to verify an already-claimed number gets a clear "already in use" error straight from Supabase — this is what actually prevents the multi-account duplicate-bonus abuse the phone step exists for.
  - ☐/✅ **Books posted (`n/3`)** — reads `sum(book_count)` across the viewer's own listings (already fetched for the Listings tab; reused here, not a new query), links to Post a Book when incomplete.
  - Once all three flip true, the trigger chain in Section 1 has already paid the bonus by the time this renders — the card shows a one-time "🎉 Bonus earned — you got 1 free credit!" line instead of the checklist, no separate dismissal state needed (the three underlying booleans are the only state).
- `tabBadgeCount(id)` gains a `wallet` case: returns `1` (any truthy count renders the existing badge dot) while `!profile.onboarding_bonus_claimed`, else `0` — reuses the exact mechanism `exchanges`/`tbr`/`messages` badges already use.

---

## 4. Post-signup welcome popup

`app/auth/signup/page.tsx`'s successful-signup redirect changes from `redirect('/')` to `redirect('/?welcome=1')` — the only change to that file.

New client component `components/WelcomeBonusModal.tsx`, mounted in `app/page.tsx`: reads `welcome` via `useSearchParams()`, and if present, renders a modal overlay — "🎉 Welcome to Little Book Exchange!", the same three-step bonus explanation as the Wallet checklist, and a "Take me to my Wallet →" button linking to `/profile?tab=wallet`. Either that button or a plain dismiss closes the modal and strips the query param via `router.replace('/', { scroll: false })`, so refreshing or revisiting `/` never shows it again. No new database flag — the URL param is the entire one-time-display mechanism, consistent with how `error`/`requested`/`purchase_failed` query params are already used elsewhere in this app.

---

## 5. Admin integration (`app/admin/AdminClient.tsx`)

- The Users tab's fetch (`supabase.from('profiles').select('id, username, email, city, state, created_at, is_admin')`) gains `credits`, replacing the hardcoded `credits: 0` in the mapped row.
- `saveEdit()` currently only updates local state (`setUsers`) — it never persists anything, for any field. This feature adds a new action `adminUpdateUserCredits` (`lib/actions/admin.ts`, following the `requireAdmin` pattern `adminUpdateReview`/`adminDeleteReview` already established) that's called specifically when `form.credits !== editTarget.credits`, writing the new balance and inserting a `credit_transactions` row (`reason: 'admin_adjustment'`) for audit-trail parity with every other credit movement. `saveEdit()` still updates local state afterward for immediate UI feedback, same as `toggleAdmin` already does. **Editing username/email/city/bio/status remains local-state-only, exactly as today** — out of scope here, matches the precedent the reviews feature set of only wiring the one field a given feature actually needs.
- "Top Users by Credits" and "Credits in Circ." stat cards on the Dashboard sub-tab now reflect real numbers automatically, no code change needed there beyond the fetch above.

---

## Out of Scope

- Real-money credit purchasing ("Buy Credits — $5 each") — separate future payments-integration project. Button is disabled with a "Coming soon" label, not wired to anything.
- Configuring the SMS provider (e.g. Twilio) in Supabase Auth settings, and confirming "Confirm email" is enabled — both dashboard/account-level steps outside this codebase, done separately by the project owner. The app-side phone/email verification code is written against Supabase's standard APIs either way; it simply has nothing to send until those are configured.
- Re-checking buyer balance at completion time (see the Known Limitation in Section 1) — accepted, not hardened further.
- Editing username/email/city/bio/status in the Admin Users tab — remains local-state-only, unchanged from today.
- A general user-report/dispute flow for credit disagreements — no such flow exists anywhere in the app yet; out of scope here same as it was for the reviews feature.
- Letting a user change/re-verify a *different* phone number later (e.g. after moving) — this feature only covers the one-time onboarding verification of whatever's in `profiles.phone` at the time.

---

## Files Changed

| File | Change |
|---|---|
| `supabase/schema.sql` | New migration: `profiles` gains `credits`/`email_verified`/`phone_verified`/`onboarding_bonus_claimed`; `listings` gains `book_count`; new `credit_transactions` table + RLS; verification-sync trigger on `auth.users`; onboarding-bonus function + triggers on `profiles`/`listings` + one-time backfill; `complete_exchange_marks_listing_sold` extended to transfer credits |
| `app/listings/[id]/page.tsx` | `requestPurchase` checks buyer balance before locking; detail page shows an "insufficient credits" notice |
| `app/profile/page.tsx` | Fetches viewer's `credit_transactions`, passes into `DashboardClient` |
| `app/profile/DashboardClient.tsx` | Real balance + transaction history; new onboarding checklist card; disabled "Buy Credits" button; `tabBadgeCount` gains a `wallet` case |
| `lib/actions/verification.ts` | New: `resendEmailConfirmation`, `sendPhoneOtp`, `verifyPhoneOtp` |
| `lib/actions/admin.ts` | New: `adminUpdateUserCredits` |
| `app/admin/AdminClient.tsx` | Real `credits` in the Users fetch; `saveEdit()` persists credit changes via the new action |
| `app/auth/signup/page.tsx` | Redirect target `'/' ` → `'/?welcome=1'` on success |
| `components/WelcomeBonusModal.tsx` | New: one-time post-signup bonus explainer, query-param-driven |
| `app/page.tsx` | Mounts `WelcomeBonusModal` |
