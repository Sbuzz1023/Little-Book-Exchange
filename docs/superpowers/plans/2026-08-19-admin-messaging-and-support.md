# Admin Messaging (Email / Message) and Support Contact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admin message users in-app (single/selected/broadcast, one-shot or repliable) from a renamed "Email / Message" admin tab, give admin an Inbox to reply, add a "Message" button on disputes, and let users reach support via an in-app conversation.

**Architecture:** Extends the existing `conversations`/`messages` tables with `type` (`'exchange' | 'admin'`), `user_id`, and `repliable` columns instead of building a parallel messaging system — every admin send (even a broadcast) becomes its own `conversations` row per recipient, reusing the existing realtime subscription, notification trigger, and RLS patterns. Admin's targeting UI (all/one user/filtered) is the same `BroadcastTarget` machinery the existing email broadcast already uses, given a `channel` so it doesn't apply email-only filters (opt-out, has-email) to in-app messages.

**Tech Stack:** Next.js 14 (App Router), Supabase (Postgres + RLS), TypeScript, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-19-admin-messaging-and-support-design.md`

## Global Constraints

- Schema changes are applied by pasting SQL into the Supabase SQL Editor by hand — no local migration tooling. Every schema task's "test" is a manual verification query, run and eyeballed, not an automated assertion.
- No server action (`'use server'` file) anywhere in this codebase has a unit test today — that convention holds here too (`sendBroadcastMessage`, `startSupportConversation`). Only pure functions and React components get automated tests.
- Admin-folder components (`EmailComposeTab.tsx`, `EmailsAdminTab.tsx`, `DisputesAdminTab.tsx`, `AdminClient.tsx`) have no test files today and use Tailwind utility classes with occasional inline `style={{...}}` for colors — match that, don't introduce `MessagesTab.tsx`'s heavier inline-style convention into new admin files.
- `filterRecipients`'s default behavior (no `channel` argument passed) must stay byte-identical to today — the existing `broadcastRecipients.test.ts` asserts this, and `sendBroadcastEmail` relies on it unchanged.
- A message send (broadcast or single) reuses an existing `type='admin'` conversation for a recipient only when its `repliable` value matches what's being sent now; otherwise it creates a new one. This is deliberate — see spec's Admin Panel section.
- RLS is the real enforcement boundary for "no replies on a non-repliable thread" — never rely on client-side UI alone for that guarantee.

---

## Task 1: Database migration — admin conversations, RLS, notification trigger

**Files:**
- Modify: `supabase/schema.sql` (append new migration block at the end of the file)

**Interfaces:**
- Produces: `conversations.type` (`text`, `'exchange' | 'admin'`, default `'exchange'`), `conversations.user_id` (`uuid`, nullable), `conversations.repliable` (`boolean`, default `true`); `listing_id`/`buyer_id`/`seller_id` become nullable. New RLS policies on `conversations` and `messages` for `type='admin'` rows. `notify_on_message()` updated to handle `type='admin'` conversations. Tasks 3, 4, 6, and 9 all depend on these columns/policies existing.

No prior task to consume from. No automated test cycle (no SQL test harness in this repo) — write the migration, then manually verify with the smoke queries in Step 2.

- [ ] **Step 1: Append the migration block to `supabase/schema.sql`**

Add this at the very end of the file:

```sql

-- ── Migration: admin messaging (Email/Message tab) + support contact ─────────
-- Run this block in Supabase SQL Editor:

-- 1. conversations: relax NOT NULLs (type='admin' rows have no listing/buyer/
-- seller — they use user_id instead), add type/user_id/repliable.
alter table conversations alter column listing_id drop not null;
alter table conversations alter column buyer_id drop not null;
alter table conversations alter column seller_id drop not null;

alter table conversations
  add column if not exists type text not null default 'exchange' check (type in ('exchange', 'admin')),
  add column if not exists user_id uuid references profiles(id) on delete cascade,
  add column if not exists repliable boolean not null default true;

-- The existing unique(listing_id, buyer_id) constraint is untouched — Postgres
-- treats NULL as distinct from NULL in unique constraints, so any number of
-- type='admin' rows (both columns always NULL) can coexist.

-- 2. conversations RLS: additional permissive policies for type='admin' rows.
-- Existing exchange-type policies are untouched — Postgres ORs multiple
-- permissive policies together for the same command.
create policy "Admin conversation visible to its user or any admin" on conversations
  for select using (
    type = 'admin' and (
      user_id = auth.uid()
      or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true)
    )
  );

create policy "Admins or a user can start an admin conversation" on conversations
  for insert with check (
    type = 'admin' and (
      exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true)
      or user_id = auth.uid()
    )
  );

-- 3. messages RLS: additional permissive policies for type='admin' conversations.
create policy "Admin conversation messages viewable by participant or admin" on messages
  for select using (
    exists (
      select 1 from conversations c
      where c.id = conversation_id and c.type = 'admin'
      and (c.user_id = auth.uid() or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true))
    )
  );

create policy "Admin conversation messages: admin always, user if repliable" on messages
  for insert with check (
    exists (
      select 1 from conversations c
      where c.id = conversation_id and c.type = 'admin'
      and (
        exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true)
        or (c.repliable = true and c.user_id = auth.uid())
      )
    )
  );

-- 4. notify_on_message(): teach it about type='admin' conversations. Admin →
-- user sends notify the user like any other message; user → admin sends
-- (support requests/replies) don't notify anyone — admins check the new
-- Inbox tab instead, same as the existing Disputes tab has no notification.
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

  if v_conv.type = 'admin' then
    if new.sender_id = v_conv.user_id then
      return new;
    end if;
    v_recipient := v_conv.user_id;
  else
    v_recipient := case when new.sender_id = v_conv.buyer_id then v_conv.seller_id else v_conv.buyer_id end;
  end if;

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
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Run the migration and smoke-test it**

Paste the block into the Supabase SQL Editor and run it. Then run these smoke queries (substitute a real id from your `profiles` table for `<some user id>`):

```sql
-- columns exist
select column_name, is_nullable from information_schema.columns
where table_name = 'conversations' and column_name in ('type', 'user_id', 'repliable', 'listing_id', 'buyer_id', 'seller_id');
-- expect: type/repliable NOT NULL, user_id/listing_id/buyer_id/seller_id all nullable now

-- an admin-type conversation with no listing/buyer/seller can be created
insert into conversations (type, user_id, repliable) values ('admin', '<some user id>', false) returning id;
-- note the returned id as <test convo id>

-- a message can be inserted into it and the trigger doesn't error
insert into messages (conversation_id, sender_id, body) values ('<test convo id>', '<some user id>', 'test announcement');
select * from notifications where entity_id = '<test convo id>';
-- expect: no row (repliable=false doesn't matter here — sender_id = user_id, so
-- notify_on_message's "user is sender → skip" branch fired, not the repliable check)

-- an admin-sent message DOES notify the user (use a different, admin, sender id)
insert into messages (conversation_id, sender_id, body) values ('<test convo id>', '<a different, admin, user id>', 'hi from admin');
select type, entity_id from notifications where entity_id = '<test convo id>';
-- expect: one row, type = 'message'

-- clean up
delete from messages where conversation_id = '<test convo id>';
delete from notifications where entity_id = '<test convo id>';
delete from conversations where id = '<test convo id>';

-- existing exchange-type conversations still work unmodified — pick any real
-- existing conversation id and confirm it still selects fine
select id, listing_id, buyer_id, seller_id, type, repliable from conversations where type = 'exchange' limit 1;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: add admin-type conversations, RLS, and notification trigger support"
```

---

## Task 2: `filterRecipients` gains a message channel

**Files:**
- Modify: `lib/email/broadcastRecipients.ts`
- Test: `lib/email/broadcastRecipients.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `BroadcastChannel = 'email' | 'message'`; `filterRecipients(profiles: ProfileRow[], target: BroadcastTarget, channel: BroadcastChannel = 'email'): Recipient[]`. Task 3 (`lib/actions/emailAdmin.ts`) passes `channel: 'message'` through `fetchRecipients`/`resolveBroadcastRecipients`.

This is why: reusing the existing all/one-user/filtered targeting logic for messages is correct, but `filterRecipients`'s email-specific exclusions (`marketing_opt_out`, requires-an-email) are wrong for in-app messages — a user who opted out of marketing *emails*, or who has no email on file at all, should still receive an in-app broadcast message. This task separates "who matches the target" from "is this recipient reachable on this channel."

- [ ] **Step 1: Write the failing tests**

Append to `lib/email/broadcastRecipients.test.ts` (after the existing `describe('filterRecipients', ...)` block, same file, same `PROFILES` fixture already defined at the top):

```ts
describe('filterRecipients — message channel', () => {
  it('"all" includes opted-out-of-marketing-email users and users with no email', () => {
    const target: BroadcastTarget = { kind: 'all' }
    const result = filterRecipients(PROFILES, target, 'message').map(r => r.id)
    expect(result).toEqual(['1', '2', '3', '4'])
  })

  it('"user" returns that user even with no email on file', () => {
    const target: BroadcastTarget = { kind: 'user', userId: '4' }
    expect(filterRecipients(PROFILES, target, 'message')).toEqual([{ id: '4', email: '' }])
  })

  it('"filtered" by city still narrows the same way as the email channel', () => {
    const target: BroadcastTarget = { kind: 'filtered', city: 'Austin' }
    const result = filterRecipients(PROFILES, target, 'message').map(r => r.id)
    expect(result).toEqual(['3', '4'])
  })

  it('defaults to the email channel when none is passed, unchanged from before', () => {
    const target: BroadcastTarget = { kind: 'all' }
    expect(filterRecipients(PROFILES, target)).toEqual([
      { id: '1', email: 'a@example.com' },
      { id: '3', email: 'c@example.com' },
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- lib/email/broadcastRecipients.test.ts`
Expected: FAIL — `filterRecipients` doesn't accept a third argument yet, and the "email channel" results won't match the message-channel expectations.

- [ ] **Step 3: Implement**

Replace `lib/email/broadcastRecipients.ts` entirely with:

```ts
export type BroadcastTarget =
  | { kind: 'all' }
  | { kind: 'user'; userId: string }
  | { kind: 'filtered'; city?: string; state?: string }

export type BroadcastChannel = 'email' | 'message'

export type ProfileRow = { id: string; email: string | null; city: string; state: string; marketing_opt_out: boolean }
export type Recipient = { id: string; email: string }

export function filterRecipients(profiles: ProfileRow[], target: BroadcastTarget, channel: BroadcastChannel = 'email'): Recipient[] {
  if (target.kind === 'user') {
    const match = profiles.find(p => p.id === target.userId)
    if (!match) return []
    if (channel === 'message') return [{ id: match.id, email: match.email ?? '' }]
    return match.email ? [{ id: match.id, email: match.email }] : []
  }

  return profiles
    .filter(p => channel === 'message' || !p.marketing_opt_out)
    .filter(p => channel === 'message' || !!p.email)
    .filter(p => target.kind !== 'filtered' || !target.city || p.city === target.city)
    .filter(p => target.kind !== 'filtered' || !target.state || p.state === target.state)
    .map(p => ({ id: p.id, email: p.email ?? '' }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- lib/email/broadcastRecipients.test.ts`
Expected: PASS (all tests, old and new).

- [ ] **Step 5: Commit**

```bash
git add lib/email/broadcastRecipients.ts lib/email/broadcastRecipients.test.ts
git commit -m "feat: add a message channel to filterRecipients that skips email-only exclusions"
```

---

## Task 3: `sendBroadcastMessage` server action

**Files:**
- Modify: `lib/actions/emailAdmin.ts`

**Interfaces:**
- Consumes: `BroadcastTarget`, `BroadcastChannel`, `filterRecipients` from Task 2; `requireAdmin` (existing, `./libraryLocations`).
- Produces: `sendBroadcastMessage(target: BroadcastTarget, body: string, repliable: boolean): Promise<{ ok: boolean; sent: number; failed: number; error?: string }>`; `resolveBroadcastRecipients(target: BroadcastTarget, channel?: BroadcastChannel): Promise<{ ok: boolean; count?: number; error?: string }>` (existing function, gains the optional `channel` param). Task 8 (`EmailComposeTab.tsx`) calls both.

No automated test — matches this file's existing convention (`sendBroadcastEmail` has none either). Verified manually in Task 8/12 once there's a UI to drive it.

- [ ] **Step 1: Update `fetchRecipients` and `resolveBroadcastRecipients` to accept a channel**

In `lib/actions/emailAdmin.ts`, update the import line at the top:

```ts
import { filterRecipients, type BroadcastTarget, type Recipient, type ProfileRow, type BroadcastChannel } from '@/lib/email/broadcastRecipients'
```

Replace the `fetchRecipients` function:

```ts
async function fetchRecipients(
  supabase: ReturnType<typeof createClient>,
  target: BroadcastTarget,
  channel: BroadcastChannel = 'email'
): Promise<{ recipients?: Recipient[]; error?: string }> {
  const { data, error } = await supabase.from('profiles').select('id, email, city, state, marketing_opt_out')
  if (error) return { error: error.message }
  return { recipients: filterRecipients((data ?? []) as ProfileRow[], target, channel) }
}
```

Replace `resolveBroadcastRecipients`:

```ts
export async function resolveBroadcastRecipients(target: BroadcastTarget, channel: BroadcastChannel = 'email'): Promise<{ ok: boolean; count?: number; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const { recipients, error } = await fetchRecipients(supabase, target, channel)
  if (error || !recipients) return { ok: false, error: error ?? 'Failed to look up recipients.' }
  return { ok: true, count: recipients.length }
}
```

- [ ] **Step 2: Add `sendBroadcastMessage`**

Add this after the existing `sendBroadcastEmail` function (before `lookupUserEmail`):

```ts
async function findOrCreateAdminConversation(
  supabase: ReturnType<typeof createClient>, userId: string, repliable: boolean
): Promise<string> {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('type', 'admin')
    .eq('user_id', userId)
    .eq('repliable', repliable)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) return existing.id

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({ type: 'admin', user_id: userId, repliable })
    .select('id')
    .single()

  if (error || !created) throw error ?? new Error('Failed to create conversation')
  return created.id
}

export async function sendBroadcastMessage(target: BroadcastTarget, body: string, repliable: boolean): Promise<{ ok: boolean; sent: number; failed: number; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, sent: 0, failed: 0, error: admin.error }

  if (!body.trim()) return { ok: false, sent: 0, failed: 0, error: 'Message cannot be empty.' }

  const { recipients, error: recipientsError } = await fetchRecipients(supabase, target, 'message')
  if (recipientsError || !recipients) {
    return { ok: false, sent: 0, failed: 0, error: recipientsError ?? 'Failed to look up recipients.' }
  }

  let sent = 0, failed = 0
  for (const recipient of recipients) {
    try {
      const conversationId = await findOrCreateAdminConversation(supabase, recipient.id, repliable)
      const { error: msgError } = await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_id: admin.userId,
        body: body.trim(),
        kind: 'chat',
      })
      if (msgError) throw msgError
      sent++
    } catch (err) {
      console.error('sendBroadcastMessage: failed for recipient', recipient.id, err)
      failed++
    }
  }

  return { ok: true, sent, failed }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new type errors from `lib/actions/emailAdmin.ts`.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/emailAdmin.ts
git commit -m "feat: add sendBroadcastMessage server action, thread channel through recipient resolution"
```

---

## Task 4: `MessagesTab.tsx` — render admin-type conversations

**Files:**
- Modify: `app/profile/MessagesTab.tsx`
- Test: `app/profile/MessagesTab.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `MessagesTabExchange` gains `type?: 'exchange' | 'admin'`, `user_id?: string | null`, `repliable?: boolean`, and `listing_id`/`buyer_id`/`seller_id`/`listings`/`buyer`/`seller` become optional/nullable. Task 5 (`app/profile/page.tsx`) produces objects matching this shape.

- [ ] **Step 1: Write the failing tests**

Append to `app/profile/MessagesTab.test.tsx` (new `describe` block at the end of the file, after the existing `describe('MessagesTab — unread highlighting', ...)` block):

```ts
describe('MessagesTab — admin conversations', () => {
  const adminExchanges: MessagesTabExchange[] = [
    {
      id: 'admin-convo-1', type: 'admin', user_id: 'me', repliable: false,
      created_at: '2026-08-01T09:00:00.000Z',
      messages: [
        { id: 'a1', body: "We've added 3 new pickup spots in your area!", sender_id: 'admin-1', created_at: '2026-08-01T09:00:00.000Z' },
      ],
    },
    {
      id: 'admin-convo-2', type: 'admin', user_id: 'me', repliable: true,
      created_at: '2026-08-02T09:00:00.000Z',
      messages: [],
    },
  ]

  it('shows a fixed "Little Book Exchange Team" identity for an admin-type conversation', () => {
    const { container } = render(
      <MessagesTab exchanges={adminExchanges} userId="me" isDemo={true} selectedId={null} onSelectId={vi.fn()} />
    )
    expect(container.textContent).toContain('Little Book Exchange Team')
  })

  it('does not show a listing line for an admin-type conversation', () => {
    const { container } = render(
      <MessagesTab exchanges={adminExchanges} userId="me" isDemo={true} selectedId="admin-convo-1" onSelectId={vi.fn()} />
    )
    expect(container.textContent).not.toContain('📚')
  })

  it('shows a disabled-input notice instead of the message form when repliable is false', () => {
    const { container } = render(
      <MessagesTab exchanges={adminExchanges} userId="me" isDemo={true} selectedId="admin-convo-1" onSelectId={vi.fn()} />
    )
    expect(container.textContent).toContain("Announcement — replies aren't enabled")
    expect(container.querySelector('form')).toBeNull()
  })

  it('still shows an enabled message form for a repliable admin-type conversation', () => {
    const { container } = render(
      <MessagesTab exchanges={adminExchanges} userId="me" isDemo={true} selectedId="admin-convo-2" onSelectId={vi.fn()} />
    )
    expect(container.querySelector('form')).not.toBeNull()
    expect(container.textContent).not.toContain("replies aren't enabled")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- app/profile/MessagesTab.test.tsx`
Expected: FAIL — no "Little Book Exchange Team" text, listing line/form rendering doesn't distinguish admin conversations yet.

- [ ] **Step 3: Implement**

In `app/profile/MessagesTab.tsx`:

Replace the `MessagesTabExchange` type (lines 10-21):

```ts
export type MessagesTabExchange = {
  id: string
  type?: 'exchange' | 'admin'
  listing_id?: string | null
  buyer_id?: string | null
  seller_id?: string | null
  user_id?: string | null
  repliable?: boolean
  created_at: string
  listings?: { title: string; author: string; photo_url?: string | null } | null
  buyer?: { username?: string | null; name?: string | null }
  seller?: { username?: string | null; name?: string | null }
  sellerRating?: { average: number; count: number } | null
  messages: MessageRow[]
}
```

Replace `otherNameFor` (lines 39-42):

```ts
function otherNameFor(convo: MessagesTabExchange, userId: string) {
  if (convo.type === 'admin') return 'Little Book Exchange Team'
  const other = convo.buyer_id === userId ? convo.seller : convo.buyer
  return other?.name || other?.username || 'Neighbor'
}
```

In the conversation-list row rendering, the avatar circle (around what was lines 201-207) currently reads:

```tsx
<div style={{
  width: 44, height: 44, borderRadius: '50%', background: color,
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  color: '#fff', fontWeight: 900, fontSize: 17,
}}>
  {initial(otherName)}
</div>
```

Replace with:

```tsx
<div style={{
  width: 44, height: 44, borderRadius: '50%', background: ex.type === 'admin' ? '#f97316' : color,
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  color: '#fff', fontWeight: 900, fontSize: ex.type === 'admin' ? 20 : 17,
}}>
  {ex.type === 'admin' ? '📣' : initial(otherName)}
</div>
```

Just below it, the listing line currently reads:

```tsx
<p style={{ fontSize: 12, fontWeight: 700, color: isActive ? '#f97316' : '#aaa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 2 }}>
  📚 {ex.listings?.title}
</p>
```

Wrap it:

```tsx
{ex.type !== 'admin' && (
  <p style={{ fontSize: 12, fontWeight: 700, color: isActive ? '#f97316' : '#aaa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 2 }}>
    📚 {ex.listings?.title}
  </p>
)}
```

In the thread header, the rating badge line currently reads:

```tsx
{convo.seller_id !== userId && <StarRatingBadge rating={convo.sellerRating ?? null} sellerId={convo.seller_id} />}
```

Replace with (admin conversations have no `seller_id`, so this must be excluded explicitly, not just fall through the existing comparison):

```tsx
{convo.type !== 'admin' && convo.seller_id !== userId && <StarRatingBadge rating={convo.sellerRating ?? null} sellerId={convo.seller_id!} />}
```

Just below it, the listing-line-and-View-link div currently reads:

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
  <span style={{ fontSize: 12, fontWeight: 700, color: '#aaa' }}>📚 {convo.listings?.title}</span>
  <Link href={`/listings/${convo.listing_id}`} style={{ fontSize: 11, fontWeight: 700, color: '#f97316', textDecoration: 'none' }}>
    View →
  </Link>
</div>
```

Wrap it:

```tsx
{convo.type !== 'admin' && (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
    <span style={{ fontSize: 12, fontWeight: 700, color: '#aaa' }}>📚 {convo.listings?.title}</span>
    <Link href={`/listings/${convo.listing_id}`} style={{ fontSize: 11, fontWeight: 700, color: '#f97316', textDecoration: 'none' }}>
      View →
    </Link>
  </div>
)}
```

Finally, the message form at the bottom of the thread currently reads:

```tsx
<form onSubmit={send} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#fff', borderTop: '2px solid #e5e7eb' }}>
  {/* ...input and send button... */}
</form>
```

Wrap the whole thing in a conditional, adding the disabled-state sibling:

```tsx
{convo.type === 'admin' && convo.repliable === false ? (
  <div style={{ flexShrink: 0, padding: '14px 16px', background: '#fff', borderTop: '2px solid #e5e7eb', textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#bbb' }}>
    🔒 Announcement — replies aren't enabled
  </div>
) : (
  <form onSubmit={send} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#fff', borderTop: '2px solid #e5e7eb' }}>
    {/* ...unchanged input and send button... */}
  </form>
)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- app/profile/MessagesTab.test.tsx`
Expected: PASS (all tests, old and new).

- [ ] **Step 5: Commit**

```bash
git add app/profile/MessagesTab.tsx app/profile/MessagesTab.test.tsx
git commit -m "feat: render admin-type conversations in MessagesTab (fixed identity, no listing, disabled input when non-repliable)"
```

---

## Task 5: `app/profile/page.tsx` — fetch admin conversations into the Messages tab

**Files:**
- Modify: `app/profile/page.tsx`

**Interfaces:**
- Consumes: `MessagesTabExchange` shape from Task 4 (this task's output must match it).
- Produces: `exchanges` array passed to `DashboardClient` now includes the signed-in user's `type='admin'` conversations alongside their exchange-type ones.

No automated test — this file has none today (server component, page-level data assembly). Verified manually in Task 11.

- [ ] **Step 1: Add a third conversations query**

In `app/profile/page.tsx`, the existing `Promise.all` (around line 166-170) reads:

```ts
      const [{ data: asBuyer, error: buyerErr }, { data: asSeller, error: sellerErr }] =
       await Promise.all([
        supabase.from('conversations').select('*').eq('buyer_id', user.id).order('created_at', { ascending: false }),
        supabase.from('conversations').select('*').eq('seller_id', user.id).order('created_at', { ascending: false }),
      ])
```

Replace with:

```ts
      const [{ data: asBuyer, error: buyerErr }, { data: asSeller, error: sellerErr }, { data: asAdminUser, error: adminErr }] =
       await Promise.all([
        supabase.from('conversations').select('*').eq('buyer_id', user.id).order('created_at', { ascending: false }),
        supabase.from('conversations').select('*').eq('seller_id', user.id).order('created_at', { ascending: false }),
        supabase.from('conversations').select('*').eq('type', 'admin').eq('user_id', user.id).order('created_at', { ascending: false }),
      ])
```

- [ ] **Step 2: Merge the third result set**

Just below, the merge loop reads:

```ts
      // Merge and deduplicate
      const merged: any[] = []
      const seen = new Set<string>()
      for (const row of [...(asBuyer ?? []), ...(asSeller ?? [])]) {
        if (!seen.has(row.id)) { seen.add(row.id); merged.push(row) }
      }
```

Replace with:

```ts
      // Merge and deduplicate
      const merged: any[] = []
      const seen = new Set<string>()
      for (const row of [...(asBuyer ?? []), ...(asSeller ?? []), ...(asAdminUser ?? [])]) {
        if (!seen.has(row.id)) { seen.add(row.id); merged.push(row) }
      }
```

- [ ] **Step 3: Fix the error fallback and the `listings` fallback for admin rows**

The empty-result error fallback reads:

```ts
      } else {
        queryError = buyerErr?.message || sellerErr?.message || null
        exchanges = []
      }
```

Replace with:

```ts
      } else {
        queryError = buyerErr?.message || sellerErr?.message || adminErr?.message || null
        exchanges = []
      }
```

The final `exchanges = merged.map(...)` block reads:

```ts
        exchanges = merged.map((row: any) => {
          const sellerData = pm[row.seller_id] ?? { username: null, city: null, state: null }
          return {
            ...row,
            hasOpenDispute: disputedConvoIds.has(row.id),
            exchange_status: row.exchange_status ?? 'none',
            listings: lm[row.listing_id] ?? { title: 'Unknown', author: '', photo_url: null, city: null, state: null },
            buyer:    pm[row.buyer_id]   ?? { username: null, city: null, state: null },
            seller: sellerData,
            messages: mm[row.id] ?? [],
            sellerRating: averageRating(ratingsBySeller[row.seller_id] ?? []),
            reviewed: reviewedSet.has(row.id),
          }
        })
```

Replace with (only the `listings` line changes — admin-type rows have no listing to fall back to "Unknown" for, and `MessagesTab` skips rendering it anyway per Task 4):

```ts
        exchanges = merged.map((row: any) => {
          const sellerData = pm[row.seller_id] ?? { username: null, city: null, state: null }
          return {
            ...row,
            hasOpenDispute: disputedConvoIds.has(row.id),
            exchange_status: row.exchange_status ?? 'none',
            listings: row.type === 'admin' ? null : (lm[row.listing_id] ?? { title: 'Unknown', author: '', photo_url: null, city: null, state: null }),
            buyer:    pm[row.buyer_id]   ?? { username: null, city: null, state: null },
            seller: sellerData,
            messages: mm[row.id] ?? [],
            sellerRating: averageRating(ratingsBySeller[row.seller_id] ?? []),
            reviewed: reviewedSet.has(row.id),
          }
        })
```

Also, just above, `sellerIds` is built without filtering nulls (harmless for existing rows since `seller_id` was always populated before this migration, but an admin-type row's `seller_id` is now `null` and would otherwise land in this array):

```ts
        const sellerIds = [...new Set(merged.map((r: any) => r.seller_id))]
```

Replace with:

```ts
        const sellerIds = [...new Set(merged.map((r: any) => r.seller_id).filter(Boolean))]
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new type errors from `app/profile/page.tsx`.

- [ ] **Step 5: Commit**

```bash
git add app/profile/page.tsx
git commit -m "feat: fetch the signed-in user's admin conversations into the Messages tab"
```

---

## Task 6: `startSupportConversation()` server action

**Files:**
- Modify: `app/profile/actions.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `startSupportConversation(): Promise<{ ok: boolean; conversationId?: string; error?: string }>`. Task 7 (`app/profile/page.tsx` → `DashboardClient.tsx` → `ProfileCard.tsx`) threads this through as a prop.

No automated test — matches this file's existing convention (none of `markPickedUp`, `fileDispute`, `confirmExchange`, etc. have tests).

- [ ] **Step 1: Add the action**

Append to `app/profile/actions.ts`:

```ts
export async function startSupportConversation(): Promise<{ ok: boolean; conversationId?: string; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please sign in.' }

  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('type', 'admin')
    .eq('user_id', user.id)
    .eq('repliable', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) return { ok: true, conversationId: existing.id }

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({ type: 'admin', user_id: user.id, repliable: true })
    .select('id')
    .single()

  if (error || !created) return { ok: false, error: 'Could not start a support conversation. Please try again.' }
  return { ok: true, conversationId: created.id }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new type errors from `app/profile/actions.ts`.

- [ ] **Step 3: Commit**

```bash
git add app/profile/actions.ts
git commit -m "feat: add startSupportConversation server action"
```

---

## Task 7: Contact Support UI (Profile page → Messages tab)

**Files:**
- Modify: `app/profile/page.tsx`
- Modify: `app/profile/DashboardClient.tsx`
- Modify: `app/profile/ProfileCard.tsx`

**Interfaces:**
- Consumes: `startSupportConversation` from Task 6.
- Produces: a "🛟 Support" section in the Profile card with a "Message Support" button that starts/opens the user's support conversation directly in the Messages tab (no page navigation — reuses `DashboardClient`'s existing local tab-switch pattern, e.g. `onClick={() => { setActiveTab('messages'); setSelectedConversationId(ex.id) }}` already used elsewhere in that file), plus a plain support-email `mailto:` link.

No automated test — `ProfileCard.tsx` has no test file today, matching this repo's convention of leaving presentational form components untested. Verified manually in Task 11.

- [ ] **Step 1: Thread the action through `page.tsx`**

In `app/profile/page.tsx`, the import line reads:

```ts
import { updateProfile, updateListingStatus, markPickedUp, fileDispute, hideExchangeHistory, confirmExchange, denyPurchase, cancelPurchase } from './actions'
```

Replace with:

```ts
import { updateProfile, updateListingStatus, markPickedUp, fileDispute, hideExchangeHistory, confirmExchange, denyPurchase, cancelPurchase, startSupportConversation } from './actions'
```

The `<DashboardClient ... />` call passes `verifyPhoneOtp={verifyPhoneOtp}` near the end of its prop list — add a sibling line right after it:

```tsx
      verifyPhoneOtp={verifyPhoneOtp}
      startSupportConversation={startSupportConversation}
```

- [ ] **Step 2: Add the handler and prop in `DashboardClient.tsx`**

In `app/profile/DashboardClient.tsx`, the `Props` type has this block near the end:

```ts
  resendEmailConfirmation: () => Promise<{ ok: boolean; error?: string }>
  sendPhoneOtp: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
  verifyPhoneOtp: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
```

Add a line:

```ts
  resendEmailConfirmation: () => Promise<{ ok: boolean; error?: string }>
  sendPhoneOtp: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
  verifyPhoneOtp: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
  startSupportConversation: () => Promise<{ ok: boolean; conversationId?: string; error?: string }>
```

The component's destructured params list (the long `export default function DashboardClient({ ... }: Props) {` line) — add `startSupportConversation` to that destructuring list, right after `verifyPhoneOtp`.

Add a new handler near the other handlers in the component body (e.g. right after `handleTabPendingCountChange`-style helpers, or immediately before the `return (` — anywhere in the component function body is fine):

```tsx
  async function handleContactSupport() {
    const res = await startSupportConversation()
    if (res.ok && res.conversationId) {
      setActiveTab('messages')
      setSelectedConversationId(res.conversationId)
      router.refresh()
    }
  }
```

(`router` is already in scope in this file — it's used at `onPhoneVerified={() => router.refresh()}` in the existing `<ProfileCard>` call.)

The existing `<ProfileCard>` call reads:

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

Add a prop:

```tsx
          <ProfileCard
            profile={profile}
            updateAction={updateAction}
            success={success}
            error={error}
            sendPhoneOtp={sendPhoneOtp}
            verifyPhoneOtp={verifyPhoneOtp}
            onPhoneVerified={() => router.refresh()}
            onContactSupport={handleContactSupport}
          />
```

- [ ] **Step 3: Add the Support section to `ProfileCard.tsx`**

In `app/profile/ProfileCard.tsx`, the `Props` type gains a field. The type block currently ends with:

```ts
  onPhoneVerified: () => void
}
```

Replace with:

```ts
  onPhoneVerified: () => void
  onContactSupport: () => Promise<void>
}
```

The component signature reads:

```tsx
export default function ProfileCard({ profile, updateAction, success, error, sendPhoneOtp, verifyPhoneOtp, onPhoneVerified }: Props) {
  const [editing, setEditing] = useState(false)
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const phoneVerified = !!profile?.phone_verified
  const hasAddressInfo = !!(profile?.city || profile?.state || profile?.address || profile?.zip)
```

Replace with:

```tsx
export default function ProfileCard({ profile, updateAction, success, error, sendPhoneOtp, verifyPhoneOtp, onPhoneVerified, onContactSupport }: Props) {
  const [editing, setEditing] = useState(false)
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [contactingSupport, setContactingSupport] = useState(false)
  const phoneVerified = !!profile?.phone_verified
  const hasAddressInfo = !!(profile?.city || profile?.state || profile?.address || profile?.zip)

  async function handleContactSupportClick() {
    setContactingSupport(true)
    await onContactSupport()
    setContactingSupport(false)
  }
```

The non-editing view's closing section reads:

```tsx
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

Replace with (adds a new "🛟 Support" section that shows in both edit and view mode — placed outside the `editing ? (...) : (...)` branches entirely, right before the component's final closing tags):

```tsx
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

      <div style={{ borderTop: '2px dashed #fed7aa', paddingTop: 16, marginTop: 20 }}>
        <p style={sectionHeaderStyle}>🛟 Support</p>
        <div className="flex items-center gap-4 flex-wrap">
          <button
            type="button"
            onClick={handleContactSupportClick}
            disabled={contactingSupport}
            className="text-white font-extrabold text-[14px] shadow-[0_3px_0_#c2410c] disabled:opacity-60"
            style={{ background: '#f97316', padding: '10px 22px', borderRadius: 12, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {contactingSupport ? 'Opening…' : '💬 Message Support'}
          </button>
          <a href="mailto:support@littlebookexchange.com" className="font-bold text-[13px]" style={{ color: '#888' }}>
            Prefer email? support@littlebookexchange.com
          </a>
        </div>
      </div>
    </div>
  )
}
```

Note: this moves the closing `</div>` of the outer card down — the section above is now a sibling of the `editing ? (...) : (...)` block, both inside the same outer card `<div>`, not nested inside the view-mode branch. Double-check indentation/JSX balance after editing (the outer card `<div id="profile" ...>` still needs exactly one matching closing `</div>` at the very end).

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new type errors from `app/profile/page.tsx`, `app/profile/DashboardClient.tsx`, or `app/profile/ProfileCard.tsx`.

- [ ] **Step 5: Commit**

```bash
git add app/profile/page.tsx app/profile/DashboardClient.tsx app/profile/ProfileCard.tsx
git commit -m "feat: add Contact Support section to Profile — opens support conversation in Messages tab"
```

---

## Task 8: `EmailComposeTab.tsx` — Email/Message mode toggle

**Files:**
- Modify: `app/admin/EmailComposeTab.tsx`

**Interfaces:**
- Consumes: `sendBroadcastMessage`, `resolveBroadcastRecipients(target, channel)` from Task 3.
- Produces: `EmailComposeTab` gains `prefillUserId?: string | null` and `onPrefillConsumed?: () => void` props (consumed by Task 10's dispute-to-message navigation).

No automated test — this file has none today. Verified manually in Task 11.

- [ ] **Step 1: Replace the file**

Replace `app/admin/EmailComposeTab.tsx` entirely with:

```tsx
// app/admin/EmailComposeTab.tsx
'use client'
import { useState, useEffect, useMemo } from 'react'
import { resolveBroadcastRecipients, sendBroadcastEmail, sendBroadcastMessage, type BroadcastTarget } from '@/lib/actions/emailAdmin'

type ComposeUser = { id: string; username: string; email: string; city: string; state: string }
type Mode = 'email' | 'message'

export default function EmailComposeTab({
  users, prefillUserId, onPrefillConsumed,
}: {
  users: ComposeUser[]
  prefillUserId?: string | null
  onPrefillConsumed?: () => void
}) {
  const [mode, setMode] = useState<Mode>('email')
  const [targetKind, setTargetKind] = useState<'all' | 'user' | 'filtered'>('all')
  const [userSearch, setUserSearch] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [messageRepliable, setMessageRepliable] = useState(false)
  const [recipientCount, setRecipientCount] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cities = useMemo(() => [...new Set(users.map(u => u.city).filter(Boolean))].sort(), [users])
  const states = useMemo(() => [...new Set(users.map(u => u.state).filter(Boolean))].sort(), [users])
  const matchingUsers = useMemo(
    () => users.filter(u => u.username.toLowerCase().includes(userSearch.toLowerCase()) || u.email.toLowerCase().includes(userSearch.toLowerCase())).slice(0, 8),
    [users, userSearch]
  )

  useEffect(() => {
    if (!prefillUserId) return
    const match = users.find(u => u.id === prefillUserId)
    setMode('message')
    setTargetKind('user')
    setSelectedUserId(prefillUserId)
    setUserSearch(match ? `${match.username} (${match.email})` : '')
    setMessageRepliable(true)
    onPrefillConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillUserId])

  function currentTarget(): BroadcastTarget | null {
    if (targetKind === 'all') return { kind: 'all' }
    if (targetKind === 'user') return selectedUserId ? { kind: 'user', userId: selectedUserId } : null
    if (targetKind === 'filtered') return { kind: 'filtered', city: city || undefined, state: state || undefined }
    return null
  }

  async function startConfirm() {
    setError(null)
    setResult(null)
    const target = currentTarget()
    if (!target) { setError('Pick a recipient.'); return }
    if (mode === 'email' && !subject.trim()) { setError('Subject is required.'); return }
    if (!body.trim()) { setError(mode === 'email' ? 'Subject and body are required.' : 'Message cannot be empty.'); return }

    const res = await resolveBroadcastRecipients(target, mode === 'message' ? 'message' : 'email')
    if (!res.ok) { setError(res.error ?? 'Failed to look up recipients.'); return }
    setRecipientCount(res.count ?? 0)
    setConfirming(true)
  }

  async function confirmSend() {
    const target = currentTarget()
    if (!target) return
    setSending(true)
    setError(null)
    const res = mode === 'message'
      ? await sendBroadcastMessage(target, body, messageRepliable)
      : await sendBroadcastEmail(target, subject, body)
    setSending(false)
    setConfirming(false)
    if (res.ok) {
      setResult({ sent: res.sent, failed: res.failed })
      setSubject('')
      setBody('')
    } else {
      // Deliberately does NOT clear subject/body — on a failure the admin keeps
      // the draft they typed and can retry.
      setError(res.error ?? 'Failed to send.')
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="font-display text-[22px] text-[#1e293b]">Compose</h2>

      <div className="bg-white rounded-2xl p-5 border border-[#f1f5f9] shadow-sm space-y-4">
        <div className="flex gap-2">
          {(['email', 'message'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-full font-extrabold text-[12px] border-2 transition-colors ${mode === m ? 'bg-[#0ea5e9] border-[#0ea5e9] text-white' : 'bg-white border-[#e2e8f0] text-[#64748b]'}`}>
              {m === 'email' ? '✉️ Email' : '💬 Message'}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          {(['all', 'user', 'filtered'] as const).map(k => (
            <button key={k} onClick={() => setTargetKind(k)}
              className={`px-3 py-1.5 rounded-full font-extrabold text-[12px] border-2 transition-colors ${targetKind === k ? 'bg-bk-orange border-bk-orange text-white' : 'bg-white border-[#e2e8f0] text-[#64748b]'}`}>
              {k === 'all' ? 'All Users' : k === 'user' ? 'One User' : 'Filtered Group'}
            </button>
          ))}
        </div>

        {targetKind === 'user' && (
          <div>
            <input
              value={userSearch} onChange={e => { setUserSearch(e.target.value); setSelectedUserId(null) }}
              placeholder="Search by username or email…"
              className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2 font-bold text-[13px] focus:outline-none focus:border-bk-orange"
            />
            {userSearch && !selectedUserId && (
              <div className="mt-2 border border-[#f1f5f9] rounded-xl overflow-hidden">
                {matchingUsers.map(u => (
                  <button key={u.id} onClick={() => { setSelectedUserId(u.id); setUserSearch(`${u.username} (${u.email})`) }}
                    className="w-full text-left px-3 py-2 text-[13px] font-semibold hover:bg-[#f8fafc] border-b border-[#f8fafc] last:border-0">
                    {u.username} <span className="text-[#94a3b8]">— {u.email}</span>
                  </button>
                ))}
                {matchingUsers.length === 0 && <div className="px-3 py-2 text-[12px] text-[#94a3b8] font-semibold">No matches</div>}
              </div>
            )}
          </div>
        )}

        {targetKind === 'filtered' && (
          <div className="grid grid-cols-2 gap-3">
            <select value={city} onChange={e => setCity(e.target.value)} className="border-2 border-[#e2e8f0] rounded-xl px-3 py-2 font-bold text-[13px] bg-white">
              <option value="">Any city</option>
              {cities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={state} onChange={e => setState(e.target.value)} className="border-2 border-[#e2e8f0] rounded-xl px-3 py-2 font-bold text-[13px] bg-white">
              <option value="">Any state</option>
              {states.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}

        {mode === 'email' && (
          <div>
            <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)}
              className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
          </div>
        )}
        <div>
          <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Body</label>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={6}
            className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-semibold text-[13px] focus:outline-none focus:border-bk-orange resize-y" />
        </div>

        {mode === 'message' && (
          <label className="flex items-center gap-2 font-bold text-[13px] text-[#475569]">
            <input type="checkbox" checked={messageRepliable} onChange={e => setMessageRepliable(e.target.checked)} />
            Allow replies (start a conversation)
          </label>
        )}

        {error && <div className="bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-red-700 font-bold text-sm">{error}</div>}
        {result && (
          <div className="bg-teal-50 border-2 border-teal-200 rounded-xl px-4 py-3 text-teal-700 font-bold text-sm">
            {mode === 'message' ? 'Messaged' : 'Sent to'} {result.sent}{result.failed > 0 ? `, failed for ${result.failed}` : ''}.
          </div>
        )}

        <button onClick={startConfirm}
          className="bg-bk-orange text-white rounded-xl px-4 py-2.5 font-extrabold text-[13px] shadow-[0_3px_0_#c2410c]">
          Send…
        </button>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-3xl w-full max-w-[420px] p-6 shadow-2xl">
            <h2 className="font-display text-[18px] text-[#1e293b] mb-3">Confirm Send</h2>
            <p className="font-semibold text-[14px] text-[#334155] mb-5">
              This will {mode === 'message' ? 'message' : 'email'} <span className="font-black text-bk-orange">{recipientCount}</span> {recipientCount === 1 ? 'person' : 'people'}.
              {mode === 'message' && messageRepliable && recipientCount !== 1 ? ` ${recipientCount} separate conversations will be started.` : ''} Send?
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirming(false)} className="flex-1 border-2 border-[#e2e8f0] rounded-xl py-2.5 font-extrabold text-[14px] text-[#64748b]">Cancel</button>
              <button onClick={confirmSend} disabled={sending} className="flex-1 bg-bk-orange text-white rounded-xl py-2.5 font-extrabold text-[14px] shadow-[0_3px_0_#c2410c] disabled:opacity-60">
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new type errors from `app/admin/EmailComposeTab.tsx`.

- [ ] **Step 3: Commit**

```bash
git add app/admin/EmailComposeTab.tsx
git commit -m "feat: add Email/Message mode toggle, repliable checkbox, and prefill support to Compose"
```

---

## Task 9: `AdminInboxTab.tsx` (new) + wire into `EmailsAdminTab.tsx`

**Files:**
- Create: `app/admin/AdminInboxTab.tsx`
- Modify: `app/admin/EmailsAdminTab.tsx`

**Interfaces:**
- Consumes: nothing new (queries `conversations`/`messages`/`profiles` directly via the browser Supabase client, same pattern as `DisputesAdminTab.tsx`).
- Produces: `AdminInboxTab` (no props — fetches its own admin user id via `supabase.auth.getUser()`); `EmailsAdminTab` gains `messagePrefillUserId?: string | null` and `onPrefillConsumed?: () => void` props, threaded to `EmailComposeTab` (Task 8) and used to force `subTab` back to `'compose'`.

No automated test — matches `DisputesAdminTab.tsx`'s existing precedent (no test file). Verified manually in Task 11.

- [ ] **Step 1: Create `AdminInboxTab.tsx`**

```tsx
// app/admin/AdminInboxTab.tsx
'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type InboxMessage = { id: string; body: string; sender_id: string; created_at: string }
type InboxConversation = {
  id: string
  user_id: string
  repliable: boolean
  created_at: string
  userName: string
  messages: InboxMessage[]
}

export default function AdminInboxTab() {
  const [adminId, setAdminId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<InboxConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  async function load() {
    setLoading(true)
    const supabase = createClient()

    const { data: { user } } = await supabase.auth.getUser()
    setAdminId(user?.id ?? null)

    const { data: convos } = await supabase
      .from('conversations').select('id, user_id, repliable, created_at')
      .eq('type', 'admin')
      .order('created_at', { ascending: false })

    if (!convos || convos.length === 0) {
      setConversations([])
      setLoading(false)
      return
    }

    const userIds = [...new Set(convos.map(c => c.user_id))]
    const { data: profiles } = await supabase.from('profiles').select('id, username').in('id', userIds)
    const nameMap: Record<string, string> = {}
    for (const p of profiles ?? []) nameMap[p.id] = p.username || 'Unknown'

    const { data: messages } = await supabase
      .from('messages').select('id, conversation_id, body, sender_id, created_at')
      .in('conversation_id', convos.map(c => c.id))
      .order('created_at', { ascending: true })
    const messagesByConvo: Record<string, InboxMessage[]> = {}
    for (const m of messages ?? []) (messagesByConvo[m.conversation_id] ??= []).push(m)

    const withMessages = convos.map(c => ({
      ...c,
      userName: nameMap[c.user_id] ?? 'Unknown',
      messages: messagesByConvo[c.id] ?? [],
    }))
    withMessages.sort((a, b) => {
      const aLast = a.messages[a.messages.length - 1]?.created_at ?? a.created_at
      const bLast = b.messages[b.messages.length - 1]?.created_at ?? b.created_at
      return new Date(bLast).getTime() - new Date(aLast).getTime()
    })
    setConversations(withMessages)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const selected = conversations.find(c => c.id === selectedId) ?? null

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || !selected || !adminId) return
    setSending(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('messages')
      .insert({ conversation_id: selected.id, sender_id: adminId, body: body.trim(), kind: 'chat' })
      .select()
      .single()
    setSending(false)
    if (!error && data) {
      setBody('')
      setConversations(prev => prev.map(c => c.id === selected.id ? { ...c, messages: [...c.messages, data as InboxMessage] } : c))
    }
  }

  if (loading) return <p className="font-bold text-[13px]" style={{ color: '#aaa' }}>Loading inbox...</p>

  return (
    <div className="flex gap-5" style={{ height: 520 }}>
      <div className="w-[240px] shrink-0 bg-white rounded-2xl border border-[#f1f5f9] overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="p-4 font-bold text-[13px]" style={{ color: '#aaa' }}>No conversations yet.</p>
        ) : (
          conversations.map(c => {
            const last = c.messages[c.messages.length - 1]
            return (
              <button key={c.id} onClick={() => setSelectedId(c.id)}
                className={`w-full text-left px-4 py-3 border-b border-[#f8fafc] ${selectedId === c.id ? 'bg-orange-50' : 'hover:bg-[#f8fafc]'}`}>
                <p className="font-extrabold text-[13px] text-[#1e293b]">{c.userName}</p>
                <p className="text-[11px] font-bold text-[#94a3b8]">{c.repliable ? 'Conversation' : 'Announcement'}</p>
                {last && <p className="text-[12px] font-semibold text-[#94a3b8] truncate mt-0.5">{last.body}</p>}
              </button>
            )
          })
        )}
      </div>

      <div className="flex-1 bg-white rounded-2xl border border-[#f1f5f9] flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center font-bold text-[13px]" style={{ color: '#ccc' }}>
            Select a conversation
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-[#f1f5f9]">
              <p className="font-extrabold text-[14px] text-[#1e293b]">{selected.userName}</p>
              <p className="text-[11px] font-bold text-[#94a3b8]">{selected.repliable ? 'Repliable conversation' : 'One-shot announcement'}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
              {selected.messages.length === 0 && (
                <p className="font-semibold text-[13px]" style={{ color: '#ccc' }}>No messages yet.</p>
              )}
              {selected.messages.map(m => (
                <div key={m.id} className={`max-w-[70%] px-3 py-2 rounded-xl text-[13px] font-semibold ${m.sender_id === adminId ? 'ml-auto bg-bk-orange text-white' : 'bg-[#f1f5f9] text-[#1e293b]'}`}>
                  {m.body}
                </div>
              ))}
            </div>
            <form onSubmit={send} className="px-4 py-3 border-t border-[#f1f5f9] flex gap-2">
              <input value={body} onChange={e => setBody(e.target.value)} placeholder="Reply…"
                className="flex-1 border-2 border-[#e2e8f0] rounded-xl px-3 py-2 font-semibold text-[13px] focus:outline-none focus:border-bk-orange" />
              <button type="submit" disabled={!body.trim() || sending}
                className="bg-bk-orange text-white rounded-xl px-4 py-2 font-extrabold text-[13px] disabled:opacity-50">
                Send
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire the Inbox sub-tab and prefill props into `EmailsAdminTab.tsx`**

Replace `app/admin/EmailsAdminTab.tsx` entirely with:

```tsx
// app/admin/EmailsAdminTab.tsx
'use client'
import { useEffect, useState } from 'react'
import EmailTemplatesEditor from './EmailTemplatesEditor'
import EmailComposeTab from './EmailComposeTab'
import EmailResendTool from './EmailResendTool'
import AdminInboxTab from './AdminInboxTab'

type EmailUser = { id: string; username: string; email: string; city: string; state: string }
type SubTab = 'templates' | 'compose' | 'resend' | 'inbox'

export default function EmailsAdminTab({
  users, messagePrefillUserId, onPrefillConsumed,
}: {
  users: EmailUser[]
  messagePrefillUserId?: string | null
  onPrefillConsumed?: () => void
}) {
  const [subTab, setSubTab] = useState<SubTab>('compose')

  useEffect(() => {
    if (messagePrefillUserId) setSubTab('compose')
  }, [messagePrefillUserId])

  const SUB_TABS: { id: SubTab; label: string }[] = [
    { id: 'compose', label: 'Compose' },
    { id: 'templates', label: 'Templates' },
    { id: 'resend', label: 'Resend' },
    { id: 'inbox', label: 'Inbox' },
  ]

  return (
    <div>
      <div className="flex gap-2 mb-5">
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            className={`px-3 py-1.5 rounded-full font-extrabold text-[12px] border-2 transition-colors ${subTab === t.id ? 'bg-bk-orange border-bk-orange text-white' : 'bg-white border-[#e2e8f0] text-[#64748b]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'compose' && <EmailComposeTab users={users} prefillUserId={messagePrefillUserId} onPrefillConsumed={onPrefillConsumed} />}
      {subTab === 'templates' && <EmailTemplatesEditor />}
      {subTab === 'resend' && <EmailResendTool users={users} />}
      {subTab === 'inbox' && <AdminInboxTab />}
    </div>
  )
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 4: Commit**

```bash
git add app/admin/AdminInboxTab.tsx app/admin/EmailsAdminTab.tsx
git commit -m "feat: add admin Inbox sub-tab for viewing/replying to admin conversations"
```

---

## Task 10: Dispute-to-Message navigation (`AdminClient.tsx` + `DisputesAdminTab.tsx`)

**Files:**
- Modify: `app/admin/AdminClient.tsx`
- Modify: `app/admin/DisputesAdminTab.tsx`

**Interfaces:**
- Consumes: `EmailsAdminTab`'s `messagePrefillUserId`/`onPrefillConsumed` props (Task 9).
- Produces: `AdminClient` owns `messagePrefillUserId: string | null` state and `handleMessageReporter(userId: string): void`; `DisputesAdminTab` gains an `onMessageReporter: (userId: string) => void` prop and a "💬 Message" button that calls it.

Both files change together in this one task specifically so the project never sits at a broken compile state between them — `AdminClient` wiring up a prop `DisputesAdminTab` doesn't accept yet (or vice versa) isn't an independently testable deliverable.

No automated test — neither file has one today. Verified manually in Task 11.

- [ ] **Step 1: Rename the tab label**

The `TABS` array reads:

```tsx
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id:'dashboard', label:'Dashboard',  icon:'📊' },
  { id:'users',     label:'Users',      icon:'👥' },
  { id:'locations', label:'Locations',  icon:'📍' },
  { id:'reviews',   label:'Reviews',    icon:'⭐' },
  { id:'emails',    label:'Emails',     icon:'✉️' },
  { id:'disputes',  label:'Disputes',   icon:'🚩' },
]
```

Replace the `emails` row's label:

```tsx
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id:'dashboard', label:'Dashboard',       icon:'📊' },
  { id:'users',     label:'Users',           icon:'👥' },
  { id:'locations', label:'Locations',       icon:'📍' },
  { id:'reviews',   label:'Reviews',         icon:'⭐' },
  { id:'emails',    label:'Email / Message', icon:'✉️' },
  { id:'disputes',  label:'Disputes',        icon:'🚩' },
]
```

(The `Tab` id stays `'emails'` — only the displayed label changes, no other code references the label string.)

- [ ] **Step 2: Add prefill state and handler**

In `export default function AdminClient() {`, near the other `useState` declarations (e.g. right after `const [mobileMenuOpen, setMobileMenuOpen] = useState(false)`), add:

```tsx
  const [messagePrefillUserId, setMessagePrefillUserId] = useState<string | null>(null)
```

Near `handleTabPendingCountChange` (or anywhere else in the component body before `return (`), add:

```tsx
  function handleMessageReporter(userId: string) {
    setMessagePrefillUserId(userId)
    setTab('emails')
  }
```

- [ ] **Step 3: Pass the new props to `DisputesAdminTab` and `EmailsAdminTab`**

The tab-content section reads:

```tsx
          {tab === 'dashboard' && <Dashboard users={users} pendingLocationReports={pendingLocationReports} reviews={reviews} />}
          {tab === 'users'     && (
            <UsersTab
```

and further down:

```tsx
          {tab === 'locations' && <LocationsAdminTab onPendingCountChange={handleTabPendingCountChange} />}
          {tab === 'reviews'   && <ReviewsTab reviews={reviews} setReviews={setReviews} />}
          {tab === 'emails'    && <EmailsAdminTab users={users} />}
          {tab === 'disputes'  && <DisputesAdminTab />}
```

Replace the last two lines:

```tsx
          {tab === 'locations' && <LocationsAdminTab onPendingCountChange={handleTabPendingCountChange} />}
          {tab === 'reviews'   && <ReviewsTab reviews={reviews} setReviews={setReviews} />}
          {tab === 'emails'    && (
            <EmailsAdminTab
              users={users}
              messagePrefillUserId={messagePrefillUserId}
              onPrefillConsumed={() => setMessagePrefillUserId(null)}
            />
          )}
          {tab === 'disputes'  && <DisputesAdminTab onMessageReporter={handleMessageReporter} />}
```

- [ ] **Step 4: Add the prop and button to `DisputesAdminTab.tsx`**

The component signature reads:

```tsx
export default function DisputesAdminTab() {
```

Replace with:

```tsx
export default function DisputesAdminTab({ onMessageReporter }: { onMessageReporter: (userId: string) => void }) {
```

The per-dispute card's action button reads:

```tsx
          <button
            type="button"
            disabled={resolvingId === d.id}
            onClick={() => handleResolve(d.id)}
            className="font-extrabold text-[12px] text-white mt-3"
            style={{ background: '#059669', padding: '7px 18px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            {resolvingId === d.id ? 'Resolving...' : '✓ Resolve'}
          </button>
```

Replace with (wraps both buttons in a flex row):

```tsx
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              disabled={resolvingId === d.id}
              onClick={() => handleResolve(d.id)}
              className="font-extrabold text-[12px] text-white"
              style={{ background: '#059669', padding: '7px 18px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              {resolvingId === d.id ? 'Resolving...' : '✓ Resolve'}
            </button>
            <button
              type="button"
              onClick={() => onMessageReporter(d.reporter_id)}
              className="font-extrabold text-[12px] text-white"
              style={{ background: '#0ea5e9', padding: '7px 18px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              💬 Message
            </button>
          </div>
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no type errors anywhere in the project.

- [ ] **Step 6: Commit**

```bash
git add app/admin/AdminClient.tsx app/admin/DisputesAdminTab.tsx
git commit -m "feat: rename Emails tab to Email / Message, add dispute-to-message navigation"
```

---

## Task 11: Manual end-to-end verification

**Files:** none (verification only).

**Interfaces:** none — this task exercises everything Tasks 1-11 built together.

- [ ] **Step 1: Run the full automated test suite**

Run: `npm run test:run -- --exclude ".claude/**"`
Expected: PASS, including the new `broadcastRecipients.test.ts` and `MessagesTab.test.tsx` cases from Tasks 2 and 4. (The `--exclude` flag routes around the known stray-worktree test-pollution issue documented in this project's memory — confirm no `.claude/worktrees/*` directory is lying around first, or the flag alone may not be enough.)

- [ ] **Step 2: One-shot broadcast**

Using two real (or demo) test accounts, sign in as an admin. Go to Email/Message → Compose → Message mode → All Users → leave "Allow replies" unchecked → write a short announcement → Send. Sign in as a non-admin test user and confirm: the message appears in their Messages tab as a thread from "📣 Little Book Exchange Team", no listing line, and the input area shows "🔒 Announcement — replies aren't enabled" instead of a text box.

- [ ] **Step 3: Repliable single-user message**

As admin: Compose → Message mode → One User → pick the same test user → check "Allow replies" → send a different message. As that user: confirm a *second*, separate thread appears (repliable one, not merged into the announcement thread from Step 2) with a working input box; type a reply and send it.

- [ ] **Step 4: Admin Inbox sees the reply**

As admin: Email/Message → Inbox. Confirm both conversations with that test user appear (labeled "Announcement" and "Conversation" respectively), the repliable one shows the user's reply, and sending a further reply from the Inbox appears correctly.

- [ ] **Step 5: Contact Support**

As the non-admin test user: go to Profile → Support section → click "Message Support". Confirm it switches to the Messages tab and opens a new thread from "📣 Little Book Exchange Team" with an empty, working input box. Send a message. As admin: confirm it shows up in the Inbox as a new conversation (separate from the two dispute-unrelated ones above), and reply from there; confirm the reply reaches the user's Messages tab.

- [ ] **Step 6: Dispute → Message button**

File a dispute as a test user on a real (or throwaway) exchange (existing dual-pickup-confirmation flow). As admin: go to Disputes, click "💬 Message" on that dispute. Confirm it navigates to Email/Message → Compose with Message mode selected, One User targeting, that reporter pre-filled in the search box, and "Allow replies" pre-checked. Send it; confirm the message reaches that user's Messages tab as a repliable conversation.

- [ ] **Step 7: Confirm exchange-type conversations are unaffected**

As a test user, open an existing (or new) book-exchange conversation in the Messages tab unrelated to any of the above. Confirm it still renders with the real buyer/seller name, the listing line/View link, the seller rating badge (if applicable), and a working reply box — exactly as before this feature.
