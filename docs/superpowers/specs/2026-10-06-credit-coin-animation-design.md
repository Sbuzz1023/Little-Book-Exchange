# Credit Coin Animation

**Date:** 2026-10-06
**Status:** Draft — awaiting review

## Overview

Credits change hands silently today: when an exchange completes, the nav's credits pill (`.hnav-credits`, a mustard coin + balance, linking to the Wallet) just shows a different number on the next page load. This feature makes every credit a user earns or spends visibly *move*:

- **Earning** — a coin appears in the centre of the screen, spins, and flies into the nav's credits pill, which ticks up.
- **Spending** — a coin is pulled out of the nav's credits pill, flies to the centre, spins, and crumbles into dust; the pill ticks down.

It plays the **next time the user loads a page** after the credit change — immediately for a user who just pressed the final pickup button (the action reloads the page), or on their next visit if the change happened while they were away (e.g. the 48-hour auto-complete cron).

Nothing about *how* credits move changes. The existing `complete_exchange_marks_listing_sold()` trigger keeps moving credits and writing `credit_transactions` rows; this feature only reads those rows and remembers which ones the user has already seen.

### Which events animate

| `credit_transactions.reason` | Who | Animation |
|---|---|---|
| `sale_earned` | seller, on completion (manual or `auto_timeout`) | coin in |
| `purchase_spent` | buyer, on completion (manual or `auto_timeout`) | coin out → dust |
| `onboarding_bonus` | new user, once | coin in |
| `admin_adjustment` | anyone | **none** — balance updates quietly (usually a correction) |

---

## Data Model

### `profiles.credits_seen_at` (new column)

```sql
alter table profiles
  add column if not exists credits_seen_at timestamptz not null default now();

-- Existing users start "caught up", so their history doesn't replay.
update profiles set credits_seen_at = now();
```

- New accounts get their creation time by default, so the welcome bonus (granted later) still animates.
- No RLS change: the existing "Users can update own profile" policy already lets a user update their own row, and `prevent_credit_self_grant()` keeps guarding `credits` and the verification columns. A user writing this column can only replay or skip their own animation.
- The SQL is appended to `supabase/schema.sql` like previous migrations and **must be run in Supabase before deploying** — the layout's query selects the new column.

### No change to `credit_transactions`

Its RLS stays read-only for users; we never mark ledger rows.

---

## Data Flow

1. **Root layout** (`app/layout.tsx`) already loads the signed-in user's profile for the nav. It adds `credits_seen_at` to that select, then — only for a signed-in user — runs one more query:

   ```ts
   supabase.from('credit_transactions')
     .select('id, amount, reason, created_at, listings(title)')
     .eq('user_id', user.id)
     .in('reason', ['sale_earned', 'purchase_spent', 'onboarding_bonus'])
     .gt('created_at', profile.credits_seen_at)
     .order('created_at', { ascending: true })
     .limit(50)
   ```

   The rows (as `unseenCredits`) are passed through `Nav` → `HomeNav`, alongside `credits`.

2. **`HomeNav`** mounts `CreditCoinShow` when `unseenCredits` is non-empty. Old-style pages (classic `Nav` — admin, seller reviews) don't mount it and don't mark anything seen, so the show plays on the next folk-nav page.

3. **Marking seen** — `CreditCoinShow` calls a server action `markCreditsSeen(upTo: string)` **as soon as the show starts** (not when it ends), so navigating away mid-animation doesn't replay it forever. `upTo` is the newest played row's `created_at` — not `now()` — so a row created between the page render and the action isn't skipped. The action updates only the caller's own row (`auth.uid()`), and only moves the timestamp forward:

   ```ts
   .update({ credits_seen_at: upTo }).eq('id', user.id).lt('credits_seen_at', upTo)
   ```

4. **Error handling** — if the unseen-rows query fails, the layout passes `[]` and the nav shows the plain balance (no animation, nothing marked). If `markCreditsSeen` fails, the show still plays; it may replay on the next load, which is acceptable.

---

## The Show

### Plan (pure logic, `lib/creditShow.ts`)

`planCreditShow(rows, finalBalance)` turns unseen rows into an ordered plan, so all the rules below are unit-testable without the DOM:

- **Two bursts:** an *earn* burst (`sale_earned` + `onboarding_bonus`, positive amounts) then a *spend* burst (`purchase_spent`, negative amounts). Either may be empty.
- **One coin per credit**, capped at **5 coins per burst**. If a burst totals more than 5, the 5th coin carries the remainder and shows a label (e.g. 8 earned → 4 plain coins + one coin labelled "+4").
- **Balances:** the pill starts at `finalBalance − earnTotal − spendTotal` (spendTotal negative) and changes by each coin's value as it lands/leaves, ending exactly on `finalBalance`.
- **Caption** (one per burst, shown with its first coin and held for the burst):
  - Earn, single sale: `+1 credit · Dune was picked up` (`+3 credits · …` for a bundle)
  - Earn, bonus only: `+1 credit · Welcome bonus`
  - Earn, several rows: `+N credits · K books picked up`, appending ` + welcome bonus` if the bonus is among them
  - Spend, single purchase: `−1 credit · you got Dune`
  - Spend, several rows: `−N credits · K books picked up`
  - A row whose listing was deleted (`listings` null) uses "a book" for the title.
- **Screen-reader text** per burst, e.g. "You earned 1 credit for Dune." / "You spent 1 credit on Dune."

### Animation (`components/CreditCoinShow.tsx` + styles in `app/home.css`)

**Earn (coin in), per coin:**
1. Coin (same mustard design as `.hnav-coin`, ~96px) appears at screen centre and spins edge-on about twice (~0.9s). Caption fades in beneath it.
2. It shrinks and flies on an arc into the nav pill's coin (~0.6s). On landing the pill does a small "pop" and its number goes up.
3. ≈1.8s per coin; burst coins start ~0.35s apart (3 coins ≈ 2.5s).

**Spend (coin out → dust), per coin:**
1. A coin lifts out of the pill as its number drops, and flies to centre (~0.6s).
2. It spins once; caption appears.
3. It crumbles into ~20 small mustard specks that drift outward/down and fade (~0.8s).

**Pacing:** earn burst first, short pause, then spend burst. A light dim backdrop sits behind the coins. **Any click/tap skips to the end** (pill shows the final balance, overlay removed). The overlay never blocks the page for more than a few seconds and does not trap focus.

**Reduced motion** (`prefers-reduced-motion: reduce`): no spin or flight — a still coin and the caption fade in and out at centre (~1.5s per burst) and the number updates directly.

**Accessibility:** the caption lives in an `aria-live="polite"` region with the screen-reader text; the coin graphics are `aria-hidden`.

**Implementation:** CSS keyframes + the Web Animations API for the flight (start/end points from the pill's `getBoundingClientRect()`), dust as small absolutely-positioned dots. No animation library. `HomeNav` takes the pill's displayed number from `CreditCoinShow` (via a callback / state) while a show is running, otherwise `credits`.

The pill must exist and be visible to fly to — it is on desktop and in the mobile top bar. If it isn't found (e.g. hidden by future CSS), the coin flies to the top-right corner instead.

---

## Demo Mode

Demo mode has no `credit_transactions`. A query param drives a preview on the demo server: `?coin_demo=earn`, `?coin_demo=spend`, `?coin_demo=both`, `?coin_demo=bundle` (3-credit earn) produce matching mock rows in the layout (demo cookie only; ignored for real users). `markCreditsSeen` is a no-op in demo mode.

---

## Testing

- **`lib/creditShow.test.ts`** — burst ordering, one coin per credit, the 5-coin cap and remainder label, starting/ending balances, every caption variant, deleted-listing fallback, admin adjustments excluded.
- **`CreditCoinShow` tests** — calls `markCreditsSeen` exactly once with the newest row's `created_at`; renders the caption in a live region; skip-on-click jumps to the final balance; reduced-motion path renders without flight.
- **`HomeNav` tests** — mounts the show only when there are unseen rows; pill shows the plan's starting balance while it runs.
- **Browser check** on the demo server (http://localhost:3007) with each `?coin_demo=` value, desktop and phone widths, screenshots mid-animation.

## Out of Scope

- Animating admin adjustments.
- Showing the animation on old-style (classic nav) pages.
- Live push while the user sits on a page (it plays on the next page load).
