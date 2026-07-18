# Notifications Phase 1 (In-App) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add in-app notifications (no email/SMS) for 5 events — new message, purchase request, purchase confirm/deny, TBR match, pickup — surfaced as a total-unread badge on the Nav "Dashboard" link, per-tab unread badges on Exchanges/TBR/Messages, and highlighted rows for the specific items each notification is about.

**Architecture:** A single `notifications` table (RLS: read/mark-read only, no client insert policy) is populated two ways: (1) a Postgres trigger on `messages` that classifies inserts by a new `kind` column and covers 4 of the 5 event types for free, since those events are already implemented as message inserts; (2) a trigger on `listings` that re-implements the existing `tbrMatchPattern` word-boundary regex in plpgsql to catch TBR matches, including listings reopening. The one event with no message insert to hook (`denyPurchase`, which deletes the conversation) calls a small `create_notification()` RPC directly. All UI reads (badges, highlights) are plain Supabase selects computed server-side per page load; all read-state writes (except the purchase-request path) are client-side Supabase updates fired from existing interaction points, matching this codebase's established pattern of client components calling Supabase directly for simple mutations.

**Tech Stack:** Next.js 14 (App Router), Supabase (Postgres + RLS + Realtime not used here), TypeScript, Vitest + Testing Library.

## Global Constraints

- No automated test harness exists in this repo for Postgres triggers/RLS — SQL correctness is verified by manually running the migration in the Supabase SQL Editor and smoke-testing against the running app. Do not attempt to write a `.test.ts` for SQL.
- `read` state clears are client-side Supabase calls (matching `MessagesTab.tsx`'s existing pattern), not new server actions — except the `purchase_request` type, which clears inside `confirmExchange`/`denyPurchase` (existing server actions in `app/profile/actions.ts`).
- Badge counts are computed once per page load server-side; they do not live-decrement within a single visit. This is a deliberate Phase 1 simplification (see spec).
- Demo mode (`isDemo`) always shows zero badges/highlights and performs no notification reads or writes.
- Follow this repo's existing code style exactly: inline `style={{...}}` objects and Tailwind utility classes as already used in the touched files, not a new styling approach.

---

## Task 1: Database Migration — notifications table, triggers, RPC

**Files:**
- Modify: `supabase/schema.sql` (append new migration block at end of file, after the "seller can deny a purchase request" block at line 452)

**Interfaces:**
- Produces: `notifications` table (`id, user_id, type, entity_id, title, body, read, created_at`) with `type in ('message', 'purchase_request', 'purchase_decision', 'tbr_match', 'pickup')`.
- Produces: `messages.kind` column (`'chat' | 'purchase_request' | 'confirmation' | 'pickup'`, default `'chat'`).
- Produces: `profiles.notify_message`, `notify_purchase_request`, `notify_purchase_decision`, `notify_tbr_match`, `notify_pickup` (all `boolean not null default true`).
- Produces: `create_notification(p_user_id uuid, p_type text, p_entity_id uuid, p_title text, p_body text) returns void`, granted to `authenticated`, used by Task 4.
- Produces: triggers `notify_on_message_trigger` (on `messages`, AFTER INSERT) and `notify_tbr_matches_trigger` (on `listings`, AFTER INSERT OR UPDATE) that write to `notifications` with no application code needed to fire them.

There is no prior task to consume from. This task has no automated test cycle (no SQL test harness in this repo) — instead of the usual write-test/write-code/run-test loop, write the migration, then manually verify with the smoke queries in Step 2.

- [ ] **Step 1: Append the migration block to `supabase/schema.sql`**

Add this at the end of the file (after line 452, the closing `-- ────` of the "seller can deny a purchase request" block):

```sql

-- ── Migration: in-app notifications (Phase 1) ─────────────────────────────────
-- Run this block in Supabase SQL Editor:

-- 1. notifications table. No INSERT policy for `authenticated` — every row is
-- written either by a security-definer trigger function below (which runs as
-- the function owner and bypasses RLS, same pattern as
-- complete_exchange_marks_listing_sold) or by create_notification() (also
-- security definer). A regular client can never forge a notification into
-- someone else's feed.
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  type text not null check (type in ('message', 'purchase_request', 'purchase_decision', 'tbr_match', 'pickup')),
  entity_id uuid not null,
  title text not null,
  body text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table notifications enable row level security;

create policy "Users can view their own notifications" on notifications
  for select using (auth.uid() = user_id);

create policy "Users can mark their own notifications read" on notifications
  for update using (auth.uid() = user_id);

create index if not exists notifications_user_unread_idx on notifications (user_id, read);
create index if not exists notifications_entity_type_idx on notifications (entity_id, type);

-- 2. messages gains a `kind` column so one trigger can classify 4 of the 5
-- notification types without string-sniffing message bodies. Ordinary chat
-- sends (MessagesTab.tsx) are untouched — they default to 'chat'.
alter table messages add column if not exists kind text not null default 'chat'
  check (kind in ('chat', 'purchase_request', 'confirmation', 'pickup'));

-- 3. profiles gains 5 notification preference toggles, matching the existing
-- flat-boolean style already used for share_address / share_pickup.
alter table profiles
  add column if not exists notify_message boolean not null default true,
  add column if not exists notify_purchase_request boolean not null default true,
  add column if not exists notify_purchase_decision boolean not null default true,
  add column if not exists notify_tbr_match boolean not null default true,
  add column if not exists notify_pickup boolean not null default true;

-- 4. Regex-escape helper mirroring lib/tbrMatch.ts's escapeRegex(), used by
-- the listings trigger below. Character-by-character substitution avoids the
-- ambiguity of hand-building a POSIX/ARE bracket expression for the special-
-- character class.
create or replace function tbr_escape_regex(v text) returns text as $$
declare
  result text := '';
  c text;
  specials text := '.^$*+?()[]{}|\';
begin
  for i in 1..length(v) loop
    c := substr(v, i, 1);
    if position(c in specials) > 0 then
      result := result || '\' || c;
    else
      result := result || c;
    end if;
  end loop;
  return result;
end;
$$ language plpgsql immutable;

-- 5. messages trigger — covers `message`, `purchase_request`,
-- `purchase_decision` (confirmed), and `pickup`. requestPurchase,
-- confirmExchange, and completeExchange (Tasks 3-4) each insert a message
-- with a specific `kind`; this is the only place that turns those inserts
-- into notifications, so nothing in application code calls
-- create_notification() for these four cases.
create or replace function notify_on_message()
returns trigger as $$
declare
  v_conv conversations%rowtype;
  v_recipient uuid;
  v_type text;
  v_pref boolean;
  v_title text;
begin
  select * into v_conv from conversations where id = new.conversation_id;
  if not found then
    return new;
  end if;

  v_recipient := case when new.sender_id = v_conv.buyer_id then v_conv.seller_id else v_conv.buyer_id end;

  v_type := case new.kind
    when 'purchase_request' then 'purchase_request'
    when 'confirmation'     then 'purchase_decision'
    when 'pickup'            then 'pickup'
    else 'message'
  end;

  select case v_type
    when 'purchase_request'  then notify_purchase_request
    when 'purchase_decision' then notify_purchase_decision
    when 'pickup'             then notify_pickup
    else notify_message
  end into v_pref
  from profiles where id = v_recipient;

  if v_pref is distinct from true then
    return new;
  end if;

  v_title := case v_type
    when 'purchase_request'  then 'New purchase request'
    when 'purchase_decision' then 'Purchase request update'
    when 'pickup'             then 'Book picked up'
    else 'New message'
  end;

  insert into notifications (user_id, type, entity_id, title, body)
  values (v_recipient, v_type, new.conversation_id, v_title, left(new.body, 200));

  return new;
exception when others then
  raise warning 'notify_on_message failed: %', sqlerrm;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists notify_on_message_trigger on messages;
create trigger notify_on_message_trigger after insert on messages
  for each row execute procedure notify_on_message();

-- 6. listings trigger — covers `tbr_match`, including "notify me if it
-- reopens" (fires on ANY transition to 'active', not just creation, so it
-- covers denyPurchase's direct status update and cancelPurchase's
-- reopen_listing() RPC the same way, regardless of which path changed the
-- row). Mirrors the word-boundary rule in lib/tbrMatch.ts's
-- tbrMatchPattern() — any change to one must be mirrored in the other.
create or replace function notify_tbr_matches()
returns trigger as $$
declare
  v_entry record;
  v_seller_state text;
begin
  if new.status <> 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' then
    return new;
  end if;

  select state into v_seller_state from profiles where id = new.user_id;

  for v_entry in
    select t.id, t.user_id
    from tbr_entries t
    join profiles p on p.id = t.user_id
    where t.user_id <> new.user_id
      and p.notify_tbr_match = true
      and (t.title = '' or new.title ~* ('(^|\W)' || tbr_escape_regex(t.title) || '(\W|$)'))
      and (t.author = '' or new.author ~* ('(^|\W)' || tbr_escape_regex(t.author) || '(\W|$)'))
      and (t.city = '' or new.city ~* ('(^|\W)' || tbr_escape_regex(t.city) || '(\W|$)'))
      and (t.state = '' or t.state = v_seller_state)
  loop
    insert into notifications (user_id, type, entity_id, title, body)
    values (v_entry.user_id, 'tbr_match', v_entry.id, 'A book on your TBR is available', new.title || ' by ' || new.author);
  end loop;

  return new;
exception when others then
  raise warning 'notify_tbr_matches failed: %', sqlerrm;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists notify_tbr_matches_trigger on listings;
create trigger notify_tbr_matches_trigger after insert or update on listings
  for each row execute procedure notify_tbr_matches();

-- 7. create_notification RPC — the one event with no message insert to hook:
-- denyPurchase (Task 4) deletes the conversation outright rather than
-- posting to it.
create or replace function create_notification(
  p_user_id uuid, p_type text, p_entity_id uuid, p_title text, p_body text
) returns void as $$
begin
  insert into notifications (user_id, type, entity_id, title, body)
  select p_user_id, p_type, p_entity_id, p_title, p_body
  from profiles
  where id = p_user_id
  and (case p_type
    when 'purchase_request'  then notify_purchase_request
    when 'purchase_decision' then notify_purchase_decision
    when 'pickup'             then notify_pickup
    when 'tbr_match'          then notify_tbr_match
    else notify_message
  end);
exception when others then
  raise warning 'create_notification failed: %', sqlerrm;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function create_notification(uuid, text, uuid, text, text) to authenticated;
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Run the migration and smoke-test it**

Paste the block into the Supabase SQL Editor for this project and run it. Then run these smoke queries in the same editor (replace `<uuid>` with a real id from your `profiles`/`listings` tables):

```sql
-- tbr_escape_regex parity check — must match lib/tbrMatch.test.ts's cases exactly
select 'Learning C++' ~* ('(^|\W)' || tbr_escape_regex('C++') || '(\W|$)') as should_be_true;   -- expect t
select 'Learning C' ~* ('(^|\W)' || tbr_escape_regex('C++') || '(\W|$)') as should_be_false;      -- expect f
select 'a good place in time' ~* ('(^|\W)' || tbr_escape_regex('me') || '(\W|$)') as should_be_false; -- expect f
select 'a book called Me' ~* ('(^|\W)' || tbr_escape_regex('me') || '(\W|$)') as should_be_true;      -- expect t

-- table/column existence
select column_name from information_schema.columns where table_name = 'notifications';
select column_name from information_schema.columns where table_name = 'messages' and column_name = 'kind';
select column_name from information_schema.columns where table_name = 'profiles' and column_name like 'notify_%';
```

Expected: the four boolean checks return `t, f, f, t` in that order; the three `information_schema` queries return the expected columns.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: add notifications table, triggers, and RPC for in-app notifications"
```

---

## Task 2: Pure notification-grouping logic (`lib/notifications.ts`)

**Files:**
- Create: `lib/notifications.ts`
- Test: `lib/notifications.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions, no dependencies).
- Produces: `NotificationType = 'message' | 'purchase_request' | 'purchase_decision' | 'tbr_match' | 'pickup'`, `NotificationRow = { type: NotificationType; entity_id: string }`, `UnreadCounts = { total: number; exchanges: number; tbr: number; messages: number }`, `unreadCounts(rows: NotificationRow[]): UnreadCounts`, `unreadEntityIds(rows: NotificationRow[], types: NotificationType[]): string[]`. Task 5 (`app/profile/page.tsx`) imports and calls both.

- [ ] **Step 1: Write the failing tests**

Create `lib/notifications.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { unreadCounts, unreadEntityIds, type NotificationRow } from './notifications'

describe('unreadCounts', () => {
  it('returns all zeros for an empty list', () => {
    expect(unreadCounts([])).toEqual({ total: 0, exchanges: 0, tbr: 0, messages: 0 })
  })

  it('buckets purchase_request, purchase_decision, and pickup into "exchanges"', () => {
    const rows: NotificationRow[] = [
      { type: 'purchase_request', entity_id: 'c1' },
      { type: 'purchase_decision', entity_id: 'c2' },
      { type: 'pickup', entity_id: 'c3' },
    ]
    expect(unreadCounts(rows)).toEqual({ total: 3, exchanges: 3, tbr: 0, messages: 0 })
  })

  it('counts tbr_match and message into their own buckets', () => {
    const rows: NotificationRow[] = [
      { type: 'tbr_match', entity_id: 't1' },
      { type: 'tbr_match', entity_id: 't2' },
      { type: 'message', entity_id: 'c1' },
    ]
    expect(unreadCounts(rows)).toEqual({ total: 3, exchanges: 0, tbr: 2, messages: 1 })
  })

  it('total is the sum across all buckets regardless of type mix', () => {
    const rows: NotificationRow[] = [
      { type: 'purchase_request', entity_id: 'c1' },
      { type: 'tbr_match', entity_id: 't1' },
      { type: 'message', entity_id: 'c2' },
    ]
    expect(unreadCounts(rows).total).toBe(3)
  })
})

describe('unreadEntityIds', () => {
  it('returns entity_id values only for the requested types', () => {
    const rows: NotificationRow[] = [
      { type: 'purchase_decision', entity_id: 'c1' },
      { type: 'pickup', entity_id: 'c2' },
      { type: 'message', entity_id: 'c3' },
    ]
    expect(unreadEntityIds(rows, ['purchase_decision', 'pickup'])).toEqual(['c1', 'c2'])
  })

  it('returns an empty array when no rows match the requested types', () => {
    const rows: NotificationRow[] = [{ type: 'message', entity_id: 'c1' }]
    expect(unreadEntityIds(rows, ['tbr_match'])).toEqual([])
  })

  it('returns an empty array for an empty input list', () => {
    expect(unreadEntityIds([], ['message'])).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- lib/notifications.test.ts`
Expected: FAIL — `Cannot find module './notifications'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `lib/notifications.ts`:

```ts
export type NotificationType = 'message' | 'purchase_request' | 'purchase_decision' | 'tbr_match' | 'pickup'

export type NotificationRow = {
  type: NotificationType
  entity_id: string
}

export type UnreadCounts = {
  total: number
  exchanges: number
  tbr: number
  messages: number
}

const EXCHANGE_TYPES = new Set<NotificationType>(['purchase_request', 'purchase_decision', 'pickup'])

export function unreadCounts(rows: NotificationRow[]): UnreadCounts {
  let exchanges = 0
  let tbr = 0
  let messages = 0
  for (const row of rows) {
    if (EXCHANGE_TYPES.has(row.type)) exchanges++
    else if (row.type === 'tbr_match') tbr++
    else if (row.type === 'message') messages++
  }
  return { total: rows.length, exchanges, tbr, messages }
}

export function unreadEntityIds(rows: NotificationRow[], types: NotificationType[]): string[] {
  const typeSet = new Set(types)
  return rows.filter(row => typeSet.has(row.type)).map(row => row.entity_id)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- lib/notifications.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/notifications.ts lib/notifications.test.ts
git commit -m "feat: add pure notification-grouping helpers"
```

---

## Task 3: Tag system messages with `kind`

**Files:**
- Modify: `app/listings/[id]/page.tsx:182-186` (`requestPurchase`'s message insert)
- Modify: `app/profile/actions.ts:50-54` (`completeExchange`'s message insert)
- Modify: `app/profile/actions.ts:155-159` (`confirmExchange`'s message insert)

**Interfaces:**
- Consumes: `messages.kind` column from Task 1.
- Produces: message inserts now include `kind`, which `notify_on_message()` (Task 1) reads to classify the notification type. No new exported functions.

No automated test exists for these server actions today (they require a live Supabase connection; none of `app/profile/actions.ts`'s existing exports have `.test.ts` coverage) — this task is verified manually via Task 1's smoke queries plus the end-to-end manual QA in Task 9.

- [ ] **Step 1: Add `kind: 'purchase_request'` to `requestPurchase`'s message insert**

In `app/listings/[id]/page.tsx`, change:

```ts
      // Send a purchase request message
      await supabase.from('messages').insert({
        conversation_id: convoId,
        sender_id: u!.id,
        body: '🛒 I\'d like to purchase this book! Please confirm when you\'re ready.',
      })
```

to:

```ts
      // Send a purchase request message
      await supabase.from('messages').insert({
        conversation_id: convoId,
        sender_id: u!.id,
        body: '🛒 I\'d like to purchase this book! Please confirm when you\'re ready.',
        kind: 'purchase_request',
      })
```

- [ ] **Step 2: Add `kind: 'pickup'` to `completeExchange`'s message insert**

In `app/profile/actions.ts`, change:

```ts
  await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender_id: user.id,
    body: '📚 Book picked up! Thanks so much!',
  })
```

to:

```ts
  await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender_id: user.id,
    body: '📚 Book picked up! Thanks so much!',
    kind: 'pickup',
  })
```

- [ ] **Step 3: Add `kind: 'confirmation'` to `confirmExchange`'s message insert**

In `app/profile/actions.ts`, change:

```ts
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body,
    })
```

(the one inside `confirmExchange`, following `buildConfirmationMessage`) to:

```ts
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body,
      kind: 'confirmation',
    })
```

- [ ] **Step 4: Manually verify via the dev server**

Run: `npm run dev`

As two separate signed-in test accounts (or one account plus a second browser/incognito window signed in as a different user): list a book as User A, request it as User B, confirm it as User A, mark picked up as either party. After each step, check the Supabase Table Editor's `notifications` table — a new row should appear for the *other* party each time, with `type` matching `purchase_request` → `purchase_decision` → `pickup` respectively.

- [ ] **Step 5: Commit**

```bash
git add app/listings/[id]/page.tsx app/profile/actions.ts
git commit -m "feat: tag system messages with kind so the notify_on_message trigger can classify them"
```

---

## Task 4: `denyPurchase` notification + purchase_request read-clearing

**Files:**
- Modify: `app/profile/actions.ts:103-163` (`confirmExchange`)
- Modify: `app/profile/actions.ts:165-196` (`denyPurchase`)

**Interfaces:**
- Consumes: `create_notification()` RPC from Task 1.
- Produces: no new exports — both functions gain one extra Supabase call each.

- [ ] **Step 1: `denyPurchase` calls `create_notification()` before deleting the conversation**

In `app/profile/actions.ts`, change `denyPurchase` from:

```ts
export async function denyPurchase(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const conversationId = formData.get('conversation_id') as string

  const { data: convo } = await supabase
    .from('conversations')
    .select('listing_id, exchange_status')
    .eq('id', conversationId)
    .eq('seller_id', user.id)
    .eq('exchange_status', 'requested')
    .maybeSingle()

  await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId)
    .eq('seller_id', user.id)
    .eq('exchange_status', 'requested')

  if (convo?.listing_id) {
    await supabase
      .from('listings')
      .update({ status: 'active' })
      .eq('id', convo.listing_id)
      .eq('status', 'pending')
  }

  redirect('/profile')
}
```

to:

```ts
export async function denyPurchase(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const conversationId = formData.get('conversation_id') as string

  const { data: convo } = await supabase
    .from('conversations')
    .select('listing_id, buyer_id, exchange_status')
    .eq('id', conversationId)
    .eq('seller_id', user.id)
    .eq('exchange_status', 'requested')
    .maybeSingle()

  if (convo?.buyer_id) {
    try {
      await supabase.rpc('create_notification', {
        p_user_id: convo.buyer_id,
        p_type: 'purchase_decision',
        p_entity_id: conversationId,
        p_title: 'Purchase request declined',
        p_body: 'The seller declined your purchase request.',
      })
    } catch {}
  }

  await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId)
    .eq('seller_id', user.id)
    .eq('exchange_status', 'requested')

  if (convo?.listing_id) {
    await supabase
      .from('listings')
      .update({ status: 'active' })
      .eq('id', convo.listing_id)
      .eq('status', 'pending')
  }

  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', user.id)
    .eq('entity_id', conversationId)
    .eq('type', 'purchase_request')

  redirect('/profile')
}
```

(The `select` gained `buyer_id` so the RPC has a recipient; the final `notifications` update clears the seller's own now-resolved "needs your OK" record, explicitly scoped to `user.id` — matching this file's existing convention of always filtering mutations by the owning column rather than relying solely on RLS.)

- [ ] **Step 2: `confirmExchange` clears the purchase_request notification**

In `app/profile/actions.ts`, in `confirmExchange`, after the existing `conversations` update (`.update({ exchange_status: 'confirmed' })...`) add:

```ts
  await supabase.from('conversations')
    .update({ exchange_status: 'confirmed' })
    .eq('id', conversationId)
    .eq('seller_id', user.id)

  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', user.id)
    .eq('entity_id', conversationId)
    .eq('type', 'purchase_request')

  const { data: profile } = await supabase
```

(inserting the new block between the existing `conversations` update and the existing `const { data: profile }` fetch, explicitly scoped to `user.id` for the same reason as `denyPurchase` — nothing else in the function changes).

- [ ] **Step 3: Manually verify via the dev server**

Run: `npm run dev`

As User A (seller) with a pending request from User B: click Deny. Check the Supabase Table Editor — the seller's `purchase_request` notification for that conversation should now have `read = true`, and a new `purchase_decision` row should exist for User B (the buyer) with `read = false`. Repeat with Confirm instead of Deny and check the same `purchase_request` row clears.

- [ ] **Step 4: Commit**

```bash
git add app/profile/actions.ts
git commit -m "feat: notify buyer on deny, clear purchase_request notification on confirm/deny"
```

---

## Task 5: Fetch and pass unread notification data (`app/profile/page.tsx`)

**Files:**
- Modify: `app/profile/page.tsx`

**Interfaces:**
- Consumes: `unreadCounts`, `unreadEntityIds`, `NotificationRow` from `lib/notifications.ts` (Task 2).
- Produces: two new props passed to `DashboardClient` — `unreadCounts: UnreadCounts` and `unreadEntityIds: { message: string[]; decisionOrPickup: string[]; tbrMatch: string[] }`. Task 7 (`DashboardClient.tsx`) and Task 8 (`MessagesTab.tsx`, via `DashboardClient`) consume these.

- [ ] **Step 1: Import the new helpers**

In `app/profile/page.tsx`, add to the imports:

```ts
import { unreadCounts as computeUnreadCounts, unreadEntityIds as computeUnreadEntityIds, type NotificationRow } from '@/lib/notifications'
```

- [ ] **Step 2: Declare default (empty) notification props**

Near the top of the function, alongside the existing `let profile`, `let listings`, etc. declarations, add:

```ts
  let unreadCounts = { total: 0, exchanges: 0, tbr: 0, messages: 0 }
  let unreadEntityIds = { message: [] as string[], decisionOrPickup: [] as string[], tbrMatch: [] as string[] }
```

These stay at their zero/empty defaults for the `demo` branch and the outer `catch` fallback — matching the spec's "demo mode gets zero badges" rule.

- [ ] **Step 3: Fetch and compute in the non-demo branch**

In the `else { try { ... } }` block, after the existing `tbrEntries` fetch (right after the block that ends `}))` for `tbrEntries = await Promise.all(...)`) and before the `conversations` fetch, add:

```ts
      const { data: notifRows } = await supabase
        .from('notifications').select('type, entity_id').eq('user_id', user.id).eq('read', false)
      const notifications: NotificationRow[] = (notifRows ?? []) as NotificationRow[]
      unreadCounts = computeUnreadCounts(notifications)
      unreadEntityIds = {
        message: computeUnreadEntityIds(notifications, ['message']),
        decisionOrPickup: computeUnreadEntityIds(notifications, ['purchase_decision', 'pickup']),
        tbrMatch: computeUnreadEntityIds(notifications, ['tbr_match']),
      }
```

- [ ] **Step 4: Pass the new props to `DashboardClient`**

In the `return <DashboardClient ... />` call, add two new props (anywhere in the prop list, e.g. after `tbrError={searchParams.tbr_error ?? null}`):

```tsx
      unreadCounts={unreadCounts}
      unreadEntityIds={unreadEntityIds}
```

- [ ] **Step 5: Manually verify via the dev server**

Run: `npm run dev`, sign in as a user with at least one unread notification (from Task 4's manual test), and add a temporary `console.log(unreadCounts, unreadEntityIds)` right before the `return` to confirm the shape and values look right in the server console, then remove the `console.log`.

- [ ] **Step 6: Commit**

```bash
git add app/profile/page.tsx
git commit -m "feat: fetch and compute unread notification counts for the dashboard"
```

---

## Task 6: Nav bar total-unread badge

**Files:**
- Modify: `app/layout.tsx`
- Modify: `components/Nav.tsx`
- Test: `components/Nav.test.tsx` (new)

**Interfaces:**
- Consumes: nothing new from other tasks (queries `notifications` directly, same as `app/profile/page.tsx` does independently — these two data-fetch sites are intentionally separate, per the spec's note that badges don't share a live store).
- Produces: `Nav` gains a new prop `unreadCount?: number`. No other file consumes this.

- [ ] **Step 1: Write the failing test**

Create `components/Nav.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Nav from './Nav'

vi.mock('next/navigation', () => ({
  usePathname: () => '/profile',
}))

describe('Nav', () => {
  it('does not show a badge on Dashboard when unreadCount is 0', () => {
    render(<Nav userName="Alice" unreadCount={0} />)
    expect(screen.queryByTestId('dashboard-badge')).not.toBeInTheDocument()
  })

  it('does not show a badge on Dashboard when unreadCount is omitted', () => {
    render(<Nav userName="Alice" />)
    expect(screen.queryByTestId('dashboard-badge')).not.toBeInTheDocument()
  })

  it('shows the unread count on the Dashboard badge', () => {
    render(<Nav userName="Alice" unreadCount={3} />)
    expect(screen.getByTestId('dashboard-badge')).toHaveTextContent('3')
  })

  it('caps the displayed badge at "99+"', () => {
    render(<Nav userName="Alice" unreadCount={140} />)
    expect(screen.getByTestId('dashboard-badge')).toHaveTextContent('99+')
  })

  it('does not show a badge when signed out, even with a nonzero count', () => {
    render(<Nav userName={null} unreadCount={3} />)
    expect(screen.queryByTestId('dashboard-badge')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- components/Nav.test.tsx`
Expected: FAIL — `unreadCount` prop doesn't exist yet / no `dashboard-badge` test id in the rendered output (the first three assertions pass vacuously since nothing renders it, but the "shows the unread count" and "caps at 99+" tests fail).

- [ ] **Step 3: Add the `unreadCount` prop and badge to `Nav.tsx`**

Change the component signature:

```tsx
export default function Nav({ userName: serverUserName, isAdmin, unreadCount }: { userName?: string | null; isAdmin?: boolean; unreadCount?: number }) {
```

Add a small helper above the component:

```tsx
function DashboardBadge({ count }: { count?: number }) {
  if (!count) return null
  return (
    <span
      data-testid="dashboard-badge"
      style={{
        marginLeft: 6, background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 900,
        borderRadius: 999, padding: '2px 6px', minWidth: 16, textAlign: 'center', display: 'inline-block',
        boxShadow: '0 2px 0 #b91c1c',
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
```

Update the desktop `Dashboard` link:

```tsx
              <Link href="/profile" className="font-bold text-[15px] text-[#2d2d2d] hover:text-bk-orange transition-colors flex items-center">Dashboard<DashboardBadge count={unreadCount} /></Link>
```

Update the mobile `Dashboard` link:

```tsx
              <Link href="/profile" className="flex items-center gap-3 px-5 py-4 font-bold text-[15px] text-[#2d2d2d] border-b border-gray-100 hover:bg-[#fff7ed] hover:text-bk-orange transition-colors md:hidden">
                📊 Dashboard<DashboardBadge count={unreadCount} />
              </Link>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- components/Nav.test.tsx`
Expected: PASS — 5 tests.

- [ ] **Step 5: Fetch the count in `app/layout.tsx` and pass it down**

In `app/layout.tsx`, change:

```tsx
  let userName: string | null = null
  let isAdmin = false

  // Check demo cookie first — getUser() returns null silently with placeholder URL
  // so we can't rely on the catch block to read it
  const demoCookie = cookies().get('lbe_demo_user')?.value
  if (demoCookie) {
    userName = demoCookie
  } else {
    try {
      const { createClient } = await import('@/lib/supabase/server')
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: p } = await supabase.from('profiles').select('username, is_admin').eq('id', user.id).single()
        userName = p?.username ?? user.email ?? 'Me'
        isAdmin = p?.is_admin === true
      }
    } catch {}
  }

  return (
    <html lang="en">
      <body className="bg-cream min-h-screen flex flex-col">
        <ScrollToTop />
        <Nav userName={userName} isAdmin={isAdmin} />
```

to:

```tsx
  let userName: string | null = null
  let isAdmin = false
  let unreadCount = 0

  // Check demo cookie first — getUser() returns null silently with placeholder URL
  // so we can't rely on the catch block to read it
  const demoCookie = cookies().get('lbe_demo_user')?.value
  if (demoCookie) {
    userName = demoCookie
  } else {
    try {
      const { createClient } = await import('@/lib/supabase/server')
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: p } = await supabase.from('profiles').select('username, is_admin').eq('id', user.id).single()
        userName = p?.username ?? user.email ?? 'Me'
        isAdmin = p?.is_admin === true
        const { count } = await supabase
          .from('notifications').select('id', { count: 'exact', head: true })
          .eq('user_id', user.id).eq('read', false)
        unreadCount = count ?? 0
      }
    } catch {}
  }

  return (
    <html lang="en">
      <body className="bg-cream min-h-screen flex flex-col">
        <ScrollToTop />
        <Nav userName={userName} isAdmin={isAdmin} unreadCount={unreadCount} />
```

- [ ] **Step 6: Manually verify via the dev server**

Run: `npm run dev`, sign in as a user with unread notifications, confirm the red badge shows the right number next to "Dashboard" in both the desktop nav and the mobile hamburger menu (resize the browser or use dev tools' device toolbar).

- [ ] **Step 7: Commit**

```bash
git add app/layout.tsx components/Nav.tsx components/Nav.test.tsx
git commit -m "feat: show total-unread badge on the Nav Dashboard link"
```

---

## Task 7: Dashboard tab badges, tab-switch read-clearing, and row highlighting

**Files:**
- Modify: `app/profile/DashboardClient.tsx`
- Test: `app/profile/DashboardClient.test.tsx` (new)

**Interfaces:**
- Consumes: `unreadCounts`, `unreadEntityIds` props from Task 5.
- Produces: `DashboardClient` passes `unreadConversationIds={unreadEntityIds.message}` down to `MessagesTab` (consumed by Task 8).

- [ ] **Step 1: Write the failing tests**

Create `app/profile/DashboardClient.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DashboardClient from './DashboardClient'
import { createClient } from '@/lib/supabase/client'

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}))

const baseProps = {
  profile: { id: 'me', username: 'me', city: 'Chicago', state: 'IL' },
  listings: [],
  savedListings: [],
  tbrEntries: [
    { id: 'tbr-1', title: 'Dune', author: '', city: '', state: '', match: { id: 'listing-1', title: 'Dune' } },
  ],
  updateAction: vi.fn(() => Promise.resolve()),
  updateListingStatus: vi.fn(() => Promise.resolve()),
  completeExchange: vi.fn(() => Promise.resolve()),
  hideExchangeHistory: vi.fn(() => Promise.resolve()),
  submitReview: vi.fn(() => Promise.resolve({ ok: true })),
  confirmExchange: vi.fn(() => Promise.resolve()),
  cancelPurchase: vi.fn(() => Promise.resolve()),
  denyPurchase: vi.fn(() => Promise.resolve()),
  removeSavedListing: vi.fn(() => Promise.resolve()),
  addTbrEntry: vi.fn(() => Promise.resolve()),
  removeTbrEntry: vi.fn(() => Promise.resolve()),
  isDemo: false,
  unreadCounts: { total: 2, exchanges: 1, tbr: 1, messages: 0 },
  unreadEntityIds: { message: [] as string[], decisionOrPickup: [] as string[], tbrMatch: ['tbr-1'] },
}

const pendingExchange = {
  id: 'convo-1', listing_id: 'listing-1', buyer_id: 'them', seller_id: 'me',
  exchange_status: 'requested' as const, completed_at: null, buyer_hidden: false, seller_hidden: false,
  sellerRating: null, reviewed: false,
  listings: { title: 'Dune', author: 'Frank Herbert' },
  buyer: { name: 'Neighbor' }, seller: { name: 'Me' },
  messages: [],
}

describe('DashboardClient — notification badges and highlighting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the tbr unread count as a badge on the TBR tab', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} defaultTab="tbr" />)
    const tbrButton = screen.getByText('To Be Read').closest('button')!
    expect(tbrButton.textContent).toContain('1')
  })

  it('shows the exchanges unread count as a badge on the Exchanges tab', () => {
    render(<DashboardClient {...baseProps} exchanges={[pendingExchange]} defaultTab="listings" />)
    const exchangesButton = screen.getByText('Exchanges').closest('button')!
    expect(exchangesButton.textContent).toContain('1')
  })

  it('shows no badge on a tab with zero unread', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} unreadCounts={{ ...baseProps.unreadCounts, messages: 0 }} defaultTab="listings" />)
    const messagesButton = screen.getByText('Messages').closest('button')!
    expect(messagesButton.querySelector('[data-testid="tab-badge"]')).toBeNull()
  })

  it('highlights a seller\'s pending purchase request row', () => {
    const { container } = render(<DashboardClient {...baseProps} exchanges={[pendingExchange]} defaultTab="exchanges" />)
    const highlighted = container.querySelector('[data-testid="exchange-row-highlighted"]')
    expect(highlighted).not.toBeNull()
    expect(highlighted?.textContent).toContain('Dune')
  })

  it('does not highlight a confirmed exchange row', () => {
    const confirmed = { ...pendingExchange, exchange_status: 'confirmed' as const }
    const { container } = render(<DashboardClient {...baseProps} exchanges={[confirmed]} defaultTab="exchanges" />)
    expect(container.querySelector('[data-testid="exchange-row-highlighted"]')).toBeNull()
  })

  it('marks purchase_decision/pickup notifications read when the Exchanges tab is opened', () => {
    const update = vi.fn(() => ({ eq: vi.fn().mockReturnThis() }))
    vi.mocked(createClient).mockReturnValue({ from: vi.fn(() => ({ update })) } as any)

    render(<DashboardClient {...baseProps} exchanges={[pendingExchange]} unreadEntityIds={{ ...baseProps.unreadEntityIds, decisionOrPickup: ['convo-2'] }} defaultTab="listings" />)
    fireEvent.click(screen.getByText('Exchanges').closest('button')!)
    expect(update).toHaveBeenCalledWith({ read: true })
  })

  it('does not call Supabase to mark read in demo mode', () => {
    render(<DashboardClient {...baseProps} exchanges={[pendingExchange]} isDemo={true} unreadEntityIds={{ ...baseProps.unreadEntityIds, decisionOrPickup: ['convo-2'] }} defaultTab="listings" />)
    fireEvent.click(screen.getByText('Exchanges').closest('button')!)
    expect(createClient).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- app/profile/DashboardClient.test.tsx`
Expected: FAIL — no `unreadCounts`/`unreadEntityIds` props recognized, no badges or highlight test ids rendered.

- [ ] **Step 3: Add the new props to the `Props` type**

In `app/profile/DashboardClient.tsx`, add to the `Props` type (after `initialConversationId?: string | null`):

```ts
  unreadCounts: { total: number; exchanges: number; tbr: number; messages: number }
  unreadEntityIds: { message: string[]; decisionOrPickup: string[]; tbrMatch: string[] }
```

- [ ] **Step 4: Destructure the new props and add the Supabase client import**

Add to the top imports:

```ts
import { createClient } from '@/lib/supabase/client'
```

Update the component signature to include `unreadCounts, unreadEntityIds` in the destructured props list (keep every existing prop as-is, just add these two at the end).

- [ ] **Step 5: Add a `markTabRead` handler and wire it into the tab buttons**

Inside the component body, after the existing `const [selectedConversationId, ...]` line, add:

```tsx
  async function markTabRead(tabId: Tab) {
    if (isDemo || !profile?.id) return
    if (tabId === 'exchanges' && unreadEntityIds.decisionOrPickup.length > 0) {
      const supabase = createClient()
      await supabase.from('notifications').update({ read: true })
        .eq('user_id', profile.id).in('type', ['purchase_decision', 'pickup'])
    } else if (tabId === 'tbr' && unreadEntityIds.tbrMatch.length > 0) {
      const supabase = createClient()
      await supabase.from('notifications').update({ read: true })
        .eq('user_id', profile.id).eq('type', 'tbr_match')
    }
  }

  function tabBadgeCount(id: Tab): number {
    if (id === 'exchanges') return unreadCounts.exchanges
    if (id === 'tbr') return unreadCounts.tbr
    if (id === 'messages') return unreadCounts.messages
    return 0
  }
```

Change the tab button's `onClick` from:

```tsx
              onClick={() => setActiveTab(t.id)}
```

to:

```tsx
              onClick={() => { setActiveTab(t.id); markTabRead(t.id) }}
```

Add `position: 'relative'` to the button's existing `style={{ ... }}` object (alongside `background`, `border`, etc.), and add the badge markup as the first child inside the `<button>`, before the existing `<span>{t.icon}</span>`:

```tsx
              {tabBadgeCount(t.id) > 0 && (
                <span
                  data-testid="tab-badge"
                  style={{
                    position: 'absolute', top: -6, right: -6, background: '#ef4444', color: '#fff',
                    fontSize: 10, fontWeight: 900, borderRadius: 999, padding: '2px 6px', minWidth: 18,
                    textAlign: 'center', boxShadow: '0 2px 0 #b91c1c',
                  }}
                >
                  {tabBadgeCount(t.id)}
                </span>
              )}
```

- [ ] **Step 6: Highlight the pending-request row and unread decision/pickup rows in the Exchanges tab**

Inside the `ExchangeRow` component (defined within the `activeTab === 'exchanges'` block), after the existing `const statusBadge = ...` block, add:

```tsx
          const isPendingSellerAction = role === 'seller' && status === 'requested'
          const isUnreadDecisionOrPickup = unreadEntityIds.decisionOrPickup.includes(ex.id)
          const highlighted = isPendingSellerAction || isUnreadDecisionOrPickup
```

Change the row's wrapping `<div>` from:

```tsx
            <div style={{ padding: '16px 0', borderBottom: '2px solid #f3f4f6' }}>
```

to:

```tsx
            <div
              data-testid={highlighted ? 'exchange-row-highlighted' : undefined}
              style={{
                padding: '16px 0 16px 12px', borderBottom: '2px solid #f3f4f6',
                ...(highlighted ? { background: '#fff7ed', borderRadius: 12, boxShadow: 'inset 3px 0 0 #f97316' } : {}),
              }}
            >
```

- [ ] **Step 7: Highlight unread TBR match rows**

In the `activeTab === 'tbr'` block, inside both the desktop (`hidden md:block`) and mobile (`md:hidden`) `tbrEntries.map(entry => ...)` blocks, compute at the top of each map callback:

```tsx
                  const isUnread = unreadEntityIds.tbrMatch.includes(entry.id)
```

Then add `...(isUnread ? { background: '#f5f3ff', borderRadius: 10 } : {})` to the spread of each row's existing `style={{ ... }}` object (both the desktop grid row and the mobile stacked card).

- [ ] **Step 8: Pass `unreadConversationIds` down to `MessagesTab`**

Change:

```tsx
        <MessagesTab
          exchanges={exchanges}
          userId={profile?.id ?? ''}
          isDemo={isDemo}
          selectedId={selectedConversationId}
          onSelectId={setSelectedConversationId}
        />
```

to:

```tsx
        <MessagesTab
          exchanges={exchanges}
          userId={profile?.id ?? ''}
          isDemo={isDemo}
          selectedId={selectedConversationId}
          onSelectId={setSelectedConversationId}
          unreadConversationIds={unreadEntityIds.message}
        />
```

(This prop doesn't exist on `MessagesTab` yet — Task 8 adds it. TypeScript will show an error until Task 8 is done; that's expected within this task sequence.)

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm run test:run -- app/profile/DashboardClient.test.tsx`
Expected: PASS — 7 tests. (TypeScript errors from Step 8's `unreadConversationIds` prop are expected until Task 8; they don't affect these vitest results since ts-check isn't part of the test run.)

- [ ] **Step 10: Commit**

```bash
git add app/profile/DashboardClient.tsx app/profile/DashboardClient.test.tsx
git commit -m "feat: add tab unread badges, tab-switch read-clearing, and row highlighting to the dashboard"
```

---

## Task 8: Messages tab — highlight unread conversations, clear on select

**Files:**
- Modify: `app/profile/MessagesTab.tsx`
- Modify: `app/profile/MessagesTab.test.tsx` (existing — add new cases)

**Interfaces:**
- Consumes: `unreadConversationIds: string[]` prop from Task 7.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `app/profile/MessagesTab.test.tsx`, inside a new `describe` block:

```tsx
describe('MessagesTab — unread highlighting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('highlights a conversation row that has an unread message notification', () => {
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={true} selectedId={null} onSelectId={vi.fn()} unreadConversationIds={['convo-1']} />
    )
    expect(container.querySelector('[data-testid="conversation-row-unread"]')).not.toBeNull()
  })

  it('does not highlight a conversation with no unread notification', () => {
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={true} selectedId={null} onSelectId={vi.fn()} unreadConversationIds={[]} />
    )
    expect(container.querySelector('[data-testid="conversation-row-unread"]')).toBeNull()
  })

  it('marks the conversation read via Supabase when selected in non-demo mode', () => {
    const update = vi.fn(() => ({ eq: vi.fn().mockReturnThis() }))
    vi.mocked(createClient).mockReturnValue({
      from: vi.fn(() => ({ update })),
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
      removeChannel: vi.fn(),
    } as any)

    const onSelectId = vi.fn()
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={false} selectedId={null} onSelectId={onSelectId} unreadConversationIds={['convo-1']} />
    )
    fireEvent.click(findButtonWithText(container, 'Neighbor A')!)
    expect(onSelectId).toHaveBeenCalledWith('convo-1')
    expect(update).toHaveBeenCalledWith({ read: true })
  })

  it('does not call Supabase to mark read in demo mode', () => {
    const onSelectId = vi.fn()
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={true} selectedId={null} onSelectId={onSelectId} unreadConversationIds={['convo-1']} />
    )
    fireEvent.click(findButtonWithText(container, 'Neighbor A')!)
    expect(createClient).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- app/profile/MessagesTab.test.tsx`
Expected: FAIL — `unreadConversationIds` prop doesn't exist yet; TypeScript will also flag Task 7's `DashboardClient.tsx` prop pass-through, but vitest itself will report the new test failures (missing highlight test id, `onSelectId` still called but no mark-read).

- [ ] **Step 3: Add the `unreadConversationIds` prop and wire it in**

Change the component signature from:

```tsx
export default function MessagesTab({
  exchanges, userId, isDemo, selectedId, onSelectId,
}: {
  exchanges: MessagesTabExchange[]
  userId: string
  isDemo: boolean
  selectedId: string | null
  onSelectId: (id: string | null) => void
}) {
```

to:

```tsx
export default function MessagesTab({
  exchanges, userId, isDemo, selectedId, onSelectId, unreadConversationIds,
}: {
  exchanges: MessagesTabExchange[]
  userId: string
  isDemo: boolean
  selectedId: string | null
  onSelectId: (id: string | null) => void
  unreadConversationIds: string[]
}) {
```

After the existing `const convo = exchanges.find(...)` / `const messages = ...` lines, add:

```tsx
  async function selectConversation(id: string) {
    onSelectId(id)
    if (!isDemo && unreadConversationIds.includes(id)) {
      const supabase = createClient()
      await supabase.from('notifications').update({ read: true })
        .eq('user_id', userId).eq('type', 'message').eq('entity_id', id)
    }
  }
```

- [ ] **Step 4: Use `selectConversation` and highlight unread rows in the conversation list**

In the conversation list's `exchanges.map(ex => { ... })` block, change:

```tsx
            const isActive = selectedId === ex.id
            const color = avatarColor(otherName)
```

to:

```tsx
            const isActive = selectedId === ex.id
            const isUnread = unreadConversationIds.includes(ex.id)
            const color = avatarColor(otherName)
```

Change:

```tsx
                onClick={() => onSelectId(ex.id)}
```

to:

```tsx
                onClick={() => selectConversation(ex.id)}
                data-testid={isUnread ? 'conversation-row-unread' : undefined}
```

Change the row's `style={{ ... background: isActive ? '#fff7ed' : 'transparent', ... }}` line to also reflect unread state when not active:

```tsx
                style={{
                  padding: '14px 16px', border: 'none', width: '100%', fontFamily: 'inherit', cursor: 'pointer',
                  background: isActive ? '#fff7ed' : isUnread ? '#fef9f0' : 'transparent',
                  borderLeft: isActive ? '3px solid #f97316' : isUnread ? '3px solid #fdba74' : '3px solid transparent',
                  borderBottom: '1px solid #f3f4f6',
                }}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:run -- app/profile/MessagesTab.test.tsx`
Expected: PASS — all existing tests plus the 4 new ones (14 total).

- [ ] **Step 6: Run the full test suite to confirm `DashboardClient.tsx`'s prop pass-through now type-checks cleanly**

Run: `npm run test:run`
Expected: PASS across all test files.

- [ ] **Step 7: Commit**

```bash
git add app/profile/MessagesTab.tsx app/profile/MessagesTab.test.tsx
git commit -m "feat: highlight unread conversations and clear on select in the Messages tab"
```

---

## Task 9: Notification preference settings (Profile tab)

**Files:**
- Modify: `app/profile/actions.ts:7-22` (`updateProfile`)
- Modify: `app/profile/ProfileCard.tsx`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed elsewhere — this is a leaf UI addition.

No automated test exists for `ProfileCard.tsx` today. `ShareToggle` (already tested in `components/ShareToggle.test.tsx`) is reused as-is with new `name` values, so its behavior is already covered; this task is verified manually.

- [ ] **Step 1: Persist the 5 new fields in `updateProfile`**

In `app/profile/actions.ts`, change `updateProfile` from:

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

to:

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
    notify_message:          formData.get('notify_message')          === 'true',
    notify_purchase_request: formData.get('notify_purchase_request') === 'true',
    notify_purchase_decision: formData.get('notify_purchase_decision') === 'true',
    notify_tbr_match:        formData.get('notify_tbr_match')        === 'true',
    notify_pickup:           formData.get('notify_pickup')           === 'true',
  }).eq('id', user!.id)
  redirect('/profile?success=1')
}
```

- [ ] **Step 2: Add the 5 fields to `ProfileCard`'s `Props['profile']` type**

In `app/profile/ProfileCard.tsx`, add to the `profile` prop's type (after `share_pickup?: boolean | null`):

```ts
    notify_message?: boolean | null
    notify_purchase_request?: boolean | null
    notify_purchase_decision?: boolean | null
    notify_tbr_match?: boolean | null
    notify_pickup?: boolean | null
```

- [ ] **Step 3: Add the 5 `ShareToggle` checkboxes to the edit form**

In `app/profile/ProfileCard.tsx`, after the existing "Pickup section" block (which ends with the `share_pickup` `ShareToggle` and its closing `</div></div>`), add a new section:

```tsx
            {/* Notifications section */}
            <div style={{ borderTop: '2px dashed #fed7aa', paddingTop: 16, marginTop: 4 }}>
              <p style={{ fontSize: 11, fontWeight: 900, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
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
```

- [ ] **Step 4: Manually verify via the dev server**

Run: `npm run dev`, sign in, go to the Dashboard's Profile tab, click Edit, confirm the 5 new toggles render (defaulting to ON) below the Pickup section, toggle a couple off, Save, re-open Edit, and confirm the toggled-off ones persisted as OFF.

- [ ] **Step 5: Commit**

```bash
git add app/profile/actions.ts app/profile/ProfileCard.tsx
git commit -m "feat: add notification preference toggles to the Profile tab"
```

---

## Final Verification

- [ ] Run the full test suite: `npm run test:run` — expect all tests passing, including the new ones from Tasks 2, 6, 7, 8.
- [ ] Run `npm run build` to confirm no TypeScript errors across the whole app (the prop-shape changes to `DashboardClient`/`MessagesTab`/`Nav` touch several call sites).
- [ ] End-to-end manual QA with two test accounts, working through every row of the spec's event list: new message, purchase request, confirm, deny, TBR match (including a reopened listing), pickup. After each, confirm: the right badge count appears (Nav + relevant tab) on next page load, the right row is highlighted, and the highlight/badge clears per the rules in "Read State & Highlighting" once addressed. Also confirm toggling a preference off in the Profile tab actually suppresses that notification type.
