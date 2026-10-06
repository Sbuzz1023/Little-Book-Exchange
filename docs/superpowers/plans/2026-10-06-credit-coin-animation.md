# Credit Coin Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user's credits change from a completed exchange or the welcome bonus, play a one-time coin animation on their next page load — a coin flies from the centre into the nav's credits pill (earn) or from the pill to the centre and into dust (spend).

**Architecture:** A new `profiles.credits_seen_at` column records what the user has already seen. The root layout fetches `credit_transactions` rows newer than it and passes them down `Nav` → `HomeNav`. Pure logic in `lib/creditShow.ts` turns rows into a plan (bursts, coins, captions, balances); `components/CreditCoinShow.tsx` plays it with the Web Animations API and calls the `markCreditsSeen` server action when it starts.

**Tech Stack:** Next.js 14.2 App Router, React 18, TypeScript, Supabase (Postgres + RLS), Vitest + Testing Library (jsdom), plain CSS in `app/home.css`.

**Spec:** `docs/superpowers/specs/2026-10-06-credit-coin-animation-design.md`

## Global Constraints

- Animated reasons: `sale_earned`, `onboarding_bonus` (earn) and `purchase_spent` (spend). `admin_adjustment` never animates.
- Two bursts, earn first, then spend; ~0.6s pause between bursts. Never net them together.
- One coin per credit, max **5 coins per burst**; the 5th coin carries the remainder with a label (8 earned → 4 plain coins + a coin labelled `+4`).
- Captions (minus sign is U+2212 `−`), where "K books" = the total credits of the sale/purchase rows (1 credit = 1 book):
  - `+1 credit · Dune was picked up` / `+3 credits · Dune was picked up` (single sale row)
  - `+1 credit · Welcome bonus` (bonus only)
  - `+N credits · K books picked up`, plus ` + welcome bonus` when the bonus is included (several rows)
  - `−1 credit · you got Dune` (single purchase row), `−N credits · you got K books` (several)
  - Deleted listing → title `a book`.
- Timings: earn coin spin ~0.9s + flight ~0.6s; spend flight ~0.6s + spin ~0.5s + dust ~0.8s; coins in a burst start 350ms apart.
- Mark seen **when the show starts**, with the newest played row's `created_at` (never `now()`); only move the timestamp forward.
- Any click/tap or Escape skips to the end (final balance, overlay removed). No focus trap.
- `prefers-reduced-motion: reduce`: still coin + caption fade in/out at centre ~1.5s per burst; no spin/flight.
- Demo mode = `!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http')`. Demo previews: `?coin_demo=earn|spend|both|bundle`. `markCreditsSeen` is not called in demo.
- Colours: coin fill `#E4B04A`, rim `#B9862A`; caption pine `#234A40` (earn) / brick `#B5462F` (spend).
- Migration SQL appended to `supabase/schema.sql`; must be run in Supabase before deploy.

## Review Focus

1. **First paint shows the old balance** — while a show is pending, the pill must render the plan's starting balance on the very first render, never flash the final number and jump back. (Task 4 test: initial render shows start balance.)
2. **Navigating away or refreshing mid-show** — the show must stop cleanly on unmount (no further balance updates) and must not restart when the layout re-renders with identical rows (`router.refresh`). (Task 3 test: unmount mid-show; Task 4 test: re-render with a new-but-identical rows array keeps the same overlay.)
3. **Skip while coins are mid-flight** — late-finishing animations must not push the balance past/back from the final value, and `onDone` fires exactly once. (Task 3 test.)
4. **Unseen rows but no balance** (`credits` null, e.g. profile row missing) — no show, no crash, no pill. (Task 4 test.)
5. **Supabase relation shape** — `listings(title)` can arrive as an object, an array, or null; captions must still get a title or "a book". (Task 1 test.)

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/creditShow.ts` (new) | Types, `planCreditShow`, `toUnseenCredits`, `demoUnseenCredits`, `CREDIT_SHOW_REASONS` — pure, no DOM |
| `lib/creditShow.test.ts` (new) | Unit tests for the above |
| `lib/actions/creditsSeen.ts` (new) | `markCreditsSeen(upTo)` server action |
| `lib/actions/creditsSeen.test.ts` (new) | Action tests (mocked Supabase) |
| `supabase/schema.sql` | Append `credits_seen_at` migration |
| `components/CreditCoinShow.tsx` (new) | Overlay + animation timeline |
| `components/CreditCoinShow.test.tsx` (new) | Component tests (reduced-motion path, skip, mark-seen, unmount) |
| `app/home.css` | `.ccs-*` overlay/coin/dust/caption styles, pill pop |
| `app/layout.tsx` | Select `credits_seen_at`, fetch unseen rows, pass `unseenCredits` |
| `components/Nav.tsx` | Pass `unseenCredits` through to `HomeNav` |
| `components/HomeNav.tsx` | Build plan, show starting balance, mount `CreditCoinShow`, demo param |
| `components/HomeNav.test.tsx` | Wiring tests |

---

### Task 1: Credit show plan (pure logic)

**Files:**
- Create: `lib/creditShow.ts`
- Test: `lib/creditShow.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export const CREDIT_SHOW_REASONS: readonly ['sale_earned', 'purchase_spent', 'onboarding_bonus']
  export type CreditShowReason = typeof CREDIT_SHOW_REASONS[number]
  export type UnseenCredit = { id: string; amount: number; reason: CreditShowReason; created_at: string; title: string | null }
  export type ShowCoin = { value: number; label: string | null }       // value signed: +1 / −1 / ±remainder
  export type ShowBurst = { kind: 'earn' | 'spend'; coins: ShowCoin[]; caption: string; srText: string }
  export type CreditShowPlan = { startBalance: number; finalBalance: number; bursts: ShowBurst[]; seenUpTo: string }
  export function planCreditShow(rows: UnseenCredit[], finalBalance: number): CreditShowPlan | null
  export function toUnseenCredits(rows: unknown[]): UnseenCredit[]
  export type CoinDemoMode = 'earn' | 'spend' | 'both' | 'bundle'
  export function demoUnseenCredits(mode: string | null): UnseenCredit[]
  ```

- [ ] **Step 1: Write the failing tests**

Create `lib/creditShow.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { planCreditShow, toUnseenCredits, demoUnseenCredits, type UnseenCredit } from './creditShow'

let n = 0
function row(reason: UnseenCredit['reason'], amount: number, title: string | null = 'Dune', created_at = `2026-10-06T10:00:0${n}Z`): UnseenCredit {
  n++
  return { id: `r${n}`, amount, reason, created_at, title }
}

describe('planCreditShow', () => {
  it('returns null when there is nothing to show', () => {
    expect(planCreditShow([], 3)).toBeNull()
  })

  it('a single sale: one earn burst, one coin, caption with the title', () => {
    const plan = planCreditShow([row('sale_earned', 1)], 4)!
    expect(plan.startBalance).toBe(3)
    expect(plan.finalBalance).toBe(4)
    expect(plan.bursts).toEqual([{
      kind: 'earn',
      coins: [{ value: 1, label: null }],
      caption: '+1 credit · Dune was picked up',
      srText: 'You earned 1 credit for Dune.',
    }])
  })

  it('a bundle sale: one coin per credit, plural caption with the title', () => {
    const plan = planCreditShow([row('sale_earned', 3, 'Little Women bundle')], 6)!
    expect(plan.bursts[0].coins).toHaveLength(3)
    expect(plan.bursts[0].caption).toBe('+3 credits · Little Women bundle was picked up')
    expect(plan.startBalance).toBe(3)
  })

  it('welcome bonus only', () => {
    const plan = planCreditShow([row('onboarding_bonus', 1, null)], 1)!
    expect(plan.bursts[0].caption).toBe('+1 credit · Welcome bonus')
    expect(plan.bursts[0].srText).toBe('You earned 1 credit: welcome bonus.')
  })

  it('several sales plus the bonus share one earn burst', () => {
    const plan = planCreditShow([row('sale_earned', 1), row('onboarding_bonus', 1, null), row('sale_earned', 1, 'Emma')], 5)!
    expect(plan.bursts).toHaveLength(1)
    expect(plan.bursts[0].caption).toBe('+3 credits · 2 books picked up + welcome bonus')
    expect(plan.bursts[0].srText).toBe('You earned 3 credits.')
  })

  it('a single purchase: spend burst with a minus sign and the title', () => {
    const plan = planCreditShow([row('purchase_spent', -1, 'Matilda')], 2)!
    expect(plan.startBalance).toBe(3)
    expect(plan.bursts).toEqual([{
      kind: 'spend',
      coins: [{ value: -1, label: null }],
      caption: '−1 credit · you got Matilda',
      srText: 'You spent 1 credit on Matilda.',
    }])
  })

  it('several purchases', () => {
    const plan = planCreditShow([row('purchase_spent', -1), row('purchase_spent', -2)], 0)!
    expect(plan.bursts[0].caption).toBe('−3 credits · you got 3 books')
    expect(plan.bursts[0].srText).toBe('You spent 3 credits.')
  })

  it('mixed: earn burst first, then spend, balances walk to the final value', () => {
    const plan = planCreditShow([row('purchase_spent', -1, 'Matilda'), row('sale_earned', 1, 'Dune'), row('sale_earned', 1, 'Emma')], 5)!
    expect(plan.bursts.map(b => b.kind)).toEqual(['earn', 'spend'])
    expect(plan.bursts[0].caption).toBe('+2 credits · 2 books picked up')
    expect(plan.bursts[1].caption).toBe('−1 credit · you got Matilda')
    expect(plan.startBalance).toBe(4)
    const end = plan.bursts.flatMap(b => b.coins).reduce((bal, c) => bal + c.value, plan.startBalance)
    expect(end).toBe(5)
  })

  it('caps a burst at 5 coins, the last carrying the remainder', () => {
    const plan = planCreditShow([row('sale_earned', 8)], 8)!
    expect(plan.bursts[0].coins).toEqual([
      { value: 1, label: null }, { value: 1, label: null }, { value: 1, label: null }, { value: 1, label: null },
      { value: 4, label: '+4' },
    ])
    const spend = planCreditShow([row('purchase_spent', -6)], 0)!
    expect(spend.bursts[0].coins.at(-1)).toEqual({ value: -2, label: '−2' })
    expect(spend.bursts[0].coins).toHaveLength(5)
  })

  it('exactly 5 credits is 5 plain coins', () => {
    const plan = planCreditShow([row('sale_earned', 5)], 5)!
    expect(plan.bursts[0].coins.every(c => c.label === null && c.value === 1)).toBe(true)
    expect(plan.bursts[0].coins).toHaveLength(5)
  })

  it('uses "a book" when the listing was deleted', () => {
    const plan = planCreditShow([row('sale_earned', 1, null)], 1)!
    expect(plan.bursts[0].caption).toBe('+1 credit · a book was picked up')
  })

  it('ignores reasons it does not animate (admin adjustments)', () => {
    const rows = [{ ...row('sale_earned', 1), reason: 'admin_adjustment' }] as unknown as UnseenCredit[]
    expect(planCreditShow(rows, 3)).toBeNull()
  })

  it('seenUpTo is the newest created_at, whatever the input order', () => {
    const plan = planCreditShow([
      row('sale_earned', 1, 'A', '2026-10-06T10:00:05.123456+00:00'),
      row('sale_earned', 1, 'B', '2026-10-06T09:00:00+00:00'),
    ], 2)!
    expect(plan.seenUpTo).toBe('2026-10-06T10:00:05.123456+00:00')
  })
})

describe('toUnseenCredits', () => {
  it('flattens listings(title) whether it arrives as an object, an array or null', () => {
    const out = toUnseenCredits([
      { id: 'a', amount: 1, reason: 'sale_earned', created_at: 't1', listings: { title: 'Dune' } },
      { id: 'b', amount: -1, reason: 'purchase_spent', created_at: 't2', listings: [{ title: 'Emma' }] },
      { id: 'c', amount: 1, reason: 'onboarding_bonus', created_at: 't3', listings: null },
    ])
    expect(out.map(r => r.title)).toEqual(['Dune', 'Emma', null])
    expect(out[1]).toEqual({ id: 'b', amount: -1, reason: 'purchase_spent', created_at: 't2', title: 'Emma' })
  })

  it('drops rows with reasons it does not animate or malformed amounts', () => {
    const out = toUnseenCredits([
      { id: 'a', amount: 1, reason: 'admin_adjustment', created_at: 't1', listings: null },
      { id: 'b', amount: 'x', reason: 'sale_earned', created_at: 't2', listings: null },
    ])
    expect(out).toEqual([])
  })
})

describe('demoUnseenCredits', () => {
  it('builds preview rows per mode and nothing for unknown modes', () => {
    expect(demoUnseenCredits('earn').map(r => r.reason)).toEqual(['sale_earned'])
    expect(demoUnseenCredits('spend').map(r => r.reason)).toEqual(['purchase_spent'])
    expect(demoUnseenCredits('both').map(r => r.reason).sort()).toEqual(['purchase_spent', 'sale_earned', 'sale_earned'])
    expect(demoUnseenCredits('bundle')).toEqual([expect.objectContaining({ reason: 'sale_earned', amount: 3 })])
    expect(demoUnseenCredits('nope')).toEqual([])
    expect(demoUnseenCredits(null)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/creditShow.test.ts`
Expected: FAIL — `Failed to resolve import "./creditShow"`.

- [ ] **Step 3: Implement `lib/creditShow.ts`**

```ts
// Turns the credit_transactions rows a user hasn't seen yet into the coin
// show the nav plays on their next page load: an earn burst (sales + the
// welcome bonus) then a spend burst (purchases). Pure — no DOM — so every
// rule here is unit-tested; components/CreditCoinShow.tsx plays the result.

export const CREDIT_SHOW_REASONS = ['sale_earned', 'purchase_spent', 'onboarding_bonus'] as const
export type CreditShowReason = typeof CREDIT_SHOW_REASONS[number]

export type UnseenCredit = { id: string; amount: number; reason: CreditShowReason; created_at: string; title: string | null }
export type ShowCoin = { value: number; label: string | null }
export type ShowBurst = { kind: 'earn' | 'spend'; coins: ShowCoin[]; caption: string; srText: string }
export type CreditShowPlan = { startBalance: number; finalBalance: number; bursts: ShowBurst[]; seenUpTo: string }

const MAX_COINS = 5
const MINUS = '−'

const isShowReason = (r: unknown): r is CreditShowReason =>
  (CREDIT_SHOW_REASONS as readonly unknown[]).includes(r)

const credits = (n: number) => `${n} ${n === 1 ? 'credit' : 'credits'}`
const books = (n: number) => `${n} ${n === 1 ? 'book' : 'books'}`
const titleOf = (r: UnseenCredit) => r.title ?? 'a book'

// One coin per credit, capped: past MAX_COINS the last coin carries the rest.
function coinsFor(total: number, sign: 1 | -1): ShowCoin[] {
  if (total <= MAX_COINS) return Array.from({ length: total }, () => ({ value: sign, label: null }))
  const rest = total - (MAX_COINS - 1)
  return [
    ...Array.from({ length: MAX_COINS - 1 }, () => ({ value: sign, label: null })),
    { value: sign * rest, label: `${sign > 0 ? '+' : MINUS}${rest}` },
  ]
}

function earnBurst(rows: UnseenCredit[]): ShowBurst | null {
  if (rows.length === 0) return null
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const sales = rows.filter(r => r.reason === 'sale_earned')
  const hasBonus = rows.some(r => r.reason === 'onboarding_bonus')
  let caption: string
  let srText: string
  if (sales.length === 0) {
    caption = `+${credits(total)} · Welcome bonus`
    srText = `You earned ${credits(total)}: welcome bonus.`
  } else if (sales.length === 1 && !hasBonus) {
    caption = `+${credits(total)} · ${titleOf(sales[0])} was picked up`
    srText = `You earned ${credits(total)} for ${titleOf(sales[0])}.`
  } else {
    const soldBooks = sales.reduce((s, r) => s + r.amount, 0)
    caption = `+${credits(total)} · ${books(soldBooks)} picked up${hasBonus ? ' + welcome bonus' : ''}`
    srText = `You earned ${credits(total)}.`
  }
  return { kind: 'earn', coins: coinsFor(total, 1), caption, srText }
}

function spendBurst(rows: UnseenCredit[]): ShowBurst | null {
  if (rows.length === 0) return null
  const total = rows.reduce((s, r) => s - r.amount, 0)
  const single = rows.length === 1
  return {
    kind: 'spend',
    coins: coinsFor(total, -1),
    caption: single ? `${MINUS}${credits(total)} · you got ${titleOf(rows[0])}` : `${MINUS}${credits(total)} · you got ${books(total)}`,
    srText: single ? `You spent ${credits(total)} on ${titleOf(rows[0])}.` : `You spent ${credits(total)}.`,
  }
}

export function planCreditShow(rows: UnseenCredit[], finalBalance: number): CreditShowPlan | null {
  const shown = rows.filter(r => isShowReason(r.reason) && r.amount !== 0)
  if (shown.length === 0) return null
  const earn = earnBurst(shown.filter(r => r.reason !== 'purchase_spent' && r.amount > 0))
  const spend = spendBurst(shown.filter(r => r.reason === 'purchase_spent' && r.amount < 0))
  const bursts = [earn, spend].filter((b): b is ShowBurst => b !== null)
  if (bursts.length === 0) return null
  const delta = bursts.flatMap(b => b.coins).reduce((s, c) => s + c.value, 0)
  const seenUpTo = shown.reduce((latest, r) => (Date.parse(r.created_at) > Date.parse(latest) ? r.created_at : latest), shown[0].created_at)
  return { startBalance: finalBalance - delta, finalBalance, bursts, seenUpTo }
}

// Supabase returns the joined listing as an object, an array or null
// depending on how it infers the relation; flatten it to a title.
export function toUnseenCredits(rows: unknown[]): UnseenCredit[] {
  const out: UnseenCredit[] = []
  for (const raw of rows) {
    const r = raw as { id?: unknown; amount?: unknown; reason?: unknown; created_at?: unknown; listings?: unknown }
    if (!isShowReason(r.reason) || typeof r.amount !== 'number' || typeof r.id !== 'string' || typeof r.created_at !== 'string') continue
    const listing = Array.isArray(r.listings) ? r.listings[0] : r.listings
    const title = listing && typeof (listing as { title?: unknown }).title === 'string' ? (listing as { title: string }).title : null
    out.push({ id: r.id, amount: r.amount, reason: r.reason, created_at: r.created_at, title })
  }
  return out
}

// Demo mode has no ledger: ?coin_demo=… previews the show on the demo server.
export type CoinDemoMode = 'earn' | 'spend' | 'both' | 'bundle'
export function demoUnseenCredits(mode: string | null): UnseenCredit[] {
  const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString()
  const sale = (id: string, title: string, amount = 1, s = 1): UnseenCredit => ({ id, amount, reason: 'sale_earned', created_at: at(s), title })
  const buy = (id: string, title: string): UnseenCredit => ({ id, amount: -1, reason: 'purchase_spent', created_at: at(3), title })
  switch (mode) {
    case 'earn': return [sale('demo-1', 'Dune')]
    case 'spend': return [buy('demo-1', 'Matilda')]
    case 'both': return [sale('demo-1', 'Dune'), sale('demo-2', 'Emma', 1, 2), buy('demo-3', 'Matilda')]
    case 'bundle': return [sale('demo-1', 'Little Women bundle', 3)]
    default: return []
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/creditShow.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add lib/creditShow.ts lib/creditShow.test.ts
git commit -m "Add the credit show plan: bursts, coins and captions for unseen credits"
```

---

### Task 2: `credits_seen_at` column and `markCreditsSeen` action

**Files:**
- Modify: `supabase/schema.sql` (append at end)
- Create: `lib/actions/creditsSeen.ts`
- Test: `lib/actions/creditsSeen.test.ts`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server`.
- Produces: `export async function markCreditsSeen(upTo: string): Promise<void>` — never throws.

- [ ] **Step 1: Append the migration to `supabase/schema.sql`**

```sql

-- ============================================================
-- Credit coin animation (2026-10-06)
-- ============================================================
-- The nav plays a coin animation for credit changes the user hasn't seen
-- yet (sales, purchases, welcome bonus). credits_seen_at is the newest
-- credit_transactions.created_at already played. No RLS change: "Users can
-- update own profile" already covers it, and prevent_credit_self_grant()
-- still guards credits itself — writing this column only replays or skips
-- the user's own animation.
alter table profiles
  add column if not exists credits_seen_at timestamptz not null default now();

-- Existing users start caught up, so their history doesn't replay.
update profiles set credits_seen_at = now();
```

- [ ] **Step 2: Write the failing tests**

Create `lib/actions/creditsSeen.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { markCreditsSeen } from './creditsSeen'

const ltMock = vi.fn(() => Promise.resolve({ error: null }))
const eqMock = vi.fn(() => ({ lt: ltMock }))
const updateMock = vi.fn((_v: Record<string, unknown>) => ({ eq: eqMock }))
const fromMock = vi.fn((_t: string) => ({ update: updateMock }))
let user: { id: string } | null = { id: 'user-1' }
const getUserMock = vi.fn(() => Promise.resolve({ data: { user } }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: getUserMock }, from: fromMock }),
}))

describe('markCreditsSeen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    user = { id: 'user-1' }
  })

  it("moves the caller's credits_seen_at forward to the given time only", async () => {
    await markCreditsSeen('2026-10-06T10:00:05.123456+00:00')
    expect(fromMock).toHaveBeenCalledWith('profiles')
    expect(updateMock).toHaveBeenCalledWith({ credits_seen_at: '2026-10-06T10:00:05.123456+00:00' })
    expect(eqMock).toHaveBeenCalledWith('id', 'user-1')
    expect(ltMock).toHaveBeenCalledWith('credits_seen_at', '2026-10-06T10:00:05.123456+00:00')
  })

  it('does nothing when signed out', async () => {
    user = null
    await markCreditsSeen('2026-10-06T10:00:00Z')
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('ignores a value that is not a timestamp', async () => {
    await markCreditsSeen('not a date')
    expect(getUserMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('never throws, even if Supabase does', async () => {
    getUserMock.mockImplementationOnce(() => Promise.reject(new Error('down')))
    await expect(markCreditsSeen('2026-10-06T10:00:00Z')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run lib/actions/creditsSeen.test.ts`
Expected: FAIL — `Failed to resolve import "./creditsSeen"`.

- [ ] **Step 4: Implement `lib/actions/creditsSeen.ts`**

```ts
'use server'

import { createClient } from '@/lib/supabase/server'

// Called by the nav's coin show as soon as it starts playing, with the
// newest credit_transactions.created_at it covers — not now(), so a row
// created after the page rendered still plays next time. Only ever moves
// the marker forward. Never throws: a failure just means the show may
// replay on the next page load.
export async function markCreditsSeen(upTo: string): Promise<void> {
  if (typeof upTo !== 'string' || Number.isNaN(Date.parse(upTo))) return
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase
      .from('profiles')
      .update({ credits_seen_at: upTo })
      .eq('id', user.id)
      .lt('credits_seen_at', upTo)
  } catch {}
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/actions/creditsSeen.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add supabase/schema.sql lib/actions/creditsSeen.ts lib/actions/creditsSeen.test.ts
git commit -m "Track which credit changes a user has seen (credits_seen_at)"
```

---

### Task 3: `CreditCoinShow` component and styles

**Files:**
- Create: `components/CreditCoinShow.tsx`
- Create: `components/CreditCoinShow.test.tsx`
- Modify: `app/home.css` (append after the `.hnav-coin` rules, before the `.hnav-avatar-menu` rule)

**Interfaces:**
- Consumes: `CreditShowPlan`, `ShowBurst`, `ShowCoin` from `@/lib/creditShow` (Task 1); `markCreditsSeen` from `@/lib/actions/creditsSeen` (Task 2).
- Produces:
  ```ts
  export default function CreditCoinShow(props: {
    plan: CreditShowPlan
    onBalance: (n: number) => void   // the number the nav pill should show right now
    onDone: () => void               // called exactly once, after onBalance(plan.finalBalance)
    persist: boolean                 // false in demo mode: don't call markCreditsSeen
  }): JSX.Element
  ```
  It locates the pill with `document.querySelector('.hnav-credits')` and its coin with `.hnav-credits .hnav-coin`, and toggles the class `is-pop` on the pill.

- [ ] **Step 1: Write the failing tests**

Create `components/CreditCoinShow.test.tsx`. jsdom has no Web Animations API, so the tests drive the reduced-motion path and the skip/unmount behaviour with fake timers; the motion path is covered by the browser check in Task 5.

```tsx
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import CreditCoinShow from './CreditCoinShow'
import { planCreditShow, type UnseenCredit } from '@/lib/creditShow'

const markMock = vi.fn((_upTo: string) => Promise.resolve())
vi.mock('@/lib/actions/creditsSeen', () => ({ markCreditsSeen: (upTo: string) => markMock(upTo) }))

function setReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: reduce && q.includes('reduce'), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

const sale: UnseenCredit = { id: 's', amount: 1, reason: 'sale_earned', created_at: '2026-10-06T10:00:00Z', title: 'Dune' }
const buy: UnseenCredit = { id: 'b', amount: -1, reason: 'purchase_spent', created_at: '2026-10-06T11:00:00Z', title: 'Matilda' }

describe('CreditCoinShow', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); setReducedMotion(true) })
  afterEach(() => { vi.useRealTimers() })

  it('marks the plan seen once, with its newest created_at, when it starts', () => {
    const plan = planCreditShow([sale, buy], 5)!
    render(<CreditCoinShow plan={plan} onBalance={vi.fn()} onDone={vi.fn()} persist />)
    expect(markMock).toHaveBeenCalledTimes(1)
    expect(markMock).toHaveBeenCalledWith('2026-10-06T11:00:00Z')
  })

  it('does not mark anything seen in demo mode', () => {
    render(<CreditCoinShow plan={planCreditShow([sale], 4)!} onBalance={vi.fn()} onDone={vi.fn()} persist={false} />)
    expect(markMock).not.toHaveBeenCalled()
  })

  it('reduced motion: shows each caption in turn, walks the balance, then finishes once', async () => {
    const onBalance = vi.fn()
    const onDone = vi.fn()
    render(<CreditCoinShow plan={planCreditShow([sale, buy], 5)!} onBalance={onBalance} onDone={onDone} persist />)
    expect(onBalance).toHaveBeenLastCalledWith(5)            // start: 5 − 1 + 1
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(screen.getByText('+1 credit · Dune was picked up')).toBeInTheDocument()
    expect(onBalance).toHaveBeenLastCalledWith(6)
    await act(async () => { await vi.advanceTimersByTimeAsync(2200) })
    expect(screen.getByText('−1 credit · you got Matilda')).toBeInTheDocument()
    expect(onBalance).toHaveBeenLastCalledWith(5)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('announces each burst in a polite live region', async () => {
    render(<CreditCoinShow plan={planCreditShow([sale], 4)!} onBalance={vi.fn()} onDone={vi.fn()} persist />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    const live = document.querySelector('[aria-live="polite"]')!
    expect(live).toHaveTextContent('You earned 1 credit for Dune.')
  })

  it('a click skips to the final balance and finishes exactly once, even as timers run out later', async () => {
    const onBalance = vi.fn()
    const onDone = vi.fn()
    const { container } = render(<CreditCoinShow plan={planCreditShow([sale, buy], 5)!} onBalance={onBalance} onDone={onDone} persist />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    fireEvent.click(container.querySelector('.ccs')!)
    expect(onBalance).toHaveBeenLastCalledWith(5)
    expect(onDone).toHaveBeenCalledTimes(1)
    onBalance.mockClear()
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(onBalance).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('Escape also skips', async () => {
    const onDone = vi.fn()
    render(<CreditCoinShow plan={planCreditShow([sale], 4)!} onBalance={vi.fn()} onDone={onDone} persist />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('stops quietly when unmounted mid-show (navigating away)', async () => {
    const onBalance = vi.fn()
    const onDone = vi.fn()
    const { unmount } = render(<CreditCoinShow plan={planCreditShow([sale, buy], 5)!} onBalance={onBalance} onDone={onDone} persist />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    unmount()
    onBalance.mockClear()
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(onBalance).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('motion path without Web Animations support still completes on timers', async () => {
    setReducedMotion(false)
    const onDone = vi.fn()
    const onBalance = vi.fn()
    render(<CreditCoinShow plan={planCreditShow([sale], 4)!} onBalance={onBalance} onDone={onDone} persist />)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(onBalance).toHaveBeenLastCalledWith(4)
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run components/CreditCoinShow.test.tsx`
Expected: FAIL — `Failed to resolve import "./CreditCoinShow"`.

- [ ] **Step 3: Implement `components/CreditCoinShow.tsx`**

```tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import type { CreditShowPlan, ShowBurst, ShowCoin } from '@/lib/creditShow'
import { markCreditsSeen } from '@/lib/actions/creditsSeen'

// Plays a CreditShowPlan (lib/creditShow.ts): earn coins spin in the centre
// and fly into the nav's credits pill; spend coins fly out of the pill to
// the centre and crumble into dust. Coins and dust are plain DOM nodes
// animated with the Web Animations API (falling back to timers where it's
// missing, e.g. jsdom); React only renders the overlay and caption.

const STAGGER_MS = 350
const BURST_PAUSE_MS = 600
const STILL_MS = 1500
const COIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6.2"/></svg>'

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function play(el: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
  if (typeof el.animate !== 'function') return wait(Number(options.duration ?? 0) + Number(options.delay ?? 0))
  return el.animate(keyframes, { fill: 'forwards', ...options }).finished.then(() => {}, () => {})
}

// Offset from screen centre to the pill's coin (top-right corner if the pill isn't visible).
function pillOffset(): { dx: number; dy: number } {
  const r = document.querySelector('.hnav-credits .hnav-coin')?.getBoundingClientRect()
  const x = r && r.width > 0 ? r.left + r.width / 2 : window.innerWidth - 24
  const y = r && r.width > 0 ? r.top + r.height / 2 : 24
  return { dx: x - window.innerWidth / 2, dy: y - window.innerHeight / 2 }
}

function popPill() {
  const pill = document.querySelector<HTMLElement>('.hnav-credits')
  if (!pill) return
  pill.classList.remove('is-pop')
  void pill.offsetWidth // restart the animation
  pill.classList.add('is-pop')
}

function makeCoin(layer: HTMLElement, coin: ShowCoin): HTMLElement {
  const el = document.createElement('div')
  el.className = 'ccs-coin'
  el.innerHTML = COIN_SVG
  if (coin.label) {
    const label = document.createElement('span')
    label.className = 'ccs-coin-label'
    label.textContent = coin.label
    el.appendChild(label)
  }
  layer.appendChild(el)
  return el
}

const arc = (dx: number, dy: number) => `translate(${dx * 0.5}px, ${dy * 0.5 - 80}px) scale(.6)`

async function earnCoin(layer: HTMLElement, coin: ShowCoin, land: () => void) {
  const el = makeCoin(layer, coin)
  await play(el, [
    { transform: 'perspective(600px) scale(.3) rotateY(0deg)', opacity: 0 },
    { transform: 'perspective(600px) scale(1) rotateY(360deg)', opacity: 1, offset: 0.35 },
    { transform: 'perspective(600px) scale(1) rotateY(720deg)', opacity: 1 },
  ], { duration: 900, easing: 'ease-out' })
  const { dx, dy } = pillOffset()
  await play(el, [
    { transform: 'translate(0px, 0px) scale(1)' },
    { transform: arc(dx, dy), offset: 0.5 },
    { transform: `translate(${dx}px, ${dy}px) scale(.19)` },
  ], { duration: 600, easing: 'cubic-bezier(.5,0,.75,1)' })
  el.remove()
  land()
}

function dust(layer: HTMLElement): Promise<void> {
  return Promise.all(Array.from({ length: 20 }, (_, i) => {
    const s = document.createElement('span')
    s.className = 'ccs-speck'
    layer.appendChild(s)
    const angle = (i / 20) * Math.PI * 2 + Math.random() * 0.3
    const dist = 40 + Math.random() * 50
    return play(s, [
      { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
      { transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist + 40}px) scale(.4)`, opacity: 0 },
    ], { duration: 800, delay: Math.random() * 120, easing: 'cubic-bezier(.2,.6,.4,1)' }).then(() => s.remove())
  })).then(() => {})
}

async function spendCoin(layer: HTMLElement, coin: ShowCoin, leave: () => void) {
  const { dx, dy } = pillOffset()
  const el = makeCoin(layer, coin)
  leave()
  await play(el, [
    { transform: `translate(${dx}px, ${dy}px) scale(.19)` },
    { transform: arc(dx, dy), offset: 0.5 },
    { transform: 'translate(0px, 0px) scale(1)' },
  ], { duration: 600, easing: 'cubic-bezier(.25,0,.5,1)' })
  await play(el, [
    { transform: 'perspective(600px) rotateY(0deg)' },
    { transform: 'perspective(600px) rotateY(360deg)' },
  ], { duration: 500, easing: 'ease-in-out' })
  el.remove()
  await dust(layer)
}

export default function CreditCoinShow({ plan, onBalance, onDone, persist }: {
  plan: CreditShowPlan
  onBalance: (n: number) => void
  onDone: () => void
  persist: boolean
}) {
  const layerRef = useRef<HTMLDivElement>(null)
  const [burst, setBurst] = useState<ShowBurst | null>(null)
  const [still, setStill] = useState(false)
  const callbacks = useRef({ onBalance, onDone })
  callbacks.current = { onBalance, onDone }
  const finished = useRef(false)
  const marked = useRef(false)
  const skipRef = useRef<() => void>(() => {})

  useEffect(() => {
    let stopped = false
    const live = () => !stopped && !finished.current
    const finish = () => {
      if (finished.current || stopped) return
      finished.current = true
      layerRef.current?.replaceChildren()
      callbacks.current.onBalance(plan.finalBalance)
      callbacks.current.onDone()
    }
    skipRef.current = finish

    if (persist && !marked.current) {
      marked.current = true
      markCreditsSeen(plan.seenUpTo).catch(() => {})
    }

    let balance = plan.startBalance
    callbacks.current.onBalance(balance)
    const step = (value: number) => {
      if (!live()) return
      balance += value
      callbacks.current.onBalance(balance)
    }

    const reduced = prefersReducedMotion()
    ;(async () => {
      for (let i = 0; i < plan.bursts.length; i++) {
        if (!live()) return
        const b = plan.bursts[i]
        if (i > 0) await wait(BURST_PAUSE_MS)
        if (!live()) return
        setBurst(b)
        if (reduced) {
          setStill(true)
          step(b.coins.reduce((s, c) => s + c.value, 0))
          await wait(STILL_MS)
          if (!live()) return
          setStill(false)
        } else {
          const layer = layerRef.current
          if (!layer) return
          const run = b.kind === 'earn' ? earnCoin : spendCoin
          await Promise.all(b.coins.map((c, k) => wait(k * STAGGER_MS).then(() =>
            live() ? run(layer, c, () => { step(c.value); popPill() }) : undefined)))
        }
        if (!live()) return
        setBurst(null)
      }
      finish()
    })()

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish() }
    window.addEventListener('keydown', onKey)
    return () => {
      stopped = true
      window.removeEventListener('keydown', onKey)
    }
    // Runs once per mount on purpose: HomeNav keys this component by
    // plan.seenUpTo, so a genuinely new plan remounts it, while a fresh but
    // identical plan object (router.refresh re-rendering the layout) must not
    // restart a show that's mid-flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="ccs" onClick={() => skipRef.current()} role="presentation">
      <div className="ccs-backdrop" />
      <div ref={layerRef} className="ccs-layer" aria-hidden="true" />
      {still && <div className="ccs-coin ccs-still" aria-hidden="true" dangerouslySetInnerHTML={{ __html: COIN_SVG }} />}
      {burst && <p className={`ccs-caption ccs-${burst.kind}`} aria-hidden="true">{burst.caption}</p>}
      <p className="sr-only" aria-live="polite">{burst?.srText ?? ''}</p>
    </div>
  )
}
```

- [ ] **Step 4: Append styles to `app/home.css`** (directly after the `.hnav-coin circle:last-child { … }` rule)

```css
/* Credit coin show (components/CreditCoinShow.tsx). Rendered outside the
   header (its backdrop-filter would contain position:fixed). */
.hnav-credits.is-pop { animation: hnav-pop .3s ease-out; }
@keyframes hnav-pop { 0% { transform: scale(1); } 40% { transform: scale(1.15); } 100% { transform: scale(1); } }
.ccs { position: fixed; inset: 0; z-index: 200; cursor: pointer; }
.ccs-backdrop { position: absolute; inset: 0; background: rgba(43, 38, 34, .18); animation: ccs-fade .25s ease-out; }
.ccs-layer { position: absolute; inset: 0; }
.ccs-coin {
  position: fixed; left: 50%; top: 50%; width: 96px; height: 96px; margin: -48px 0 0 -48px;
  will-change: transform, opacity;
}
.ccs-coin svg { display: block; width: 100%; height: 100%; filter: drop-shadow(0 6px 10px rgba(43, 38, 34, .25)); }
.ccs-coin svg circle:first-child { fill: #E4B04A; stroke: #B9862A; stroke-width: 1.6; }
.ccs-coin svg circle:last-child { fill: none; stroke: #B9862A; stroke-width: 1.4; opacity: .75; }
.ccs-coin-label {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font: 800 26px 'Nunito', system-ui, sans-serif; color: #6B4A12;
}
.ccs-still { animation: ccs-fade-inout 1.5s ease both; }
.ccs-speck {
  position: fixed; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px;
  border-radius: 50%; background: #E4B04A;
}
.ccs-caption {
  position: fixed; left: 50%; top: calc(50% + 66px); transform: translateX(-50%); margin: 0;
  padding: 8px 16px; border-radius: 999px; background: #FFFFFF; border: 1px solid #E7DCCB;
  box-shadow: 0 18px 40px -24px rgba(43, 38, 34, .38);
  font: 700 15px 'Nunito', system-ui, sans-serif; color: #234A40;
  white-space: nowrap; max-width: calc(100vw - 32px); overflow: hidden; text-overflow: ellipsis;
  animation: ccs-fade .3s ease-out both;
}
.ccs-caption.ccs-spend { color: #B5462F; }
@keyframes ccs-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes ccs-fade-inout { 0% { opacity: 0; } 20%, 80% { opacity: 1; } 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .hnav-credits.is-pop { animation: none; }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run components/CreditCoinShow.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add components/CreditCoinShow.tsx components/CreditCoinShow.test.tsx app/home.css
git commit -m "Add the credit coin show: coin in, coin out to dust, reduced-motion fallback"
```

---

### Task 4: Wire it up — layout query, Nav, HomeNav, demo previews

**Files:**
- Modify: `app/layout.tsx` (profile select + new query, pass `unseenCredits`)
- Modify: `components/Nav.tsx` (prop pass-through)
- Modify: `components/HomeNav.tsx` (plan, displayed balance, mount show, demo param)
- Test: `components/HomeNav.test.tsx`

**Interfaces:**
- Consumes: `CREDIT_SHOW_REASONS`, `toUnseenCredits`, `planCreditShow`, `demoUnseenCredits`, `UnseenCredit` (Task 1); `CreditCoinShow` (Task 3).
- Produces: `Nav` and `HomeNav` accept `unseenCredits?: UnseenCredit[]`.

- [ ] **Step 1: Write the failing tests** — append to `components/HomeNav.test.tsx`:

```tsx
import type { UnseenCredit } from '@/lib/creditShow'

vi.mock('@/lib/actions/creditsSeen', () => ({ markCreditsSeen: vi.fn(() => Promise.resolve()) }))

describe('HomeNav credit coin show', () => {
  beforeEach(() => {
    pathname = '/'
    // Motion path (jsdom has no Web Animations, so coins run on timers): the
    // pill only changes when a coin lands ~1.5s in, so a synchronous
    // assertion sees the starting balance. (With reduced motion the first
    // burst's balance step is immediate.)
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia
  })

  const sale: UnseenCredit = { id: 's', amount: 1, reason: 'sale_earned', created_at: '2026-10-06T10:00:00Z', title: 'Dune' }

  it('shows the starting balance on first render while a show is pending', () => {
    render(<HomeNav userName="SeanB" credits={4} unseenCredits={[sale]} />)
    expect(screen.getByRole('link', { name: '3 credits' })).toBeInTheDocument()
  })

  it('mounts the show only when there are unseen credits', () => {
    const { container, rerender } = render(<HomeNav userName="SeanB" credits={4} />)
    expect(container.ownerDocument.querySelector('.ccs')).toBeNull()
    rerender(<HomeNav userName="SeanB" credits={4} unseenCredits={[sale]} />)
    expect(container.ownerDocument.querySelector('.ccs')).not.toBeNull()
  })

  it('no balance means no pill and no show, without crashing', () => {
    const { container } = render(<HomeNav userName="SeanB" credits={null} unseenCredits={[sale]} />)
    expect(container.ownerDocument.querySelector('.ccs')).toBeNull()
    expect(screen.queryByRole('link', { name: /credits?$/ })).toBeNull()
  })

  it('signed out never shows it', () => {
    const { container } = render(<HomeNav userName={null} credits={4} unseenCredits={[sale]} />)
    expect(container.ownerDocument.querySelector('.ccs')).toBeNull()
  })

  it('a re-render with an identical (new) rows array mid-show does not restart or remount it', () => {
    const { container, rerender } = render(<HomeNav userName="SeanB" credits={4} unseenCredits={[sale]} />)
    const overlay = container.ownerDocument.querySelector('.ccs')
    rerender(<HomeNav userName="SeanB" credits={4} unseenCredits={[{ ...sale }]} />)
    expect(container.ownerDocument.querySelector('.ccs')).toBe(overlay)
    expect(screen.getByRole('link', { name: '3 credits' })).toBeInTheDocument()
  })

  it('after the show is skipped the pill shows the real balance and the overlay is gone, and the same rows do not restart it', () => {
    const { container, rerender } = render(<HomeNav userName="SeanB" credits={4} unseenCredits={[sale]} />)
    fireEvent.click(container.ownerDocument.querySelector('.ccs')!)
    expect(screen.getByRole('link', { name: '4 credits' })).toBeInTheDocument()
    expect(container.ownerDocument.querySelector('.ccs')).toBeNull()
    rerender(<HomeNav userName="SeanB" credits={4} unseenCredits={[{ ...sale }]} />)
    expect(container.ownerDocument.querySelector('.ccs')).toBeNull()
  })
})
```

Also add `fireEvent` to the existing `@testing-library/react` import at the top of the file:
`import { render, screen, within, fireEvent } from '@testing-library/react'`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run components/HomeNav.test.tsx`
Expected: FAIL — the new tests (e.g. "Unable to find role link name '3 credits'"); existing tests still pass.

- [ ] **Step 3: Update `components/HomeNav.tsx`**

Add imports at the top (after the existing imports):

```tsx
import { useMemo, useState } from 'react'
import CreditCoinShow from './CreditCoinShow'
import { planCreditShow, demoUnseenCredits, type UnseenCredit } from '@/lib/creditShow'
```

(merge `useMemo, useState` into the existing `import { useEffect, useRef } from 'react'` line rather than adding a second react import.)

Add the prop:

```tsx
  credits,
  unseenCredits,
}: {
  userName?: string | null
  isAdmin?: boolean
  unreadCount?: number
  credits?: number | null
  unseenCredits?: UnseenCredit[]
}) {
```

After `const signedIn = !!userName`, add:

```tsx
  // Demo mode has no ledger; ?coin_demo=earn|spend|both|bundle previews the show.
  const [demoCredits, setDemoCredits] = useState<UnseenCredit[]>([])
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http')) return
    setDemoCredits(demoUnseenCredits(new URLSearchParams(window.location.search).get('coin_demo')))
  }, [pathname])
  const isDemo = demoCredits.length > 0
  const rows = isDemo ? demoCredits : unseenCredits

  // The coin show for credits the user hasn't seen yet. Keyed by seenUpTo so
  // the same rows arriving again (another render, router.refresh) don't
  // restart a show that already played or was skipped.
  const plan = useMemo(
    () => (signedIn && credits != null && rows?.length ? planCreditShow(rows, credits) : null),
    [signedIn, credits, rows],
  )
  const [doneKey, setDoneKey] = useState<string | null>(null)
  const [shownBalance, setShownBalance] = useState<number | null>(null)
  const showing = !!plan && doneKey !== plan.seenUpTo
  const pillBalance = showing ? (shownBalance ?? plan!.startBalance) : credits
```

In the pill JSX, replace every use of `credits` inside the `<Link className="hnav-credits">` (the `aria-label` and the visible number) with `pillBalance`, keeping the outer condition `signedIn && credits != null`:

```tsx
            {signedIn && credits != null && (
              <Link
                href="/profile?tab=wallet"
                className="hnav-credits"
                aria-label={`${pillBalance} ${pillBalance === 1 ? 'credit' : 'credits'}`}
                title="Your credits"
              >
                <svg className="hnav-coin" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="6.2" />
                </svg>
                {pillBalance}
              </Link>
            )}
```

After the mobile tab bar `</nav>` (still inside the fragment), mount the show:

```tsx
      {showing && (
        <CreditCoinShow
          key={plan!.seenUpTo}
          plan={plan!}
          persist={!isDemo}
          onBalance={setShownBalance}
          onDone={() => { setDoneKey(plan!.seenUpTo); setShownBalance(null) }}
        />
      )}
```

- [ ] **Step 4: Update `components/Nav.tsx`** — add `unseenCredits` to the props type and pass it through:

```tsx
import type { UnseenCredit } from '@/lib/creditShow'
…
export default function Nav({ userName: serverUserName, isAdmin, unreadCount, credits, unseenCredits }: { userName?: string | null; isAdmin?: boolean; unreadCount?: number; credits?: number | null; unseenCredits?: UnseenCredit[] }) {
…
    return <HomeNav userName={userName} isAdmin={isAdmin} unreadCount={unreadCount} credits={credits} unseenCredits={unseenCredits} />
```

The classic nav branch ignores it (spec: old-style pages neither play nor mark seen).

- [ ] **Step 5: Update `app/layout.tsx`**

Add the import:

```tsx
import { CREDIT_SHOW_REASONS, toUnseenCredits, type UnseenCredit } from '@/lib/creditShow'
```

Declare next to `credits`:

```tsx
  let unseenCredits: UnseenCredit[] = []
```

Change the profile select and add the query right after `credits = p?.credits ?? null`:

```tsx
        const { data: p } = await supabase.from('profiles').select('username, is_admin, onboarding_bonus_claimed, credits, credits_seen_at').eq('id', user.id).single()
        …
        credits = p?.credits ?? null
        // Credit changes the user hasn't seen animate in the nav (CreditCoinShow).
        if (p?.credits_seen_at) {
          const { data: rows } = await supabase
            .from('credit_transactions')
            .select('id, amount, reason, created_at, listings(title)')
            .eq('user_id', user.id)
            .in('reason', [...CREDIT_SHOW_REASONS])
            .gt('created_at', p.credits_seen_at)
            .order('created_at', { ascending: true })
            .limit(50)
          unseenCredits = toUnseenCredits(rows ?? [])
        }
```

Pass it to Nav:

```tsx
        <Nav userName={userName} isAdmin={isAdmin} unreadCount={unreadCount} credits={credits} unseenCredits={unseenCredits} />
```

(Any error in this query lands in the existing `catch {}` or yields `rows = null` → `[]`: plain balance, no show.)

- [ ] **Step 6: Run the tests**

Run: `npx vitest run components lib`
Expected: PASS, including all pre-existing `HomeNav`, `Nav` and `Nav.folk` tests.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p . 2>&1 | grep -c error`
Expected: `84` (the pre-existing count; no new errors). If higher, run without `-c` and fix any error in the files this plan touched.

- [ ] **Step 8: Commit**

```bash
git add app/layout.tsx components/Nav.tsx components/HomeNav.tsx components/HomeNav.test.tsx
git commit -m "Play the credit coin show in the nav for unseen credit changes"
```

---

### Task 5: Full suite, browser check, deploy note

**Files:** none changed unless the check finds a bug (then fix in the owning file with a test, and commit).

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: all test files pass.

- [ ] **Step 2: Browser check on the demo server**

The persistent demo server runs at http://localhost:3007 (check with `curl -s -o /dev/null -w "%{http_code}" http://localhost:3007/`; if it's down, restart it detached as recorded in project memory). With the `lbe_demo_user` cookie set, use Playwright (scratchpad install, Chromium at `~/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe`) to open each of:

- `/listings?coin_demo=earn`, `?coin_demo=spend`, `?coin_demo=both`, `?coin_demo=bundle`

at 1280×800 and 390×844. For each, take screenshots at ~0.5s (coin spinning + caption), ~1.3s (flight) and after it ends, and confirm:
- the pill starts at the start balance and ends at 3 (demo balance);
- the coin lands on/leaves from the pill's coin on both widths;
- spend ends in dust; `both` plays earn then spend;
- clicking mid-show ends it with the pill at 3;
- with `page.emulateMedia({ reducedMotion: 'reduce' })`, only a still coin + caption appears.

- [ ] **Step 3: Report the deploy prerequisite to the user**

The `credits_seen_at` SQL appended to `supabase/schema.sql` in Task 2 must be run in the Supabase SQL editor **before** this is pushed/deployed — otherwise the layout's profile select fails, the `catch {}` swallows it, and signed-in users would see the nav as signed out.
