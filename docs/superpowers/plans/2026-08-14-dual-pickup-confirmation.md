# Dual Pickup Confirmation, 48hr Auto-Complete, and Disputes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current single-sided "Mark Picked Up" button (either party alone instantly completes an exchange) with a two-sided confirmation: both people confirm, or 48 hours pass and it auto-completes anyway — plus a Dispute button that freezes an exchange for admin review.

**Architecture:** Three new `conversations` columns (`seller_picked_up_at`, `buyer_picked_up_at`, `completion_type`) and a new `disputes` table hold the state. One Postgres function, `resolve_pickup()`, is the single source of truth for "is this exchange eligible to complete right now?" — called from a button click, a daily Vercel Cron job, and an admin resolving a dispute, so the completion rules exist in exactly one place. Completion still flows through the existing `complete_exchange_marks_listing_sold()` trigger untouched; this feature only changes what triggers `exchange_status → 'completed'`.

**Tech Stack:** Next.js 14 (App Router), Supabase (Postgres + RLS), TypeScript, Vitest + React Testing Library, Vercel Cron.

**Spec:** `docs/superpowers/specs/2026-08-14-dual-pickup-confirmation-design.md`

## Global Constraints

- Schema changes are applied by pasting SQL into the Supabase SQL Editor by hand — this project has no local Supabase CLI/migration tooling. Every schema task's "test" is a manual verification query, run and eyeballed, not an automated assertion.
- No server action (`'use server'` file) anywhere in this codebase has a unit test today — that convention holds here too. Only pure functions and React components get automated tests.
- Follow this repo's existing code style exactly: inline `style={{...}}` objects and Tailwind utility classes as already used in the touched files, not a new styling approach.
- The cron route must use `createServiceRoleClient()` from `lib/supabase/server` (bypasses RLS) — the normal cookie-based `createClient()` would see zero rows with no logged-in user, since `conversations` RLS only allows participants or admins to select.
- `resolve_pickup()`'s auto-timeout notification path deliberately does **not** attribute a chat message to either party (there's no single natural sender for a system-triggered event affecting both notification recipients) — direct notification inserts only for that path. Don't add a message insert there.

---

## Task 1: Database migration — pickup timestamps, disputes table, `resolve_pickup()`

**Files:**
- Modify: `supabase/schema.sql` (append new migration block at the end of the file)

**Interfaces:**
- Produces: `conversations.seller_picked_up_at`, `conversations.buyer_picked_up_at` (timestamptz, nullable), `conversations.completion_type` (text, nullable, `'manual' | 'auto_timeout'`); `disputes` table (`id, conversation_id, reporter_id, message, status, created_at, resolved_at`) with RLS; `resolve_pickup(p_conversation_id uuid, p_actor_id uuid default null) returns text`, granted to `authenticated` and `service_role`. Tasks 3, 4, and 9 all call this function.

There is no prior task to consume from. This task has no automated test cycle (no SQL test harness in this repo) — write the migration, then manually verify with the smoke queries in Step 2.

- [ ] **Step 1: Append the migration block to `supabase/schema.sql`**

Add this at the very end of the file:

```sql

-- ── Migration: dual pickup confirmation, 48hr auto-complete, disputes ────────
-- Run this block in Supabase SQL Editor:

-- 1. Per-party pickup confirmation timestamps + how an exchange finished.
alter table conversations
  add column if not exists seller_picked_up_at timestamptz,
  add column if not exists buyer_picked_up_at timestamptz,
  add column if not exists completion_type text check (completion_type in ('manual', 'auto_timeout'));

-- 2. Disputes. Filing one freezes resolve_pickup() below for that exchange
-- until an admin resolves it.
create table if not exists disputes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade not null,
  reporter_id uuid references profiles(id) not null,
  message text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table disputes enable row level security;

create policy "Participants and admins can view disputes" on disputes
  for select using (
    exists (select 1 from conversations c where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id))
    or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true)
  );

create policy "A participant can file a dispute on their own exchange" on disputes
  for insert with check (
    reporter_id = auth.uid()
    and exists (select 1 from conversations c where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id))
  );

create policy "Admins can resolve disputes" on disputes
  for update using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create index if not exists disputes_conversation_idx on disputes (conversation_id);
create index if not exists disputes_open_idx on disputes (status) where status = 'open';

-- 3. resolve_pickup() — the single source of truth for "is this exchange
-- eligible to complete right now?" Called from: markPickedUp (a real user
-- just confirmed, p_actor_id set), the daily cron job (nobody's acting,
-- p_actor_id null), and an admin resolving a dispute (p_actor_id null).
create or replace function resolve_pickup(p_conversation_id uuid, p_actor_id uuid default null)
returns text as $$
declare
  v_conv conversations%rowtype;
  v_completion_type text;
  v_book_title text;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if not found or v_conv.exchange_status <> 'confirmed' then
    return 'not_applicable';
  end if;

  if exists (select 1 from disputes where conversation_id = p_conversation_id and status = 'open') then
    return 'blocked_dispute';
  end if;

  if v_conv.buyer_picked_up_at is not null and v_conv.seller_picked_up_at is not null then
    v_completion_type := 'manual';
  elsif v_conv.buyer_picked_up_at is not null or v_conv.seller_picked_up_at is not null then
    if now() < coalesce(v_conv.buyer_picked_up_at, v_conv.seller_picked_up_at) + interval '48 hours' then
      return 'waiting';
    end if;
    v_completion_type := 'auto_timeout';
  else
    return 'waiting';
  end if;

  update conversations
  set exchange_status = 'completed', completed_at = now(), completion_type = v_completion_type
  where id = p_conversation_id;

  select title into v_book_title from listings where id = v_conv.listing_id;

  if v_completion_type = 'manual' and p_actor_id is not null then
    insert into messages (conversation_id, sender_id, body, kind)
    values (p_conversation_id, p_actor_id, '✅ Exchange completed — thanks for confirming pickup!', 'pickup');
  else
    insert into notifications (user_id, type, entity_id, title, body)
    select id, 'pickup', p_conversation_id, 'Exchange auto-completed',
      '⏱️ ' || coalesce(v_book_title, 'Your exchange') || ' auto-completed after 48 hours.'
    from profiles where id in (v_conv.buyer_id, v_conv.seller_id) and notify_pickup = true;
  end if;

  return 'completed_' || v_completion_type;
exception when others then
  raise warning 'resolve_pickup failed: %', sqlerrm;
  return 'error';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function resolve_pickup(uuid, uuid) to authenticated, service_role;
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Run the migration and smoke-test it**

Paste the block into the Supabase SQL Editor and run it. Then run these smoke queries (substitute real ids from your `conversations`/`profiles` tables — pick any two existing test accounts and any existing conversation between them that's currently `exchange_status = 'confirmed'`, or create a throwaway one):

```sql
-- column/table existence
select column_name from information_schema.columns where table_name = 'conversations' and column_name in ('seller_picked_up_at', 'buyer_picked_up_at', 'completion_type');
select table_name from information_schema.tables where table_name = 'disputes';

-- resolve_pickup returns 'waiting' when nobody has confirmed yet
select resolve_pickup('<conversation id, status=confirmed, both timestamps null>');
-- expect: waiting

-- set one timestamp, confirm it's still 'waiting' (not yet 48h)
update conversations set seller_picked_up_at = now() where id = '<that id>';
select resolve_pickup('<that id>');
-- expect: waiting

-- set the other timestamp too, confirm it completes as 'manual'
update conversations set buyer_picked_up_at = now() where id = '<that id>';
select resolve_pickup('<that id>');
-- expect: completed_manual
select exchange_status, completion_type from conversations where id = '<that id>';
-- expect: completed, manual

-- clean up the test row so it doesn't pollute real exchange history
delete from conversations where id = '<that id>';
```

Also verify the 48-hour + dispute branches on a second throwaway conversation:

```sql
-- backdate a confirmation to simulate the 48h window having passed
update conversations set seller_picked_up_at = now() - interval '49 hours' where id = '<conversation 2 id>';
select resolve_pickup('<conversation 2 id>');
-- expect: completed_auto_timeout

-- on a third throwaway conversation, confirm a dispute blocks it
update conversations set seller_picked_up_at = now() - interval '49 hours' where id = '<conversation 3 id>';
insert into disputes (conversation_id, reporter_id, message) values ('<conversation 3 id>', '<either participant id>', 'test dispute');
select resolve_pickup('<conversation 3 id>');
-- expect: blocked_dispute
delete from disputes where conversation_id = '<conversation 3 id>';
delete from conversations where id in ('<conversation 2 id>', '<conversation 3 id>');
```

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: add pickup timestamps, disputes table, and resolve_pickup() function"
```

---

## Task 2: Pure logic — `lib/pickupStatus.ts`

**Files:**
- Create: `lib/pickupStatus.ts`
- Test: `lib/pickupStatus.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions).
- Produces: `PickupRole = 'buyer' | 'seller'`, `PickupState = { kind: 'not_yet' } | { kind: 'can_confirm' } | { kind: 'waiting'; deadline: string } | { kind: 'disputed' }`, `pickupState(params: { role: PickupRole; exchangeStatus: string; sellerPickedUpAt: string | null; buyerPickedUpAt: string | null; hasOpenDispute: boolean }): PickupState`, `formatDeadline(iso: string): string`. Task 5 (`DashboardClient.tsx`) imports and calls both.

- [ ] **Step 1: Write the failing tests**

Create `lib/pickupStatus.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pickupState, formatDeadline } from './pickupStatus'

describe('pickupState', () => {
  const base = {
    exchangeStatus: 'confirmed',
    sellerPickedUpAt: null as string | null,
    buyerPickedUpAt: null as string | null,
    hasOpenDispute: false,
  }

  it('returns not_yet when the exchange is not in the confirmed status', () => {
    expect(pickupState({ ...base, role: 'seller', exchangeStatus: 'requested' })).toEqual({ kind: 'not_yet' })
  })

  it('returns disputed when there is an open dispute, regardless of timestamps', () => {
    expect(pickupState({ ...base, role: 'seller', hasOpenDispute: true })).toEqual({ kind: 'disputed' })
  })

  it('returns can_confirm when neither party has confirmed yet', () => {
    expect(pickupState({ ...base, role: 'seller' })).toEqual({ kind: 'can_confirm' })
    expect(pickupState({ ...base, role: 'buyer' })).toEqual({ kind: 'can_confirm' })
  })

  it('returns can_confirm for the party who has not confirmed, when the other one has', () => {
    expect(pickupState({ ...base, role: 'buyer', sellerPickedUpAt: '2026-08-01T00:00:00.000Z' })).toEqual({ kind: 'can_confirm' })
  })

  it('returns waiting with a deadline 48 hours after the confirming party own timestamp', () => {
    const result = pickupState({ ...base, role: 'seller', sellerPickedUpAt: '2026-08-01T00:00:00.000Z' })
    expect(result).toEqual({ kind: 'waiting', deadline: '2026-08-03T00:00:00.000Z' })
  })

  it('computes the waiting deadline from the correct role\'s own timestamp', () => {
    const result = pickupState({ ...base, role: 'buyer', buyerPickedUpAt: '2026-08-01T00:00:00.000Z' })
    expect(result).toEqual({ kind: 'waiting', deadline: '2026-08-03T00:00:00.000Z' })
  })
})

describe('formatDeadline', () => {
  it('formats an ISO string as a short human-readable date and time', () => {
    const formatted = formatDeadline('2026-08-03T14:30:00.000Z')
    expect(formatted).toMatch(/Aug/)
    expect(formatted).toMatch(/3/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- lib/pickupStatus.test.ts`
Expected: FAIL — `Cannot find module './pickupStatus'`.

- [ ] **Step 3: Write the implementation**

Create `lib/pickupStatus.ts`:

```ts
export type PickupRole = 'buyer' | 'seller'

export type PickupState =
  | { kind: 'not_yet' }
  | { kind: 'can_confirm' }
  | { kind: 'waiting'; deadline: string }
  | { kind: 'disputed' }

export function pickupState(params: {
  role: PickupRole
  exchangeStatus: string
  sellerPickedUpAt: string | null
  buyerPickedUpAt: string | null
  hasOpenDispute: boolean
}): PickupState {
  if (params.exchangeStatus !== 'confirmed') return { kind: 'not_yet' }
  if (params.hasOpenDispute) return { kind: 'disputed' }

  const ownTimestamp = params.role === 'seller' ? params.sellerPickedUpAt : params.buyerPickedUpAt
  if (ownTimestamp) {
    const deadline = new Date(new Date(ownTimestamp).getTime() + 48 * 60 * 60 * 1000).toISOString()
    return { kind: 'waiting', deadline }
  }
  return { kind: 'can_confirm' }
}

export function formatDeadline(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- lib/pickupStatus.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/pickupStatus.ts lib/pickupStatus.test.ts
git commit -m "feat: add pure pickup-state helpers"
```

---

## Task 3: Server actions — `markPickedUp` replaces `completeExchange`, add `fileDispute`

**Files:**
- Modify: `app/profile/actions.ts:80-100` (replace `completeExchange`)

**Interfaces:**
- Consumes: `resolve_pickup` RPC from Task 1.
- Produces: `markPickedUp(formData: FormData): Promise<void>`, `fileDispute(formData: FormData): Promise<{ ok: boolean; error?: string }>`. Task 5 (`DashboardClient.tsx`) and Task 7 (`app/profile/page.tsx`) consume both.

No automated test for this file — matches this codebase's established convention that server actions aren't unit tested. Verified manually via Task 5/7's dev-server QA.

- [ ] **Step 1: Replace `completeExchange` with `markPickedUp`**

In `app/profile/actions.ts`, replace:

```ts
export async function completeExchange(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')
  const conversationId = formData.get('conversation_id') as string

  await supabase.from('conversations')
    .update({ exchange_status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('exchange_status', 'confirmed')
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)

  await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender_id: user.id,
    body: '📚 Book picked up! Thanks so much!',
    kind: 'pickup',
  })

  redirect('/profile?tab=exchanges')
}
```

with:

```ts
export async function markPickedUp(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')
  const conversationId = formData.get('conversation_id') as string

  const { data: convo } = await supabase
    .from('conversations')
    .select('buyer_id, seller_id')
    .eq('id', conversationId)
    .single()

  const isSeller = convo?.seller_id === user.id
  const isBuyer = convo?.buyer_id === user.id
  if (!convo || (!isSeller && !isBuyer)) redirect('/profile?tab=exchanges')

  const column = isSeller ? 'seller_picked_up_at' : 'buyer_picked_up_at'

  // is(column, null) guards against a double-click re-firing the message
  // below for a party who already confirmed once.
  const { data: updated } = await supabase
    .from('conversations')
    .update({ [column]: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('exchange_status', 'confirmed')
    .is(column, null)
    .select('id')
    .maybeSingle()

  if (updated) {
    const { data: result } = await supabase.rpc('resolve_pickup', {
      p_conversation_id: conversationId,
      p_actor_id: user.id,
    })

    if (result === 'waiting') {
      const { data: profile } = await supabase.from('profiles').select('username').eq('id', user.id).single()
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_id: user.id,
        body: `📦 ${profile?.username ?? 'They'} marked this picked up! Please confirm on your end within 48 hours.`,
        kind: 'pickup',
      })
    }
  }

  redirect('/profile?tab=exchanges')
}
```

- [ ] **Step 2: Add `fileDispute`**

In `app/profile/actions.ts`, add after `markPickedUp`:

```ts
export async function fileDispute(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please sign in.' }

  const conversationId = formData.get('conversation_id') as string
  const message = ((formData.get('message') as string) || '').trim()
  if (!message) return { ok: false, error: 'Please describe the issue.' }

  const { data: convo } = await supabase
    .from('conversations')
    .select('buyer_id, seller_id, listing_id')
    .eq('id', conversationId)
    .single()
  if (!convo || (convo.buyer_id !== user.id && convo.seller_id !== user.id)) {
    return { ok: false, error: 'Exchange not found.' }
  }

  const { error } = await supabase.from('disputes').insert({
    conversation_id: conversationId,
    reporter_id: user.id,
    message,
  })
  if (error) return { ok: false, error: 'Could not file the dispute. Please try again.' }

  // Best-effort admin alert — the dispute row inserted above is what actually
  // freezes the exchange; a failed email here doesn't undo that.
  try {
    const { data: listing } = await supabase.from('listings').select('title').eq('id', convo.listing_id).single()
    const { data: admins } = await supabase.from('profiles').select('email').eq('is_admin', true)
    const { sendEmail } = await import('@/lib/email/resend')
    for (const admin of admins ?? []) {
      if (admin.email) {
        await sendEmail({
          to: admin.email,
          subject: `Dispute filed: ${listing?.title ?? 'an exchange'}`,
          text: `A dispute was filed on an exchange.\n\nMessage:\n${message}\n\nConversation ID: ${conversationId}`,
        })
      }
    }
  } catch {}

  return { ok: true }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep "app/profile/actions"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add app/profile/actions.ts
git commit -m "feat: replace completeExchange with dual-confirmation markPickedUp, add fileDispute"
```

---

## Task 4: Admin `resolveDispute` action

**Files:**
- Modify: `lib/actions/admin.ts`

**Interfaces:**
- Consumes: `requireAdmin` (existing), `resolve_pickup` RPC from Task 1.
- Produces: `resolveDispute(disputeId: string): Promise<{ ok: boolean; error?: string }>`. Task 8 (`DisputesAdminTab.tsx`) calls this.

No automated test (server action, see Global Constraints).

- [ ] **Step 1: Add the action**

In `lib/actions/admin.ts`, add:

```ts
export async function resolveDispute(disputeId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const { data: dispute, error: fetchError } = await supabase
    .from('disputes')
    .select('conversation_id')
    .eq('id', disputeId)
    .single()
  if (fetchError || !dispute) return { ok: false, error: 'Dispute not found.' }

  const { error } = await supabase
    .from('disputes')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('id', disputeId)
  if (error) return { ok: false, error: error.message }

  // Best-effort: if the exchange is otherwise eligible (both had already
  // confirmed, or the 48h window already passed while the dispute sat open),
  // this completes it immediately. If not, it resolves later via a confirm
  // click or the next cron run — resolveDispute doesn't need to know which.
  await supabase.rpc('resolve_pickup', { p_conversation_id: dispute.conversation_id })

  return { ok: true }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep "lib/actions/admin"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add lib/actions/admin.ts
git commit -m "feat: add admin resolveDispute action"
```

---

## Task 5: Dashboard — dual confirm buttons, waiting state, dispute button + popup

**Files:**
- Modify: `app/profile/DashboardClient.tsx`
- Test: `app/profile/DashboardClient.test.tsx`

**Interfaces:**
- Consumes: `pickupState`, `formatDeadline` from `lib/pickupStatus.ts` (Task 2); `markPickedUp`, `fileDispute` from `app/profile/actions.ts` (Task 3).
- Produces: `Exchange` type gains `seller_picked_up_at`, `buyer_picked_up_at`, `completion_type`, `hasOpenDispute`; `Props` replaces `completeExchange` with `markPickedUp` and adds `fileDispute`. Task 6 consumes `unreadEntityIds.decisionOrPickup` (already computed, just needs forwarding to `HistorySection`).

- [ ] **Step 1: Write the failing tests**

Add to `app/profile/DashboardClient.test.tsx`, in a new `describe` block (place after the existing exchange-related tests):

```tsx
describe('DashboardClient — dual pickup confirmation', () => {
  const confirmedExchange = {
    id: 'convo-2', listing_id: 'listing-2', buyer_id: 'them', seller_id: 'me',
    created_at: '2026-08-01T00:00:00.000Z',
    exchange_status: 'confirmed' as const, completed_at: null, buyer_hidden: false, seller_hidden: false,
    sellerRating: null, reviewed: false,
    seller_picked_up_at: null as string | null,
    buyer_picked_up_at: null as string | null,
    completion_type: null,
    hasOpenDispute: false,
    listings: { title: 'Dune', author: 'Frank Herbert' },
    buyer: { name: 'Neighbor' }, seller: { name: 'Me' },
    messages: [],
  }

  it('shows the seller their Mark Picked Up and Dispute buttons when neither party has confirmed', () => {
    render(<DashboardClient {...baseProps} exchanges={[confirmedExchange]} defaultTab="exchanges" />)
    expect(screen.getByText('📦 Mark Picked Up')).toBeInTheDocument()
    expect(screen.getByText('🚩 Dispute')).toBeInTheDocument()
  })

  it('shows the buyer their I Got It and Dispute buttons when neither party has confirmed', () => {
    const asBuyer = { ...confirmedExchange, id: 'convo-3', buyer_id: 'me', seller_id: 'them' }
    render(<DashboardClient {...baseProps} exchanges={[asBuyer]} defaultTab="exchanges" />)
    expect(screen.getByText('📚 I Got It!')).toBeInTheDocument()
    expect(screen.getByText('🚩 Dispute')).toBeInTheDocument()
  })

  it('shows a waiting state instead of the button once the seller has confirmed', () => {
    const sellerConfirmed = { ...confirmedExchange, seller_picked_up_at: '2026-08-01T00:00:00.000Z' }
    render(<DashboardClient {...baseProps} exchanges={[sellerConfirmed]} defaultTab="exchanges" />)
    expect(screen.queryByText('📦 Mark Picked Up')).not.toBeInTheDocument()
    expect(screen.getByText(/You confirmed — waiting for/)).toBeInTheDocument()
  })

  it('shows a dispute-pending state instead of both buttons when there is an open dispute', () => {
    const disputed = { ...confirmedExchange, hasOpenDispute: true }
    render(<DashboardClient {...baseProps} exchanges={[disputed]} defaultTab="exchanges" />)
    expect(screen.queryByText('📦 Mark Picked Up')).not.toBeInTheDocument()
    expect(screen.queryByText('🚩 Dispute')).not.toBeInTheDocument()
    expect(screen.getByText(/Dispute pending review/)).toBeInTheDocument()
  })

  it('opens the dispute popup and submits a message via fileDispute', async () => {
    const fileDispute = vi.fn(() => Promise.resolve({ ok: true }))
    render(<DashboardClient {...baseProps} exchanges={[confirmedExchange]} defaultTab="exchanges" fileDispute={fileDispute} />)

    fireEvent.click(screen.getByText('🚩 Dispute'))
    const textarea = await screen.findByPlaceholderText(/describe the issue/i)
    fireEvent.change(textarea, { target: { value: 'The book was damaged.' } })
    fireEvent.click(screen.getByRole('button', { name: /Send to Admin/i }))

    await waitFor(() => expect(fileDispute).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- app/profile/DashboardClient.test.tsx`
Expected: FAIL — `fileDispute`/`markPickedUp` props don't exist yet (TS), old buttons still instantly-completing, no dispute popup.

- [ ] **Step 3: Update the `Exchange` type**

In `app/profile/DashboardClient.tsx`, change:

```ts
  confirmed_address?: string | null
  confirmed_address_unit?: string | null
  confirmed_pickup?: string | null
  sellerRating: { average: number; count: number } | null
```

to:

```ts
  confirmed_address?: string | null
  confirmed_address_unit?: string | null
  confirmed_pickup?: string | null
  seller_picked_up_at?: string | null
  buyer_picked_up_at?: string | null
  completion_type?: string | null
  hasOpenDispute?: boolean
  sellerRating: { average: number; count: number } | null
```

- [ ] **Step 4: Update `Props`**

Change:

```ts
  completeExchange: (formData: FormData) => Promise<void>
```

to:

```ts
  markPickedUp: (formData: FormData) => Promise<void>
  fileDispute: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
```

- [ ] **Step 5: Import the new helpers, update the component signature and destructuring**

Add to the imports:

```ts
import { pickupState, formatDeadline } from '@/lib/pickupStatus'
```

In the component signature, replace `completeExchange` with `markPickedUp, fileDispute` in the destructured prop list (keep every other prop as-is).

- [ ] **Step 6: Add dispute-modal state**

Alongside the existing `confirmModal` state declaration, add:

```ts
  const [disputeModal, setDisputeModal] = useState<{ conversationId: string; title: string } | null>(null)
  const [disputeMessage, setDisputeMessage] = useState('')
  const [disputeSubmitting, setDisputeSubmitting] = useState(false)
  const [disputeError, setDisputeError] = useState<string | null>(null)
  const [disputeSubmitted, setDisputeSubmitted] = useState(false)
```

- [ ] **Step 7: Replace the two `status === 'confirmed'` action blocks with one unified, role-aware block**

Replace:

```tsx
                {/* Seller: mark picked up after confirmed */}
                {role === 'seller' && status === 'confirmed' && (
                  <form action={completeExchange}>
                    <input type="hidden" name="conversation_id" value={ex.id} />
                    <button className="font-extrabold text-[12px] hover:opacity-80"
                      style={{ background: '#fff7ed', border: '1.5px solid #fed7aa', color: '#f97316', padding: '7px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit' }}>
                      📦 Mark Picked Up
                    </button>
                  </form>
                )}
```

with:

```tsx
                {/* Both roles: dual pickup confirmation, once status is confirmed */}
                {status === 'confirmed' && (() => {
                  const state = pickupState({
                    role,
                    exchangeStatus: status,
                    sellerPickedUpAt: ex.seller_picked_up_at ?? null,
                    buyerPickedUpAt: ex.buyer_picked_up_at ?? null,
                    hasOpenDispute: !!ex.hasOpenDispute,
                  })

                  if (state.kind === 'disputed') {
                    return (
                      <span className="font-extrabold text-[12px]"
                        style={{ color: '#b45309', background: '#fffbeb', border: '1.5px solid #fcd34d', padding: '7px 18px', borderRadius: 999 }}>
                        ⚠️ Dispute pending review
                      </span>
                    )
                  }

                  if (state.kind === 'waiting') {
                    return (
                      <span className="font-extrabold text-[12px]"
                        style={{ color: '#166534', background: '#f0fdf4', border: '1.5px solid #bbf7d0', padding: '7px 18px', borderRadius: 999 }}>
                        ✅ You confirmed — waiting for {otherName} (auto-completes {formatDeadline(state.deadline)})
                      </span>
                    )
                  }

                  return (
                    <>
                      <form action={markPickedUp}>
                        <input type="hidden" name="conversation_id" value={ex.id} />
                        <button className="font-extrabold text-[12px] hover:opacity-80"
                          style={{ background: '#fff7ed', border: '1.5px solid #fed7aa', color: '#f97316', padding: '7px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit' }}>
                          {role === 'seller' ? '📦 Mark Picked Up' : '📚 I Got It!'}
                        </button>
                      </form>
                      <button
                        type="button"
                        onClick={() => {
                          setDisputeModal({ conversationId: ex.id, title: ex.listings?.title ?? 'this book' })
                          setDisputeMessage('')
                          setDisputeError(null)
                          setDisputeSubmitted(false)
                        }}
                        className="font-extrabold text-[12px] hover:opacity-80"
                        style={{ background: '#fff1f2', border: '1.5px solid #fca5a5', color: '#dc2626', padding: '7px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit' }}>
                        🚩 Dispute
                      </button>
                    </>
                  )
                })()}
```

Then remove the now-redundant buyer-side block entirely:

```tsx
                {/* Buyer: "I got it" after confirmed */}
                {role === 'buyer' && status === 'confirmed' && (
                  <form action={completeExchange}>
                    <input type="hidden" name="conversation_id" value={ex.id} />
                    <button className="font-extrabold text-[12px] hover:opacity-80"
                      style={{ background: '#f0fdf4', border: '1.5px solid #bbf7d0', color: '#166534', padding: '7px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit' }}>
                      📚 I Got It!
                    </button>
                  </form>
                )}
```

(The unified block above already covers both roles via `role === 'seller' ? ... : ...` for the label.)

- [ ] **Step 8: Render the dispute popup**

Immediately after the existing confirm-and-review popup block (the one starting `{confirmModal && (`), before its enclosing `</div>` closes the exchanges-tab return, add:

```tsx
            {/* Dispute popup */}
            {disputeModal && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
                <div style={{ background: '#fff', borderRadius: 20, padding: 24, width: 380, maxWidth: '90vw', position: 'relative' }}>
                  <button
                    type="button"
                    onClick={() => setDisputeModal(null)}
                    aria-label="Close"
                    style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 18, fontWeight: 900, lineHeight: 1 }}
                  >
                    ✕
                  </button>
                  <h3 className="font-display text-[18px] mb-1" style={{ paddingRight: 24 }}>Report an issue</h3>
                  <p className="font-semibold text-[12px] mb-4" style={{ color: '#aaa' }}>
                    Tell us what's wrong with <strong style={{ color: '#555' }}>{disputeModal.title}</strong> — this pauses the exchange until an admin looks into it.
                  </p>

                  {disputeSubmitted ? (
                    <p className="font-bold text-[13px]" style={{ color: '#166534' }}>
                      We've notified the admin team. This exchange is paused until it's resolved.
                    </p>
                  ) : (
                    <>
                      <textarea
                        value={disputeMessage}
                        onChange={e => setDisputeMessage(e.target.value)}
                        placeholder="Describe the issue..."
                        className="w-full border-2 border-gray-100 rounded-xl font-semibold text-[13px]"
                        style={{ padding: 10, minHeight: 90 }}
                      />
                      {disputeError && <p className="font-bold text-[12px] mt-2" style={{ color: '#dc2626' }}>{disputeError}</p>}
                      <div className="flex justify-end gap-2 mt-4">
                        <button type="button" onClick={() => setDisputeModal(null)} className="font-extrabold text-[13px]"
                          style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer' }}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={disputeSubmitting}
                          onClick={async () => {
                            if (!disputeMessage.trim()) { setDisputeError('Please describe the issue.'); return }
                            setDisputeSubmitting(true)
                            setDisputeError(null)
                            const fd = new FormData()
                            fd.set('conversation_id', disputeModal.conversationId)
                            fd.set('message', disputeMessage)
                            const result = await fileDispute(fd)
                            setDisputeSubmitting(false)
                            if (result.ok) setDisputeSubmitted(true)
                            else setDisputeError(result.error ?? 'Could not send this. Please try again.')
                          }}
                          className="font-extrabold text-[13px] text-white"
                          style={{ background: '#dc2626', padding: '9px 20px', borderRadius: 999, border: 'none', cursor: 'pointer' }}>
                          {disputeSubmitting ? 'Sending...' : 'Send to Admin'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm run test:run -- app/profile/DashboardClient.test.tsx`
Expected: PASS across the whole file, including the 5 new tests. If any pre-existing test fails because it referenced `completeExchange` in `baseProps`, update `baseProps` in the test file: replace `completeExchange: vi.fn(() => Promise.resolve()),` with `markPickedUp: vi.fn(() => Promise.resolve()), fileDispute: vi.fn(() => Promise.resolve({ ok: true })),`.

- [ ] **Step 10: Commit**

```bash
git add app/profile/DashboardClient.tsx app/profile/DashboardClient.test.tsx
git commit -m "feat: dual pickup confirmation buttons, waiting state, and dispute popup"
```

---

## Task 6: History — auto-completed tag and unread highlight

**Files:**
- Modify: `app/profile/HistorySection.tsx`
- Test: `app/profile/HistorySection.test.tsx`

**Interfaces:**
- Consumes: `unreadEntityIds.decisionOrPickup` (already computed in `DashboardClient.tsx`, just needs forwarding — no new computation).
- Produces: `HistoryExchange` type gains `completion_type?: string | null`; `HistorySection` gains an optional `unreadConversationIds?: string[]` prop (defaults to `[]`, matching `MessagesTab.tsx`'s existing prop name for the same concept). Nothing later consumes these directly.

- [ ] **Step 1: Write the failing tests**

Add to `app/profile/HistorySection.test.tsx`, in a new `describe` block:

```tsx
describe('HistorySection — auto-completed tag and unread highlight', () => {
  it('shows an Auto-completed tag when completion_type is auto_timeout', () => {
    const autoCompleted = { ...baseExchange, id: 'convo-auto', completion_type: 'auto_timeout' }
    const { container } = render(
      <HistorySection exchanges={[autoCompleted]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    expect(container.textContent).toContain('Auto-completed')
  })

  it('does not show the tag for a normal completion', () => {
    const { container } = render(
      <HistorySection exchanges={[baseExchange]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    expect(container.textContent).not.toContain('Auto-completed')
  })

  it('highlights a row whose conversation id is in unreadConversationIds', () => {
    const { container } = render(
      <HistorySection exchanges={[baseExchange]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview}
        unreadConversationIds={['convo-1']} />
    )
    expect(container.querySelector('[data-testid="history-row-highlighted"]')).not.toBeNull()
  })

  it('does not highlight a row not in unreadConversationIds', () => {
    const { container } = render(
      <HistorySection exchanges={[baseExchange]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview}
        unreadConversationIds={['some-other-convo']} />
    )
    expect(container.querySelector('[data-testid="history-row-highlighted"]')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- app/profile/HistorySection.test.tsx`
Expected: FAIL — no "Auto-completed" text rendered, no `history-row-highlighted` test id exists yet.

- [ ] **Step 3: Add `completion_type` to `HistoryExchange` and the `unreadConversationIds` prop**

In `app/profile/HistorySection.tsx`, change:

```ts
export type HistoryExchange = {
  id: string
  listing_id: string
  buyer_id: string
  seller_id: string
  exchange_status: string
  completed_at: string | null
```

to:

```ts
export type HistoryExchange = {
  id: string
  listing_id: string
  buyer_id: string
  seller_id: string
  exchange_status: string
  completed_at: string | null
  completion_type?: string | null
```

Change the component signature:

```ts
export default function HistorySection({
  exchanges, userId, hideExchangeHistory, submitReview,
}: {
  exchanges: HistoryExchange[]
  userId: string
  hideExchangeHistory: (formData: FormData) => Promise<void>
  submitReview: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
}) {
```

to:

```ts
export default function HistorySection({
  exchanges, userId, hideExchangeHistory, submitReview, unreadConversationIds = [],
}: {
  exchanges: HistoryExchange[]
  userId: string
  hideExchangeHistory: (formData: FormData) => Promise<void>
  submitReview: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
  unreadConversationIds?: string[]
}) {
```

- [ ] **Step 4: Render the tag and the highlight**

Inside the `completed.map(ex => { ... })` callback, after the existing `const isDeclined = ex.exchange_status === 'declined'` line, add:

```ts
          const isUnread = unreadConversationIds.includes(ex.id)
```

Change the row's wrapping `<div>` from:

```tsx
            <div key={ex.id} className="flex items-center gap-3" style={{ padding: '12px 0', borderBottom: '2px solid #f3f4f6' }}>
```

to:

```tsx
            <div
              key={ex.id}
              data-testid={isUnread ? 'history-row-highlighted' : undefined}
              className="flex items-center gap-3"
              style={{
                padding: '12px 0 12px 12px', borderBottom: '2px solid #f3f4f6',
                ...(isUnread ? { background: '#fff7ed', borderRadius: 12, boxShadow: 'inset 3px 0 0 #f97316' } : {}),
              }}
            >
```

Change the existing Sold/Bought/Declined badge block from:

```tsx
              <span className="font-extrabold text-[10px] whitespace-nowrap shrink-0"
                style={{
                  padding: '3px 10px', borderRadius: 999,
                  background: isDeclined ? '#fef2f2' : (role === 'seller' ? '#fff7ed' : '#f0fdfa'),
                  color: isDeclined ? '#dc2626' : (role === 'seller' ? '#f97316' : '#0d9488'),
                }}>
                {isDeclined ? 'Declined' : (role === 'seller' ? 'Sold' : 'Bought')}
              </span>
```

to:

```tsx
              <span className="font-extrabold text-[10px] whitespace-nowrap shrink-0"
                style={{
                  padding: '3px 10px', borderRadius: 999,
                  background: isDeclined ? '#fef2f2' : (role === 'seller' ? '#fff7ed' : '#f0fdfa'),
                  color: isDeclined ? '#dc2626' : (role === 'seller' ? '#f97316' : '#0d9488'),
                }}>
                {isDeclined ? 'Declined' : (role === 'seller' ? 'Sold' : 'Bought')}
              </span>
              {!isDeclined && ex.completion_type === 'auto_timeout' && (
                <span className="font-extrabold text-[10px] whitespace-nowrap shrink-0"
                  style={{ padding: '3px 10px', borderRadius: 999, background: '#fffbeb', color: '#b45309' }}>
                  ⏱️ Auto-completed
                </span>
              )}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:run -- app/profile/HistorySection.test.tsx`
Expected: PASS — all existing tests plus the 4 new ones.

- [ ] **Step 6: Wire `unreadConversationIds` from `DashboardClient.tsx`**

In `app/profile/DashboardClient.tsx`, find the `<HistorySection ... />` call site and change:

```tsx
            <HistorySection
              exchanges={exchanges as HistoryExchange[]}
              userId={userId}
              hideExchangeHistory={hideExchangeHistory}
              submitReview={submitReview}
            />
```

to:

```tsx
            <HistorySection
              exchanges={exchanges as HistoryExchange[]}
              userId={userId}
              hideExchangeHistory={hideExchangeHistory}
              submitReview={submitReview}
              unreadConversationIds={unreadEntityIds.decisionOrPickup}
            />
```

- [ ] **Step 7: Run the full test suite to confirm nothing else broke**

Run: `npm run test:run -- --exclude ".claude/**"`
Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add app/profile/HistorySection.tsx app/profile/HistorySection.test.tsx app/profile/DashboardClient.tsx
git commit -m "feat: show auto-completed tag and unread highlight in exchange History"
```

---

## Task 7: Wire everything into `app/profile/page.tsx`

**Files:**
- Modify: `app/profile/page.tsx`

**Interfaces:**
- Consumes: `markPickedUp`, `fileDispute` from Task 3.
- Produces: each exchange object gains `hasOpenDispute: boolean` before being passed to `DashboardClient`.

No automated test (server component page, no existing test precedent for this file — matches Global Constraints). Verified manually via Task 10's end-to-end QA.

- [ ] **Step 1: Swap the import**

Change:

```ts
import { updateProfile, updateListingStatus, completeExchange, hideExchangeHistory, confirmExchange, denyPurchase, cancelPurchase } from './actions'
```

to:

```ts
import { updateProfile, updateListingStatus, markPickedUp, fileDispute, hideExchangeHistory, confirmExchange, denyPurchase, cancelPurchase } from './actions'
```

- [ ] **Step 2: Fetch open disputes and merge `hasOpenDispute` onto each exchange**

Find the block that builds the `sellerIds`/`ratingRows` (right before the `exchanges = merged.map((row: any) => { ... })` call), and add, immediately before that `exchanges = merged.map(...)` line:

```ts
        const { data: openDisputeRows } = await supabase
          .from('disputes').select('conversation_id')
          .in('conversation_id', merged.map((r: any) => r.id))
          .eq('status', 'open')
        const disputedConvoIds = new Set((openDisputeRows ?? []).map((d: any) => d.conversation_id))
```

Then, inside the existing `exchanges = merged.map((row: any) => { ... return { ...row, ... } })` call, add `hasOpenDispute` to the returned object — change:

```ts
          return {
            ...row,
            exchange_status: row.exchange_status ?? 'none',
```

to:

```ts
          return {
            ...row,
            hasOpenDispute: disputedConvoIds.has(row.id),
            exchange_status: row.exchange_status ?? 'none',
```

- [ ] **Step 3: Update the `<DashboardClient ... />` call site**

Find `completeExchange={completeExchange}` and replace with:

```tsx
      markPickedUp={markPickedUp}
      fileDispute={fileDispute}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep "app/profile/page"`
Expected: no output (aside from the pre-existing, unrelated `Set` iteration warnings already present in this file before this change — ignore those).

- [ ] **Step 5: Commit**

```bash
git add app/profile/page.tsx
git commit -m "feat: wire markPickedUp, fileDispute, and open-dispute state into the profile page"
```

---

## Task 8: Admin Disputes tab

**Files:**
- Create: `app/admin/DisputesAdminTab.tsx`
- Modify: `app/admin/AdminClient.tsx`

**Interfaces:**
- Consumes: `resolveDispute` from Task 4.
- Produces: nothing consumed elsewhere — leaf admin UI.

No automated test — `app/admin` has no existing test coverage at all (matches Global Constraints); verified manually.

- [ ] **Step 1: Create `DisputesAdminTab.tsx`**

```tsx
// app/admin/DisputesAdminTab.tsx
'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveDispute } from '@/lib/actions/admin'

type Dispute = {
  id: string
  conversation_id: string
  reporter_id: string
  message: string
  created_at: string
  bookTitle: string
  buyerName: string
  sellerName: string
}

export default function DisputesAdminTab() {
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [loading, setLoading] = useState(true)
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const supabase = createClient()

    const { data: rows } = await supabase
      .from('disputes').select('id, conversation_id, reporter_id, message, created_at')
      .eq('status', 'open')
      .order('created_at', { ascending: false })

    if (!rows || rows.length === 0) {
      setDisputes([])
      setLoading(false)
      return
    }

    const convoIds = [...new Set(rows.map(r => r.conversation_id))]
    const { data: convos } = await supabase
      .from('conversations').select('id, listing_id, buyer_id, seller_id').in('id', convoIds)
    const convoMap: Record<string, any> = {}
    for (const c of convos ?? []) convoMap[c.id] = c

    const listingIds = [...new Set((convos ?? []).map(c => c.listing_id).filter(Boolean))]
    const { data: listings } = await supabase.from('listings').select('id, title').in('id', listingIds)
    const listingMap: Record<string, string> = {}
    for (const l of listings ?? []) listingMap[l.id] = l.title

    const userIds = [...new Set((convos ?? []).flatMap(c => [c.buyer_id, c.seller_id]))]
    const { data: profiles } = await supabase.from('profiles').select('id, username, name').in('id', userIds)
    const nameMap: Record<string, string> = {}
    for (const p of profiles ?? []) nameMap[p.id] = (p as any).name || p.username || 'Unknown'

    setDisputes(rows.map(r => {
      const convo = convoMap[r.conversation_id]
      return {
        ...r,
        bookTitle: convo ? (listingMap[convo.listing_id] ?? 'Unknown book') : 'Unknown book',
        buyerName: convo ? (nameMap[convo.buyer_id] ?? 'Unknown') : 'Unknown',
        sellerName: convo ? (nameMap[convo.seller_id] ?? 'Unknown') : 'Unknown',
      }
    }))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleResolve(id: string) {
    setResolvingId(id)
    await resolveDispute(id)
    await load()
    setResolvingId(null)
  }

  if (loading) return <p className="font-bold text-[13px]" style={{ color: '#aaa' }}>Loading disputes...</p>

  if (disputes.length === 0) {
    return <p className="font-bold text-[13px]" style={{ color: '#aaa' }}>No open disputes.</p>
  }

  return (
    <div className="flex flex-col" style={{ gap: 12 }}>
      {disputes.map(d => (
        <div key={d.id} style={{ background: '#fff', border: '2px solid #fecdd3', borderRadius: 16, padding: 16 }}>
          <p className="font-black text-[14px]">{d.bookTitle}</p>
          <p className="font-semibold text-[12px]" style={{ color: '#aaa' }}>
            Buyer: {d.buyerName} · Seller: {d.sellerName} · Filed {new Date(d.created_at).toLocaleDateString()}
          </p>
          <p className="font-semibold text-[13px] mt-2" style={{ color: '#444' }}>{d.message}</p>
          <button
            type="button"
            disabled={resolvingId === d.id}
            onClick={() => handleResolve(d.id)}
            className="font-extrabold text-[12px] text-white mt-3"
            style={{ background: '#059669', padding: '7px 18px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            {resolvingId === d.id ? 'Resolving...' : '✓ Resolve'}
          </button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `AdminClient.tsx`**

Change the `Tab` type:

```ts
type Tab = 'dashboard' | 'users' | 'locations' | 'reviews' | 'emails'
```

to:

```ts
type Tab = 'dashboard' | 'users' | 'locations' | 'reviews' | 'emails' | 'disputes'
```

Add the import:

```ts
import DisputesAdminTab from './DisputesAdminTab'
```

Add to the `TABS` array:

```ts
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id:'dashboard', label:'Dashboard',  icon:'📊' },
  { id:'users',     label:'Users',      icon:'👥' },
  { id:'locations', label:'Locations',  icon:'📍' },
  { id:'reviews',   label:'Reviews',    icon:'⭐' },
  { id:'emails',    label:'Emails',     icon:'✉️' },
  { id:'disputes',  label:'Disputes',   icon:'🚩' },
]
```

Add the render line next to the existing `{tab === 'emails' && <EmailsAdminTab users={users} />}`:

```tsx
          {tab === 'disputes'  && <DisputesAdminTab />}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "AdminClient|DisputesAdminTab"`
Expected: no output.

- [ ] **Step 4: Manual verification**

Run `npm run dev`, sign in as an admin user, go to Admin → Disputes. With no open disputes it should show "No open disputes." File a test dispute (via Task 5's UI, as a non-admin test account with a `confirmed`-status exchange), confirm it appears in this list with the right book title and both names, click Resolve, confirm it disappears from the list. Then check in the Supabase SQL Editor: `select status, resolved_at from disputes where id = '<that dispute id>'` shows `resolved` with a timestamp.

- [ ] **Step 5: Commit**

```bash
git add app/admin/DisputesAdminTab.tsx app/admin/AdminClient.tsx
git commit -m "feat: add admin Disputes tab"
```

---

## Task 9: Cron job for the 48-hour auto-complete

**Files:**
- Create: `app/api/cron/resolve-pickups/route.ts`
- Create or modify: `vercel.json`

**Interfaces:**
- Consumes: `createServiceRoleClient` from `lib/supabase/server`, `resolve_pickup` RPC from Task 1.
- Produces: nothing consumed by other tasks — this is the standalone scheduled entry point.

No automated test (HTTP route hitting a real database) — verified manually per Step 3.

- [ ] **Step 1: Create the route**

```ts
// app/api/cron/resolve-pickups/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceRoleClient()

  const { data: candidates, error } = await supabase
    .from('conversations')
    .select('id')
    .eq('exchange_status', 'confirmed')
    .or('seller_picked_up_at.not.is.null,buyer_picked_up_at.not.is.null')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let resolved = 0
  for (const row of candidates ?? []) {
    const { data: result } = await supabase.rpc('resolve_pickup', { p_conversation_id: row.id })
    if (result === 'completed_auto_timeout') resolved++
  }

  return NextResponse.json({ checked: candidates?.length ?? 0, resolved })
}
```

- [ ] **Step 2: Register the cron schedule**

Create `vercel.json` at the project root (or add to it if it already exists by the time this runs):

```json
{
  "crons": [
    {
      "path": "/api/cron/resolve-pickups",
      "schedule": "0 6 * * *"
    }
  ]
}
```

(Runs once daily at 06:00 UTC — matches the once-a-day cadence confirmed as acceptable; Vercel's free/Hobby tier doesn't support more frequent cron schedules.)

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep "app/api/cron"`
Expected: no output.

- [ ] **Step 4: Manual verification (local)**

Run `npm run dev`. In `.env.local`, temporarily add `CRON_SECRET=test-secret-123` (any string) and restart the dev server. Backdate a test conversation's `seller_picked_up_at` to 49 hours ago via the SQL Editor (same pattern as Task 1 Step 2), then:

```bash
curl -H "Authorization: Bearer test-secret-123" http://localhost:3000/api/cron/resolve-pickups
```

Expected: `{"checked":1,"resolved":1}` (or higher `checked` if other confirmed-but-unresolved test conversations exist), and `select exchange_status, completion_type from conversations where id = '<that id>'` in the SQL Editor shows `completed` / `auto_timeout`. Also verify a request with a wrong/missing `Authorization` header gets `401`.

- [ ] **Step 5: Set `CRON_SECRET` in Vercel and confirm deployment picks up the schedule**

In the Vercel project dashboard: Settings → Environment Variables, add `CRON_SECRET` (Production + Preview) to a real random value — Vercel automatically sends this same value as the `Authorization: Bearer` header when it invokes scheduled cron routes, so no code changes are needed beyond what's already written. After the next deploy, Settings → Cron Jobs should show the new daily schedule. This step is a dashboard action outside the codebase — note it as done once confirmed, no commit needed for it.

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/resolve-pickups/route.ts vercel.json
git commit -m "feat: add daily cron job to auto-resolve overdue pickups"
```

---

## Final Verification

- [ ] Run the full test suite: `npm run test:run -- --exclude ".claude/**"` — expect all tests passing, including the new ones from Tasks 2, 5, 6.
- [ ] Run `npx tsc --noEmit` — confirm no new errors beyond the pre-existing, unrelated ones (Set-iteration target warnings, `HistorySection.test.tsx` mock-typing warnings) that predate this plan.
- [ ] End-to-end manual QA with two real test accounts, working through every path in the spec:
  - Seller confirms, buyer confirms shortly after → immediate `manual` completion, first confirmer gets a chat-message notification, History shows no "Auto-completed" tag.
  - Only seller confirms → backdate their timestamp 49h via SQL Editor → run the cron route (or wait for the real schedule) → both parties notified, History shows "⏱️ Auto-completed" tag on both sides, credits moved (check `profiles.credits` and `credit_transactions` for both parties).
  - One party files a Dispute mid-window → confirm the 48-hour deadline does **not** fire while it's open (re-run the cron route, confirm no change) → resolve it as admin → confirm it completes on the next natural trigger (either immediately, if both had already confirmed, or on the next cron run).
  - Confirm the row-highlight in History actually shows for an unread pickup notification, and clears after visiting the Exchanges tab.
- [ ] Confirm `git worktree list` is clean and the feature branch is ready to merge per this project's usual finishing-a-development-branch flow.
