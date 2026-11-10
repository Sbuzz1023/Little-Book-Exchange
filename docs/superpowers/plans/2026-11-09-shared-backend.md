# Shared Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every member-facing rule of Little Book Exchange into Supabase (database functions + row-level security) so the website and the future iPhone app share one protected backend, closing the exchange-status credit hole and the public profile-data leak.

**Architecture:** New `security definer` Postgres functions own every multi-step or cross-user change (listings, the exchange lifecycle, disputes, support); private profile columns become readable only through `get_my_profile()` / `admin_list_users()`. The website's server actions become thin wrappers that call these functions. Two Vercel endpoints handle secret-key jobs (username sign-in, dispute email). Direct table writes are revoked last ("lockdown"), once nothing uses them.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres + RLS, `@supabase/ssr`, `@supabase/supabase-js`), Vitest, PGlite (`@electric-sql/pglite`, new dev dependency) for database tests.

**Spec:** `docs/superpowers/specs/2026-11-09-shared-backend-design.md`

## Global Constraints

- Project root: `C:\Users\seanb\Desktop\Little Book Exchange` (git, branch `master`; do the work on a feature branch `shared-backend`).
- All SQL is **appended** to `supabase/schema.sql` as labelled blocks, in the house style: a header line `-- ── Migration: shared backend N/6 — <name> ──…`, a line `-- Run this block in Supabase SQL Editor:`, the SQL, and a closing `-- ────…` line. Never edit earlier blocks.
- Every new function: `language plpgsql` (or `sql`) `security definer set search_path = public, pg_temp`, followed by `grant execute on function <name>(<arg types>) to authenticated;`. Authorization is checked **inside** the function via `auth.uid()`; TypeScript checks are UX only.
- Functions never raise for expected outcomes. They return a `text` status (`'ok'`, `'not_allowed'`, `'wrong_status'`, …) or, when they create something, `jsonb` `{"status": "...", "id": "<uuid>"}`. Unauthorized callers get `'not_allowed'` whatever the reason.
- New SQL must be safe to re-run: `create or replace function`, `drop policy if exists` before `create policy`, `add column if not exists`.
- Demo mode (`NEXT_PUBLIC_SUPABASE_URL` not starting with `http`, or the `lbe_demo_user` cookie) must keep working exactly as today — leave every demo branch in place.
- Admin pages, `unsubscribe`, the `resolve-pickups` cron and Open Library search keep working; admin features stay website-only.
- Phone numbers are never put in any message or response sent to another user.
- Database tests run with `// @vitest-environment node` as the first line of the file; they never touch the real Supabase project.
- Commit after every task with a message ending in:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **Double taps / retries** — pressing Request or "Picked up" twice must not create two requests, two messages or move credits twice → tests in Task 6 (second `request_book` → `not_available`) and Task 10 (second `mark_picked_up` → `already_marked`, credits moved once).
2. **Two buyers racing for one listing** — only the first request wins; the second gets `not_available` and the listing stays locked to the first buyer → test in Task 6.
3. **Credits held by a confirmed (not yet picked up) exchange** — a buyer must not be able to spend them again → tests in Task 6 (SQL) and Task 6 (`lib/creditCheck.ts`).
4. **Website code that still writes directly to locked tables** — would silently break after lockdown → source-scan test in Task 13.
5. **Private profile columns leaking through joins/embeds** (e.g. `listings` joined to `profiles.email`) or to signed-out visitors → tests in Task 13.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/schema.sql` | Six new appended SQL blocks (Tasks 2, 4, 6, 8, 10, 13) |
| `supabase/tests/harness.ts` (new) | PGlite test database: Supabase stubs, schema load, seed helpers, act-as-user helpers |
| `supabase/tests/*.test.ts` (new) | Database tests per block |
| `lib/listingPayload.ts` (new) | FormData → `create_listing`/`update_listing` payload; result code → user message |
| `app/listings/[id]/actions.ts` (new) | `startConversationAction`, `requestBookAction` (moved out of the page so they can be tested) |
| `lib/disputes/notifyAdmins.ts` (new) | Server-only: email admins about a dispute once |
| `lib/supabase/fromBearer.ts` (new) | Server-only: Supabase client + user from an `Authorization: Bearer` header |
| `lib/auth/usernameLookup.ts` (new) | Server-only: username → email via service role |
| `app/api/disputes/notify/route.ts` (new) | POST endpoint for the app to trigger the dispute email |
| `app/api/auth/username-signin/route.ts` (new) | POST endpoint: username + password → session |
| Modified | `app/post/actions.ts`, `app/profile/actions.ts`, `app/profile/page.tsx`, `app/layout.tsx`, `app/listings/[id]/page.tsx`, `app/auth/signin/page.tsx`, `lib/unseenCredits.ts`, `lib/creditCheck.ts`, `lib/actions/creditsSeen.ts`, `lib/actions/emailAdmin.ts`, `lib/actions/savedListings.ts`, `app/admin/AdminClient.tsx`, `app/admin/LocationsAdminTab.tsx`, matching tests |
| Deleted | `lib/buildConfirmationMessage.ts` + its test (message now built in SQL) |

---

### Task 1: PGlite database test harness

**Files:**
- Modify: `package.json` (dev dependency)
- Create: `supabase/tests/harness.ts`
- Test: `supabase/tests/harness.test.ts`

**Interfaces:**
- Produces:
  - `createTestDb(): Promise<PGlite>` — fresh in-memory database with Supabase stubs + full `supabase/schema.sql` loaded.
  - `createUser(db, opts?: { username?: string; city?: string; state?: string; credits?: number; isAdmin?: boolean; email?: string }): Promise<string>` — returns the new user id (profile auto-created by the real `handle_new_user` trigger).
  - `seedListing(db, sellerId: string, opts?: { status?: string; title?: string; author?: string; bundleBooks?: number }): Promise<string>` — inserts as superuser (bypasses RLS); `bundleBooks` adds that many `listing_books` rows so `book_count = 1 + bundleBooks`.
  - `seedConversation(db, opts: { listingId: string; buyerId: string; sellerId: string; status?: string }): Promise<string>`
  - `asUser<T>(db, userId: string | null, sql: string, params?: unknown[]): Promise<T[]>` — runs one statement as `authenticated` with `auth.uid() = userId` (or as `anon` when `userId` is null) inside a transaction; throws the Postgres error on failure.
  - `call<T = unknown>(db, userId: string | null, fnCall: string, params?: unknown[]): Promise<T>` — `asUser(db, userId, 'select <fnCall> as result', params)` and returns `rows[0].result`.
  - `credits(db, userId: string): Promise<number>`

- [ ] **Step 1: Install PGlite**

Run: `npm install --save-dev @electric-sql/pglite`
Expected: `package.json` gains `"@electric-sql/pglite"` under `devDependencies`.

- [ ] **Step 2: Write the failing test**

Create `supabase/tests/harness.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, createUser, seedListing, seedConversation, asUser, credits } from './harness'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)

describe('test database harness', () => {
  it('loads the real schema and auto-creates a profile for a new user', async () => {
    const id = await createUser(db, { username: 'sally', credits: 3 })
    const rows = (await db.query<{ username: string }>('select username from profiles where id = $1', [id])).rows
    expect(rows[0].username).toBe('sally')
    expect(await credits(db, id)).toBe(3)
  })

  it('enforces row-level security for a signed-in user', async () => {
    const seller = await createUser(db)
    const buyer = await createUser(db)
    const stranger = await createUser(db)
    const listing = await seedListing(db, seller)
    await seedConversation(db, { listingId: listing, buyerId: buyer, sellerId: seller, status: 'requested' })
    expect(await asUser(db, buyer, 'select id from conversations where listing_id = $1', [listing])).toHaveLength(1)
    expect(await asUser(db, stranger, 'select id from conversations where listing_id = $1', [listing])).toHaveLength(0)
  })

  it('counts bundle books into book_count', async () => {
    const seller = await createUser(db)
    const listing = await seedListing(db, seller, { bundleBooks: 2 })
    const rows = (await db.query<{ book_count: number }>('select book_count from listings where id = $1', [listing])).rows
    expect(rows[0].book_count).toBe(3)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run supabase/tests/harness.test.ts`
Expected: FAIL — `Cannot find module './harness'`.

- [ ] **Step 4: Write the harness**

Create `supabase/tests/harness.ts`:

```ts
// Database tests run the real supabase/schema.sql inside PGlite (Postgres
// compiled to WebAssembly, in-process). Nothing here touches the real
// Supabase project. The stubs below stand in for the pieces Supabase
// provides: the auth/storage schemas, auth.uid()/auth.role(), the
// anon/authenticated roles and Supabase's default grants.
import { PGlite } from '@electric-sql/pglite'
import { citext } from '@electric-sql/pglite/contrib/citext'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
create schema auth;
create schema storage;
create publication supabase_realtime;

create table auth.users (
  id uuid primary key,
  email text,
  phone text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  email_confirmed_at timestamptz,
  phone_confirmed_at timestamptz,
  created_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;

create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (
  id uuid default gen_random_uuid() primary key,
  bucket_id text, name text, owner uuid
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;

grant usage on schema public, auth, storage to anon, authenticated;
grant all on storage.objects, storage.buckets to anon, authenticated;
-- Supabase grants these on everything created in public; default privileges
-- (not a grant after loading) so a later REVOKE in schema.sql sticks.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { citext } })
  await db.exec(SUPABASE_STUBS)
  await db.exec(readFileSync(join(process.cwd(), 'supabase', 'schema.sql'), 'utf8'))
  return db
}

export async function createUser(
  db: PGlite,
  opts: { username?: string; city?: string; state?: string; credits?: number; isAdmin?: boolean; email?: string } = {},
): Promise<string> {
  const id = randomUUID()
  const username = opts.username ?? `user_${id.slice(0, 8)}`
  await db.query(
    'insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)',
    [id, opts.email ?? `${username}@example.com`, JSON.stringify({ username, city: opts.city ?? 'Springfield', state: opts.state ?? 'IL' })],
  )
  await db.transaction(async (tx) => {
    // prevent_credit_self_grant reverts direct credit writes unless this flag is set.
    await tx.query(`select set_config('app.bypass_credit_guard', 'true', true)`)
    await tx.query('update profiles set credits = $2, is_admin = $3 where id = $1', [id, opts.credits ?? 0, opts.isAdmin ?? false])
  })
  return id
}

export async function seedListing(
  db: PGlite,
  sellerId: string,
  opts: { status?: string; title?: string; author?: string; bundleBooks?: number } = {},
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into listings (user_id, title, author, condition, status, ol_work_key, is_bundle)
     values ($1, $2, $3, 'Good', $4, '/works/OL1W', $5) returning id`,
    [sellerId, opts.title ?? 'Dune', opts.author ?? 'Frank Herbert', opts.status ?? 'active', (opts.bundleBooks ?? 0) > 0],
  )
  const id = rows[0].id
  for (let i = 0; i < (opts.bundleBooks ?? 0); i++) {
    await db.query(
      `insert into listing_books (listing_id, title, author, ol_work_key, position) values ($1, $2, 'Author', '/works/OL9W', $3)`,
      [id, `Bundle book ${i + 1}`, i],
    )
  }
  return id
}

export async function seedConversation(
  db: PGlite,
  opts: { listingId: string; buyerId: string; sellerId: string; status?: string },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into conversations (listing_id, buyer_id, seller_id, exchange_status) values ($1, $2, $3, $4) returning id`,
    [opts.listingId, opts.buyerId, opts.sellerId, opts.status ?? 'none'],
  )
  return rows[0].id
}

export async function asUser<T = Record<string, unknown>>(
  db: PGlite,
  userId: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const role = userId ? 'authenticated' : 'anon'
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`)
    await tx.query(
      `select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)`,
      [userId ?? '', role],
    )
    const result = await tx.query<T>(sql, params)
    return result.rows
  })
}

export async function call<T = unknown>(db: PGlite, userId: string | null, fnCall: string, params: unknown[] = []): Promise<T> {
  const rows = await asUser<{ result: T }>(db, userId, `select ${fnCall} as result`, params)
  return rows[0].result
}

export async function credits(db: PGlite, userId: string): Promise<number> {
  const { rows } = await db.query<{ credits: number }>('select credits from profiles where id = $1', [userId])
  return rows[0].credits
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run supabase/tests/harness.test.ts`
Expected: PASS (3 tests). If the schema fails to load with `extension "X" is not available` or `"Y" does not exist`, add the missing stub to `SUPABASE_STUBS` (the spike that informed this plan needed exactly the stubs above).

- [ ] **Step 6: Run the whole suite to make sure nothing else broke**

Run: `npx vitest run`
Expected: all existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json supabase/tests/harness.ts supabase/tests/harness.test.ts
git commit -m "Add PGlite database test harness that loads the real schema"
```

---

### Task 2: Private profile functions (SQL block 1/6)

**Files:**
- Modify: `supabase/schema.sql` (append block)
- Test: `supabase/tests/profilePrivacy.test.ts`

**Interfaces:**
- Consumes: harness from Task 1.
- Produces (SQL):
  - `get_my_profile() returns setof profiles` — caller's own row only (empty for anon).
  - `mark_credits_seen(p_up_to timestamptz) returns void` — moves the caller's `credits_seen_at` forward only.
  - `admin_list_users(p_user_ids uuid[] default null) returns table (id uuid, username text, email text, city text, state text, zip text, created_at timestamptz, is_admin boolean, credits integer, marketing_opt_out boolean)` — empty unless the caller is an admin; `null` = all users, newest first.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/profilePrivacy.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, createUser, asUser } from './harness'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)

describe('get_my_profile', () => {
  it("returns only the caller's own full row, including private columns", async () => {
    const me = await createUser(db, { username: 'me_profile', credits: 4 })
    await createUser(db)
    const rows = await asUser<{ id: string; email: string; credits: number }>(db, me, 'select id, email, credits from get_my_profile()')
    expect(rows).toEqual([{ id: me, email: 'me_profile@example.com', credits: 4 }])
  })

  it('returns nothing when signed out', async () => {
    expect(await asUser(db, null, 'select id from get_my_profile()')).toEqual([])
  })
})

describe('mark_credits_seen', () => {
  it('moves credits_seen_at forward, never back', async () => {
    const me = await createUser(db)
    await asUser(db, me, `select mark_credits_seen('2030-01-01T00:00:00Z')`)
    await asUser(db, me, `select mark_credits_seen('2029-01-01T00:00:00Z')`)
    const { rows } = await db.query<{ seen: string }>(`select to_char(credits_seen_at at time zone 'UTC', 'YYYY') as seen from profiles where id = $1`, [me])
    expect(rows[0].seen).toBe('2030')
  })
})

describe('admin_list_users', () => {
  it('lists users with their emails for an admin', async () => {
    const admin = await createUser(db, { isAdmin: true })
    const target = await createUser(db, { username: 'target_user' })
    const rows = await asUser<{ id: string; email: string }>(db, admin, 'select id, email from admin_list_users($1)', [[target]])
    expect(rows).toEqual([{ id: target, email: 'target_user@example.com' }])
  })

  it('returns nothing for a non-admin', async () => {
    const member = await createUser(db)
    expect(await asUser(db, member, 'select id from admin_list_users()')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/tests/profilePrivacy.test.ts`
Expected: FAIL — `function get_my_profile() does not exist`.

- [ ] **Step 3: Append SQL block 1 to `supabase/schema.sql`**

```sql

-- ── Migration: shared backend 1/6 — private profile functions ────────────────
-- Run this block in Supabase SQL Editor:
-- Private profile columns (email, phone, address, credits, settings) are about
-- to be hidden from direct reads (block 6). These are the only ways to read
-- them afterwards: your own row, or — for admins — the Users list.
create or replace function get_my_profile()
returns setof profiles as $$
  select * from profiles where id = auth.uid();
$$ language sql stable security definer set search_path = public, pg_temp;
grant execute on function get_my_profile() to authenticated;

-- Replaces a direct update whose `credits_seen_at < upTo` filter would need
-- SELECT on a hidden column.
create or replace function mark_credits_seen(p_up_to timestamptz)
returns void as $$
  update profiles set credits_seen_at = p_up_to
  where id = auth.uid() and credits_seen_at < p_up_to;
$$ language sql security definer set search_path = public, pg_temp;
grant execute on function mark_credits_seen(timestamptz) to authenticated;

create or replace function admin_list_users(p_user_ids uuid[] default null)
returns table (
  id uuid, username text, email text, city text, state text, zip text,
  created_at timestamptz, is_admin boolean, credits integer, marketing_opt_out boolean
) as $$
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true) then
    return;
  end if;
  return query
    select p.id, p.username, p.email, p.city, p.state, p.zip,
           p.created_at, p.is_admin, p.credits, p.marketing_opt_out
    from profiles p
    where p_user_ids is null or p.id = any(p_user_ids)
    order by p.created_at desc;
end;
$$ language plpgsql stable security definer set search_path = public, pg_temp;
grant execute on function admin_list_users(uuid[]) to authenticated;
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/tests/profilePrivacy.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql supabase/tests/profilePrivacy.test.ts
git commit -m "Add get_my_profile, mark_credits_seen and admin_list_users"
```

---

### Task 3: Website reads private profile data through the new functions

**Files:**
- Modify: `app/layout.tsx:42`, `app/listings/[id]/page.tsx:87`, `app/profile/page.tsx:82`, `lib/unseenCredits.ts:14`, `app/profile/actions.ts:17-21`, `lib/actions/creditsSeen.ts`, `lib/actions/emailAdmin.ts:47,165`, `app/admin/AdminClient.tsx:659-663`, `app/admin/LocationsAdminTab.tsx:129,141`
- Test: `lib/actions/creditsSeen.test.ts`, `lib/unseenCredits.test.ts`, `app/profile/actions.test.ts` (update mocks)

**Interfaces:**
- Consumes: `get_my_profile`, `mark_credits_seen`, `admin_list_users` (Task 2).
- Produces: no website code reads `email`, `phone`, `address`, `address_unit`, `zip`, `credits`, `credits_seen_at`, `onboarding_bonus_claimed`, `phone_verified`, `email_verified`, `marketing_opt_out`, `notify_*`, `contact_preference`, `share_*`, `pickup_description` from `profiles` directly any more (Task 13's lockdown depends on this).

- [ ] **Step 1: Update the `markCreditsSeen` test to expect the RPC**

Replace the body of `lib/actions/creditsSeen.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { markCreditsSeen } from './creditsSeen'

const rpcMock = vi.fn((_fn: string, _args: Record<string, unknown>) => Promise.resolve({ data: null, error: null }))
let user: { id: string } | null = { id: 'user-1' }
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user } }) },
    rpc: (fn: string, args: Record<string, unknown>) => rpcMock(fn, args),
  }),
}))

describe('markCreditsSeen', () => {
  beforeEach(() => { rpcMock.mockClear(); user = { id: 'user-1' } })

  it("moves the caller's credits_seen_at forward to the given time", async () => {
    await markCreditsSeen('2026-11-09T10:00:00.000Z')
    expect(rpcMock).toHaveBeenCalledWith('mark_credits_seen', { p_up_to: '2026-11-09T10:00:00.000Z' })
  })

  it('does nothing when signed out', async () => {
    user = null
    await markCreditsSeen('2026-11-09T10:00:00.000Z')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('ignores a value that is not a timestamp', async () => {
    await markCreditsSeen('not a date')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('never throws, even if Supabase does', async () => {
    rpcMock.mockImplementationOnce(() => { throw new Error('boom') })
    await expect(markCreditsSeen('2026-11-09T10:00:00.000Z')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/actions/creditsSeen.test.ts`
Expected: FAIL — `rpcMock` not called (the action still uses `.from('profiles')`, which the mock doesn't provide → caught, so the first test fails).

- [ ] **Step 3: Switch `markCreditsSeen` to the RPC**

In `lib/actions/creditsSeen.ts` replace the `await supabase.from('profiles')…lt('credits_seen_at', upTo)` statement with:

```ts
    await supabase.rpc('mark_credits_seen', { p_up_to: upTo })
```

Run: `npx vitest run lib/actions/creditsSeen.test.ts` — Expected: PASS.

- [ ] **Step 4: Switch `fetchUnseenCredits`**

In `lib/unseenCredits.ts` replace the line
`const { data: seen, error } = await supabase.from('profiles').select('credits_seen_at').eq('id', userId).single()`
with:

```ts
    const { data: seen, error } = await supabase.rpc('get_my_profile').maybeSingle<{ credits_seen_at: string | null }>()
```

Then open `lib/unseenCredits.test.ts`: wherever its mock client provides `from('profiles')…single()` returning `{ data: { credits_seen_at } }`, provide instead
`rpc: (fn: string) => ({ maybeSingle: () => Promise.resolve(<the same { data, error } object>) })`, asserting `fn === 'get_my_profile'`. Keep every existing expectation.

Run: `npx vitest run lib/unseenCredits.test.ts` — Expected: PASS.

- [ ] **Step 5: Switch the other own-profile reads**

`app/layout.tsx` — replace
`const { data: p } = await supabase.from('profiles').select('username, is_admin, onboarding_bonus_claimed, credits').eq('id', user.id).single()`
with:

```ts
        const { data: p } = await supabase.rpc('get_my_profile')
          .maybeSingle<{ username: string | null; is_admin: boolean; onboarding_bonus_claimed: boolean; credits: number }>()
```

`app/listings/[id]/page.tsx` (shortfall block, ~line 87) — replace
`supabase.from('profiles').select('credits').eq('id', user.id).single(),`
with:

```ts
        supabase.rpc('get_my_profile').maybeSingle<{ credits: number }>(),
```

`app/profile/page.tsx:82` — replace
`supabase.from('profiles').select('*').eq('id', user.id).single(),`
with:

```ts
        supabase.rpc('get_my_profile').maybeSingle(),
```

`app/profile/actions.ts` `updateProfile` — replace the `currentProfile` query (`.from('profiles').select('phone_verified').eq('id', user!.id).single()`) with:

```ts
  const { data: currentProfile } = await supabase.rpc('get_my_profile').maybeSingle<{ phone_verified: boolean }>()
```

In `app/profile/actions.test.ts`, the mocked client's `profiles` `select` chain (`selectMock` → `selectEqMock` → `singleMock`) is now unused by `updateProfile`; add to the mocked client:

```ts
    rpc: (fn: string) => {
      if (fn !== 'get_my_profile') throw new Error(`unexpected rpc ${fn}`)
      return { maybeSingle: () => Promise.resolve(selectResult) }
    },
```

and remove `selectMock`/`selectEqMock`/`singleMock` if nothing else references them. Keep every `updateProfile` expectation unchanged.

- [ ] **Step 6: Switch the admin reads**

`lib/actions/emailAdmin.ts` `fetchRecipients` — replace
`const { data, error } = await supabase.from('profiles').select('id, email, city, state, marketing_opt_out')`
with:

```ts
  const { data, error } = await supabase.rpc('admin_list_users')
```

`lookupUserEmail` — replace its body with:

```ts
  const { data } = await supabase.rpc('admin_list_users', { p_user_ids: [userId] }).maybeSingle<{ email: string | null }>()
  return data?.email ?? null
```

`app/admin/AdminClient.tsx` (~line 659) — replace

```ts
    supabase
      .from('profiles')
      .select('id, username, email, city, state, zip, created_at, is_admin, credits')
      .order('created_at', { ascending: false })
```

with:

```ts
    supabase
      .rpc('admin_list_users')
```

(`admin_list_users` already returns newest first with the same column names; the `.then(({ data }) => …)` mapping is unchanged.)

`app/admin/LocationsAdminTab.tsx` — in the select string change `profiles!reporter_id(username, email)` to `profiles!reporter_id(username)`, and change `reporter: row.profiles?.username || row.profiles?.email || 'Unknown',` to `reporter: row.profiles?.username || 'Unknown',`.

- [ ] **Step 7: Confirm nothing else reads private profile columns**

Run: `npx vitest run` — Expected: all tests PASS.
Run (Bash): `grep -rn "from('profiles')" app lib components --include=*.ts --include=*.tsx | grep -v test`
Expected: every remaining hit selects only `id`, `username`, `city`, `state`, `is_admin` (or is an `.update(...)` of the caller's own row, or uses the service-role client in `app/api/auth/email-hook`). Fix any other hit the same way as Step 5.

- [ ] **Step 8: Commit**

```bash
git add -A app lib
git commit -m "Read private profile data via get_my_profile and admin_list_users"
```

---

### Task 4: Listing functions (SQL block 2/6)

**Files:**
- Modify: `supabase/schema.sql` (append block)
- Test: `supabase/tests/listings.test.ts`

**Interfaces:**
- Produces (SQL):
  - `create_listing(p_listing jsonb, p_books jsonb default '[]') returns jsonb` → `{status:'ok', id}` | `{status:'not_allowed'|'invalid_listing'|'needs_match'|'invalid_photo'}`
  - `update_listing(p_listing_id uuid, p_listing jsonb, p_books jsonb default '[]') returns text` → `'ok'|'not_allowed'|'pending_request'|'invalid_listing'|'needs_match'|'invalid_photo'`
  - `set_listing_status(p_listing_id uuid, p_status text) returns text` → `'ok'|'invalid_status'|'not_allowed'`
  - `delete_listing(p_listing_id uuid) returns text` → `'ok'|'not_allowed'|'pending_request'`
  - `p_listing` keys: `title, author, condition, price, description, genre, format, pickup_description, ol_work_key, cover_url, isbn, photo_url, photo_url_2, photo_url_3, is_bundle (boolean), bundle_name`. `p_books`: array of `{title, author, ol_work_key, cover_url}`. On update, a null/empty photo key keeps the existing photo.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/listings.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, createUser, seedListing, call } from './harness'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)

const photoFor = (userId: string) => `https://proj.supabase.co/storage/v1/object/public/book-photos/${userId}/1-1.jpg`
const base = { title: 'Dune', author: 'Frank Herbert', condition: 'Good', ol_work_key: '/works/OL1W' }
type Created = { status: string; id?: string }
const row = async (id: string) =>
  (await db.query<Record<string, unknown>>('select * from listings where id = $1', [id])).rows[0]

describe('create_listing', () => {
  it('creates a single-book listing with the seller city from their profile', async () => {
    const seller = await createUser(db, { city: 'Shelbyville' })
    const r = await call<Created>(db, seller, 'create_listing($1::jsonb)', [JSON.stringify({ ...base, photo_url: photoFor(seller) })])
    expect(r.status).toBe('ok')
    const l = await row(r.id!)
    expect(l).toMatchObject({ user_id: seller, title: 'Dune', city: 'Shelbyville', status: 'active', book_count: 1, is_bundle: false, photo_url: photoFor(seller) })
  })

  it('creates a bundle with its books, counted into book_count', async () => {
    const seller = await createUser(db)
    const books = [{ title: 'Hyperion', author: 'Dan Simmons', ol_work_key: '/works/OL2W' }, { title: '', author: '' }]
    const r = await call<Created>(db, seller, 'create_listing($1::jsonb, $2::jsonb)',
      [JSON.stringify({ ...base, is_bundle: true, bundle_name: ' Sci-fi pack ' }), JSON.stringify(books)])
    expect(await row(r.id!)).toMatchObject({ is_bundle: true, bundle_name: 'Sci-fi pack', book_count: 2 })
  })

  it('drops a cover URL that is not an Open Library cover', async () => {
    const seller = await createUser(db)
    const r = await call<Created>(db, seller, 'create_listing($1::jsonb)', [JSON.stringify({ ...base, cover_url: 'https://evil.example/x.jpg' })])
    expect((await row(r.id!)).cover_url).toBeNull()
  })

  it('rejects a book with no Open Library match', async () => {
    const seller = await createUser(db)
    expect(await call<Created>(db, seller, 'create_listing($1::jsonb)', [JSON.stringify({ ...base, ol_work_key: '' })])).toEqual({ status: 'needs_match' })
  })

  it("rejects a photo from someone else's folder", async () => {
    const seller = await createUser(db)
    const other = await createUser(db)
    expect(await call<Created>(db, seller, 'create_listing($1::jsonb)', [JSON.stringify({ ...base, photo_url: photoFor(other) })])).toEqual({ status: 'invalid_photo' })
  })

  it('rejects a missing title or an unknown condition', async () => {
    const seller = await createUser(db)
    expect(await call<Created>(db, seller, 'create_listing($1::jsonb)', [JSON.stringify({ ...base, title: ' ' })])).toEqual({ status: 'invalid_listing' })
    expect(await call<Created>(db, seller, 'create_listing($1::jsonb)', [JSON.stringify({ ...base, condition: 'Mint' })])).toEqual({ status: 'invalid_listing' })
  })

  it('refuses a signed-out caller', async () => {
    expect(await call<Created>(db, null, 'create_listing($1::jsonb)', [JSON.stringify(base)])).toEqual({ status: 'not_allowed' })
  })
})

describe('update_listing', () => {
  it('updates the owner listing, keeping photos that were not replaced', async () => {
    const seller = await createUser(db)
    const created = await call<Created>(db, seller, 'create_listing($1::jsonb)', [JSON.stringify({ ...base, photo_url: photoFor(seller) })])
    expect(await call(db, seller, 'update_listing($1, $2::jsonb)', [created.id, JSON.stringify({ ...base, title: 'Dune Messiah' })])).toBe('ok')
    expect(await row(created.id!)).toMatchObject({ title: 'Dune Messiah', photo_url: photoFor(seller) })
  })

  it("refuses someone else's listing and a listing with a pending request", async () => {
    const seller = await createUser(db)
    const other = await createUser(db)
    const active = await seedListing(db, seller)
    const pending = await seedListing(db, seller, { status: 'pending' })
    expect(await call(db, other, 'update_listing($1, $2::jsonb)', [active, JSON.stringify(base)])).toBe('not_allowed')
    expect(await call(db, seller, 'update_listing($1, $2::jsonb)', [pending, JSON.stringify(base)])).toBe('pending_request')
  })

  it('replaces bundle books as a whole', async () => {
    const seller = await createUser(db)
    const listing = await seedListing(db, seller, { bundleBooks: 3 })
    const books = [{ title: 'Only one', author: 'A', ol_work_key: '/works/OL5W' }]
    expect(await call(db, seller, 'update_listing($1, $2::jsonb, $3::jsonb)', [listing, JSON.stringify({ ...base, is_bundle: true }), JSON.stringify(books)])).toBe('ok')
    expect((await row(listing)).book_count).toBe(2)
  })
})

describe('set_listing_status and delete_listing', () => {
  it('lets the owner pause and reactivate, nothing else', async () => {
    const seller = await createUser(db)
    const other = await createUser(db)
    const listing = await seedListing(db, seller)
    expect(await call(db, seller, 'set_listing_status($1, $2)', [listing, 'paused'])).toBe('ok')
    expect((await row(listing)).status).toBe('paused')
    expect(await call(db, seller, 'set_listing_status($1, $2)', [listing, 'sold'])).toBe('invalid_status')
    expect(await call(db, other, 'set_listing_status($1, $2)', [listing, 'active'])).toBe('not_allowed')
  })

  it('never reopens a listing that has a pending request', async () => {
    const seller = await createUser(db)
    const pending = await seedListing(db, seller, { status: 'pending' })
    expect(await call(db, seller, 'set_listing_status($1, $2)', [pending, 'active'])).toBe('not_allowed')
    expect(await call(db, seller, 'delete_listing($1)', [pending])).toBe('pending_request')
  })

  it('deletes only the owner listing', async () => {
    const seller = await createUser(db)
    const other = await createUser(db)
    const listing = await seedListing(db, seller)
    expect(await call(db, other, 'delete_listing($1)', [listing])).toBe('not_allowed')
    expect(await call(db, seller, 'delete_listing($1)', [listing])).toBe('ok')
    expect(await row(listing)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/tests/listings.test.ts`
Expected: FAIL — `function create_listing(jsonb) does not exist`.

- [ ] **Step 3: Append SQL block 2 to `supabase/schema.sql`**

```sql

-- ── Migration: shared backend 2/6 — listing functions ────────────────────────
-- Run this block in Supabase SQL Editor:
-- Posting, editing, pausing and deleting go through these functions so the
-- website and the iPhone app follow the same rules. Mirrors lib/parseListingForm
-- (500-char description, max 20 bundle books, Open Library cover URLs only,
-- every book must have an Open Library match).

-- A photo must be in the caller's own folder of the book-photos bucket.
create or replace function lbe_photo_ok(p_url text)
returns boolean as $$
  select p_url is null
      or position('/storage/v1/object/public/book-photos/' || auth.uid()::text || '/' in p_url) > 0;
$$ language sql stable set search_path = public, pg_temp;

-- Same pattern as COVER_URL_PATTERN in lib/openLibrary.ts.
create or replace function lbe_cover_or_null(p_url text)
returns text as $$
  select case when p_url ~ '^https://covers\.openlibrary\.org/b/id/\d+-[SML]\.jpg$' then p_url end;
$$ language sql immutable;

-- Trims bundle rows, drops blank ones, caps at 20, keeps order.
create or replace function lbe_clean_books(p_books jsonb)
returns jsonb as $$
  select coalesce(jsonb_agg(b order by ord), '[]'::jsonb) from (
    select jsonb_build_object(
             'title', btrim(coalesce(e->>'title', '')),
             'author', btrim(coalesce(e->>'author', '')),
             'ol_work_key', nullif(e->>'ol_work_key', ''),
             'cover_url', lbe_cover_or_null(e->>'cover_url')) as b, ord
    from jsonb_array_elements(coalesce(p_books, '[]'::jsonb)) with ordinality as t(e, ord)
    where btrim(coalesce(e->>'title', '')) <> '' or btrim(coalesce(e->>'author', '')) <> ''
    order by ord
    limit 20
  ) s;
$$ language sql immutable;

create or replace function lbe_check_listing(p_listing jsonb, p_books jsonb)
returns text as $$
begin
  if btrim(coalesce(p_listing->>'title', '')) = '' or btrim(coalesce(p_listing->>'author', '')) = '' then
    return 'invalid_listing';
  end if;
  if coalesce(p_listing->>'condition', '') not in ('Good', 'Fair', 'Well-Loved', 'good', 'fair', 'well-loved') then
    return 'invalid_listing';
  end if;
  if nullif(p_listing->>'ol_work_key', '') is null
     or exists (select 1 from jsonb_array_elements(p_books) b where nullif(b->>'ol_work_key', '') is null) then
    return 'needs_match';
  end if;
  if not (lbe_photo_ok(nullif(p_listing->>'photo_url', ''))
          and lbe_photo_ok(nullif(p_listing->>'photo_url_2', ''))
          and lbe_photo_ok(nullif(p_listing->>'photo_url_3', ''))) then
    return 'invalid_photo';
  end if;
  return 'ok';
end;
$$ language plpgsql stable set search_path = public, pg_temp;

create or replace function create_listing(p_listing jsonb, p_books jsonb default '[]'::jsonb)
returns jsonb as $$
declare
  v_books jsonb := case when (p_listing->>'is_bundle')::boolean is true then lbe_clean_books(p_books) else '[]'::jsonb end;
  v_check text;
  v_id uuid;
begin
  if auth.uid() is null then return jsonb_build_object('status', 'not_allowed'); end if;
  v_check := lbe_check_listing(p_listing, v_books);
  if v_check <> 'ok' then return jsonb_build_object('status', v_check); end if;

  insert into listings (user_id, title, author, condition, price, description, genre, format,
                        pickup_description, ol_work_key, cover_url, isbn,
                        photo_url, photo_url_2, photo_url_3, city, is_bundle, bundle_name)
  values (
    auth.uid(),
    p_listing->>'title', p_listing->>'author', p_listing->>'condition',
    nullif(p_listing->>'price', '')::numeric,
    nullif(left(coalesce(p_listing->>'description', ''), 500), ''),
    nullif(p_listing->>'genre', ''), nullif(p_listing->>'format', ''),
    nullif(p_listing->>'pickup_description', ''),
    p_listing->>'ol_work_key', lbe_cover_or_null(p_listing->>'cover_url'), nullif(p_listing->>'isbn', ''),
    nullif(p_listing->>'photo_url', ''), nullif(p_listing->>'photo_url_2', ''), nullif(p_listing->>'photo_url_3', ''),
    coalesce((select city from profiles where id = auth.uid()), ''),
    jsonb_array_length(v_books) > 0,
    case when jsonb_array_length(v_books) > 0 then nullif(btrim(coalesce(p_listing->>'bundle_name', '')), '') end
  ) returning id into v_id;

  insert into listing_books (listing_id, title, author, ol_work_key, cover_url, position)
  select v_id, b->>'title', b->>'author', b->>'ol_work_key', b->>'cover_url', (ord - 1)::int
  from jsonb_array_elements(v_books) with ordinality as t(b, ord);

  return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function create_listing(jsonb, jsonb) to authenticated;

create or replace function update_listing(p_listing_id uuid, p_listing jsonb, p_books jsonb default '[]'::jsonb)
returns text as $$
declare
  v_existing listings%rowtype;
  v_books jsonb := case when (p_listing->>'is_bundle')::boolean is true then lbe_clean_books(p_books) else '[]'::jsonb end;
  v_check text;
begin
  select * into v_existing from listings where id = p_listing_id for update;
  if not found or v_existing.user_id is distinct from auth.uid() then return 'not_allowed'; end if;
  -- A buyer already requested it at its current book count (= price).
  if v_existing.status = 'pending' then return 'pending_request'; end if;
  v_check := lbe_check_listing(p_listing, v_books);
  if v_check <> 'ok' then return v_check; end if;

  update listings set
    title = p_listing->>'title', author = p_listing->>'author', condition = p_listing->>'condition',
    price = nullif(p_listing->>'price', '')::numeric,
    description = nullif(left(coalesce(p_listing->>'description', ''), 500), ''),
    genre = nullif(p_listing->>'genre', ''), format = nullif(p_listing->>'format', ''),
    pickup_description = nullif(p_listing->>'pickup_description', ''),
    ol_work_key = p_listing->>'ol_work_key', cover_url = lbe_cover_or_null(p_listing->>'cover_url'),
    isbn = nullif(p_listing->>'isbn', ''),
    photo_url   = coalesce(nullif(p_listing->>'photo_url', ''),   v_existing.photo_url),
    photo_url_2 = coalesce(nullif(p_listing->>'photo_url_2', ''), v_existing.photo_url_2),
    photo_url_3 = coalesce(nullif(p_listing->>'photo_url_3', ''), v_existing.photo_url_3),
    is_bundle = jsonb_array_length(v_books) > 0,
    bundle_name = case when jsonb_array_length(v_books) > 0 then nullif(btrim(coalesce(p_listing->>'bundle_name', '')), '') end
  where id = p_listing_id;

  delete from listing_books where listing_id = p_listing_id;
  insert into listing_books (listing_id, title, author, ol_work_key, cover_url, position)
  select p_listing_id, b->>'title', b->>'author', b->>'ol_work_key', b->>'cover_url', (ord - 1)::int
  from jsonb_array_elements(v_books) with ordinality as t(b, ord);
  return 'ok';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function update_listing(uuid, jsonb, jsonb) to authenticated;

-- Only the two states the Dashboard offers; pending/sold belong to the exchange flow.
create or replace function set_listing_status(p_listing_id uuid, p_status text)
returns text as $$
begin
  if p_status not in ('active', 'paused') then return 'invalid_status'; end if;
  update listings set status = p_status
  where id = p_listing_id and user_id = auth.uid() and status in ('active', 'paused');
  if not found then return 'not_allowed'; end if;
  return 'ok';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function set_listing_status(uuid, text) to authenticated;

create or replace function delete_listing(p_listing_id uuid)
returns text as $$
declare v_status text;
begin
  select status into v_status from listings where id = p_listing_id and user_id = auth.uid() for update;
  if not found then return 'not_allowed'; end if;
  if v_status = 'pending' then return 'pending_request'; end if;
  delete from listings where id = p_listing_id;
  return 'ok';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function delete_listing(uuid) to authenticated;
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/tests/listings.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql supabase/tests/listings.test.ts
git commit -m "Add create/update/status/delete listing functions"
```

---

### Task 5: Website posts and manages listings through the functions

**Files:**
- Create: `lib/listingPayload.ts`, `lib/listingPayload.test.ts`, `app/post/actions.test.ts`
- Modify: `app/post/actions.ts`, `app/profile/actions.ts:70-82` (`updateListingStatus`)

**Interfaces:**
- Consumes: `create_listing`, `update_listing`, `set_listing_status`, `delete_listing` (Task 4); `parseListingForm`, `parseBundleBooks`, `validateOpenLibraryMatch` from `lib/parseListingForm.ts`.
- Produces:
  - `buildListingPayload(formData: FormData, photos: ListingPhotos): { listing: ListingPayload; books: BundleBook[] }`
  - `type ListingPhotos = { photo_url: string | null; photo_url_2: string | null; photo_url_3: string | null }`
  - `listingErrorMessage(code: string): string`

- [ ] **Step 1: Write the failing payload test**

Create `lib/listingPayload.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildListingPayload, listingErrorMessage } from './listingPayload'

function form(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}
const noPhotos = { photo_url: null, photo_url_2: null, photo_url_3: null }

describe('buildListingPayload', () => {
  it('builds a single-book payload with photos and no books', () => {
    const { listing, books } = buildListingPayload(
      form({ title: 'Dune', author: 'Frank Herbert', condition: 'Good', ol_work_key: '/works/OL1W' }),
      { ...noPhotos, photo_url: 'https://x/p.jpg' },
    )
    expect(listing).toMatchObject({ title: 'Dune', author: 'Frank Herbert', condition: 'Good', ol_work_key: '/works/OL1W', photo_url: 'https://x/p.jpg', is_bundle: false, bundle_name: null })
    expect(books).toEqual([])
  })

  it('includes bundle books and a trimmed bundle name for a bundle', () => {
    const { listing, books } = buildListingPayload(form({
      title: 'Dune', author: 'Frank Herbert', condition: 'Good', ol_work_key: '/works/OL1W',
      is_bundle: 'true', bundle_name: '  Sci-fi pack ', book_rows: '1',
      book_title_1: 'Hyperion', book_author_1: 'Dan Simmons', book_ol_work_key_1: '/works/OL2W',
    }), noPhotos)
    expect(listing).toMatchObject({ is_bundle: true, bundle_name: 'Sci-fi pack' })
    expect(books).toEqual([{ title: 'Hyperion', author: 'Dan Simmons', ol_work_key: '/works/OL2W', cover_url: null }])
  })
})

describe('listingErrorMessage', () => {
  it('explains each known code and falls back for unknown ones', () => {
    expect(listingErrorMessage('needs_match')).toMatch(/select your book/)
    expect(listingErrorMessage('pending_request')).toMatch(/pending purchase request/)
    expect(listingErrorMessage('???')).toBe('Something went wrong. Please try again.')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/listingPayload.test.ts`
Expected: FAIL — `Cannot find module './listingPayload'`.

- [ ] **Step 3: Write `lib/listingPayload.ts`**

```ts
import { parseListingForm, parseBundleBooks, type ParsedListingForm } from './parseListingForm'

export type ListingPhotos = { photo_url: string | null; photo_url_2: string | null; photo_url_3: string | null }
export type BundleBook = ReturnType<typeof parseBundleBooks>[number]
export type ListingPayload = ParsedListingForm & ListingPhotos & { is_bundle: boolean; bundle_name: string | null }

// The shape create_listing / update_listing (supabase/schema.sql, shared
// backend 2/6) expect. The database re-validates everything.
export function buildListingPayload(formData: FormData, photos: ListingPhotos): { listing: ListingPayload; books: BundleBook[] } {
  const isBundle = formData.get('is_bundle') === 'true'
  return {
    listing: {
      ...parseListingForm(formData),
      ...photos,
      is_bundle: isBundle,
      bundle_name: ((formData.get('bundle_name') as string) || '').trim() || null,
    },
    books: isBundle ? parseBundleBooks(formData) : [],
  }
}

const LISTING_ERRORS: Record<string, string> = {
  needs_match: 'Please search and select your book from the results — it can\'t be posted without a match.',
  invalid_listing: 'Please fill in the title, author and condition.',
  invalid_photo: 'One of your photos could not be saved. Please try adding it again.',
  pending_request: 'This listing has a pending purchase request and can\'t be edited right now.',
  not_allowed: 'You can\'t edit this listing.',
}

export function listingErrorMessage(code: string): string {
  return LISTING_ERRORS[code] ?? 'Something went wrong. Please try again.'
}
```

Run: `npx vitest run lib/listingPayload.test.ts` — Expected: PASS.

- [ ] **Step 4: Write the failing action test**

Create `app/post/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createListing, updateListing } from './actions'

const redirectMock = vi.fn((url: string) => { const e = new Error(`REDIRECT:${url}`) as Error & { digest: string }; e.digest = `NEXT_REDIRECT;${url}`; throw e })
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirectMock(url) }))

let rpcResult: { data: unknown; error: unknown } = { data: { status: 'ok', id: 'new-id' }, error: null }
const rpcMock = vi.fn((_fn: string, _args: Record<string, unknown>) => Promise.resolve(rpcResult))
let existing: { data: unknown } = { data: { status: 'active' } }
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'seller-1' } } }) },
    rpc: (fn: string, args: Record<string, unknown>) => rpcMock(fn, args),
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ single: () => Promise.resolve(existing) }) }) }) }),
    storage: { from: () => ({ upload: vi.fn(), getPublicUrl: vi.fn() }) },
  }),
}))

function form(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}
const valid = { title: 'Dune', author: 'Frank Herbert', condition: 'Good', ol_work_key: '/works/OL1W' }

describe('createListing', () => {
  beforeEach(() => { rpcMock.mockClear(); rpcResult = { data: { status: 'ok', id: 'new-id' }, error: null } })

  it('creates the listing through create_listing and opens it', async () => {
    await expect(createListing(form(valid))).rejects.toThrow('REDIRECT:/listings/new-id')
    expect(rpcMock).toHaveBeenCalledWith('create_listing', expect.objectContaining({
      p_listing: expect.objectContaining({ title: 'Dune', photo_url: null }),
      p_books: [],
    }))
  })

  it('shows the database reason when the listing is refused', async () => {
    rpcResult = { data: { status: 'invalid_photo' }, error: null }
    await expect(createListing(form(valid))).rejects.toThrow(/REDIRECT:\/post\?error=One%20of%20your%20photos/)
  })

  it('never calls the database without an Open Library match', async () => {
    await expect(createListing(form({ ...valid, ol_work_key: '' }))).rejects.toThrow(/REDIRECT:\/post\?error=/)
    expect(rpcMock).not.toHaveBeenCalled()
  })
})

describe('updateListing', () => {
  beforeEach(() => { rpcMock.mockClear(); existing = { data: { status: 'active' } } })

  it('saves through update_listing and returns to My Listings', async () => {
    rpcResult = { data: 'ok', error: null }
    await expect(updateListing('listing-1', form(valid))).rejects.toThrow('REDIRECT:/profile?tab=listings')
    expect(rpcMock).toHaveBeenCalledWith('update_listing', expect.objectContaining({ p_listing_id: 'listing-1' }))
  })

  it('shows the reason when the database refuses the edit', async () => {
    rpcResult = { data: 'pending_request', error: null }
    await expect(updateListing('listing-1', form(valid))).rejects.toThrow(/REDIRECT:\/listings\/listing-1\/edit\?error=This%20listing%20has%20a%20pending/)
  })
})
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx vitest run app/post/actions.test.ts`
Expected: FAIL — `create_listing` never called (the action still inserts into `listings`).

- [ ] **Step 6: Rewrite `createListing` and `updateListing`**

In `app/post/actions.ts`: change the import line to

```ts
import { validateOpenLibraryMatch } from '@/lib/parseListingForm'
import { buildListingPayload, listingErrorMessage } from '@/lib/listingPayload'
```

Replace the body of `createListing`'s `try` block with:

```ts
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/auth/signin')

    // Validate before uploading, so a refused post doesn't leave orphan photos.
    const draft = buildListingPayload(formData, { photo_url: null, photo_url_2: null, photo_url_3: null })
    const matchError = validateOpenLibraryMatch(draft.listing, draft.books)
    if (matchError) redirect(`/post?error=${encodeURIComponent(matchError)}`)

    const [photo_url, photo_url_2, photo_url_3] = await Promise.all([
      uploadPhoto(supabase, user!.id, formData, 'photo', 1),
      uploadPhoto(supabase, user!.id, formData, 'photo_2', 2),
      uploadPhoto(supabase, user!.id, formData, 'photo_3', 3),
    ])
    const { listing, books } = buildListingPayload(formData, { photo_url, photo_url_2, photo_url_3 })

    const { data, error } = await supabase.rpc('create_listing', { p_listing: listing, p_books: books })
    const result = data as { status: string; id?: string } | null
    if (error || !result) redirect(`/post?error=${encodeURIComponent(error?.message || 'Failed to post listing')}`)
    if (result!.status !== 'ok' || !result!.id) redirect(`/post?error=${encodeURIComponent(listingErrorMessage(result!.status))}`)

    redirect(`/listings/${result!.id}`)
```

Replace the body of `updateListing`'s `try` block with:

```ts
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/auth/signin')

    // Early exit before uploading photos; update_listing re-checks both.
    const { data: existing } = await supabase
      .from('listings').select('status')
      .eq('id', listingId).eq('user_id', user.id).single()
    if (!existing) redirect('/profile?tab=listings')
    if (existing.status === 'pending') {
      redirect(`/listings/${listingId}/edit?error=${encodeURIComponent(listingErrorMessage('pending_request'))}`)
    }

    const draft = buildListingPayload(formData, { photo_url: null, photo_url_2: null, photo_url_3: null })
    const matchError = validateOpenLibraryMatch(draft.listing, draft.books)
    if (matchError) redirect(`/listings/${listingId}/edit?error=${encodeURIComponent(matchError)}`)

    const [photo_url, photo_url_2, photo_url_3] = await Promise.all([
      uploadPhoto(supabase, user.id, formData, 'photo', 1),
      uploadPhoto(supabase, user.id, formData, 'photo_2', 2),
      uploadPhoto(supabase, user.id, formData, 'photo_3', 3),
    ])
    // A null photo keeps the one already on the listing (update_listing).
    const { listing, books } = buildListingPayload(formData, { photo_url, photo_url_2, photo_url_3 })

    const { data: status, error } = await supabase.rpc('update_listing', { p_listing_id: listingId, p_listing: listing, p_books: books })
    if (error) redirect(`/listings/${listingId}/edit?error=${encodeURIComponent(error.message)}`)
    if (status !== 'ok') redirect(`/listings/${listingId}/edit?error=${encodeURIComponent(listingErrorMessage(String(status)))}`)

    redirect('/profile?tab=listings')
```

Keep `uploadPhoto` and both `catch` blocks unchanged.

- [ ] **Step 7: Rewrite `updateListingStatus`**

In `app/profile/actions.ts` replace the `if (status === 'delete') { … } else { … }` block with:

```ts
  if (status === 'delete') {
    await supabase.rpc('delete_listing', { p_listing_id: id })
  } else {
    await supabase.rpc('set_listing_status', { p_listing_id: id, p_status: status })
  }
```

- [ ] **Step 8: Run tests**

Run: `npx vitest run app/post lib/listingPayload.test.ts app/profile`
Expected: PASS. (If an existing `app/profile` test covered `updateListingStatus` via `from('listings')`, change its mock to `rpc` and assert `delete_listing` / `set_listing_status` with the same ids.)

- [ ] **Step 9: Commit**

```bash
git add lib/listingPayload.ts lib/listingPayload.test.ts app/post/actions.ts app/post/actions.test.ts app/profile/actions.ts app/profile/actions.test.ts
git commit -m "Post, edit, pause and delete listings through database functions"
```

---

### Task 6: Request functions + credit-hold fix (SQL block 3/6)

**Files:**
- Modify: `supabase/schema.sql` (append block), `lib/creditCheck.ts`, `lib/creditCheck.test.ts`
- Test: `supabase/tests/exchangeRequests.test.ts`

**Interfaces:**
- Produces (SQL):
  - `lbe_held_credits(p_buyer uuid, p_exclude_listing uuid) returns integer` — sum of `book_count` over the buyer's exchanges in `requested`/`confirmed`, excluding one listing.
  - `start_conversation(p_listing_id uuid) returns jsonb` → `{status:'ok', id}` | `{status:'not_allowed'|'not_found'|'own_listing'}`
  - `request_book(p_listing_id uuid) returns jsonb` → `{status:'ok', id}` | `{status:'not_allowed'|'not_available'|'own_listing'|'insufficient_credits'}`
  - `cancel_request(p_conversation_id uuid) returns text` → `'ok'|'not_allowed'|'wrong_status'`
- Produces (TS): `availableCredits` / `creditShortfall` unchanged signatures; an exchange counts as holding credits when `exchange_status` is `requested` or `confirmed` (listing status no longer matters).

- [ ] **Step 1: Write the failing database test**

Create `supabase/tests/exchangeRequests.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, createUser, seedListing, seedConversation, call, asUser } from './harness'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)

type Res = { status: string; id?: string }
const listingStatus = async (id: string) => (await db.query<{ status: string }>('select status from listings where id = $1', [id])).rows[0]?.status

describe('start_conversation', () => {
  it('creates one thread per buyer and listing, and reuses it', async () => {
    const seller = await createUser(db)
    const buyer = await createUser(db)
    const listing = await seedListing(db, seller)
    const first = await call<Res>(db, buyer, 'start_conversation($1)', [listing])
    const again = await call<Res>(db, buyer, 'start_conversation($1)', [listing])
    expect(first.status).toBe('ok')
    expect(again.id).toBe(first.id)
  })

  it('refuses messaging yourself and a missing listing', async () => {
    const seller = await createUser(db)
    const listing = await seedListing(db, seller)
    expect(await call<Res>(db, seller, 'start_conversation($1)', [listing])).toEqual({ status: 'own_listing' })
    expect(await call<Res>(db, seller, 'start_conversation($1)', ['00000000-0000-0000-0000-000000000000'])).toEqual({ status: 'not_found' })
  })
})

describe('request_book', () => {
  it('locks the listing, opens a requested exchange and posts the request message', async () => {
    const seller = await createUser(db)
    const buyer = await createUser(db, { credits: 1 })
    const listing = await seedListing(db, seller)
    const r = await call<Res>(db, buyer, 'request_book($1)', [listing])
    expect(r.status).toBe('ok')
    expect(await listingStatus(listing)).toBe('pending')
    const convo = (await db.query<{ exchange_status: string }>('select exchange_status from conversations where id = $1', [r.id])).rows[0]
    expect(convo.exchange_status).toBe('requested')
    const msgs = (await db.query<{ kind: string; sender_id: string }>('select kind, sender_id from messages where conversation_id = $1', [r.id])).rows
    expect(msgs).toEqual([{ kind: 'purchase_request', sender_id: buyer }])
  })

  it('reuses an existing message thread', async () => {
    const seller = await createUser(db)
    const buyer = await createUser(db, { credits: 1 })
    const listing = await seedListing(db, seller)
    const thread = await call<Res>(db, buyer, 'start_conversation($1)', [listing])
    expect((await call<Res>(db, buyer, 'request_book($1)', [listing])).id).toBe(thread.id)
  })

  it('refuses when the buyer cannot afford the book count, leaving the listing active', async () => {
    const seller = await createUser(db)
    const buyer = await createUser(db, { credits: 2 })
    const bundle = await seedListing(db, seller, { bundleBooks: 2 })
    expect(await call<Res>(db, buyer, 'request_book($1)', [bundle])).toEqual({ status: 'insufficient_credits' })
    expect(await listingStatus(bundle)).toBe('active')
  })

  it('counts credits held by a confirmed exchange whose listing is already sold', async () => {
    const seller = await createUser(db)
    const buyer = await createUser(db, { credits: 1 })
    const soldListing = await seedListing(db, seller, { status: 'sold' })
    await seedConversation(db, { listingId: soldListing, buyerId: buyer, sellerId: seller, status: 'confirmed' })
    const next = await seedListing(db, seller)
    expect(await call<Res>(db, buyer, 'request_book($1)', [next])).toEqual({ status: 'insufficient_credits' })
  })

  it('lets only the first of two buyers request the same listing, and ignores a double tap', async () => {
    const seller = await createUser(db)
    const first = await createUser(db, { credits: 1 })
    const second = await createUser(db, { credits: 1 })
    const listing = await seedListing(db, seller)
    expect((await call<Res>(db, first, 'request_book($1)', [listing])).status).toBe('ok')
    expect(await call<Res>(db, first, 'request_book($1)', [listing])).toEqual({ status: 'not_available' })
    expect(await call<Res>(db, second, 'request_book($1)', [listing])).toEqual({ status: 'not_available' })
    const messages = (await db.query('select id from messages m join conversations c on c.id = m.conversation_id where c.listing_id = $1', [listing])).rows
    expect(messages).toHaveLength(1)
  })

  it('refuses your own listing and signed-out callers', async () => {
    const seller = await createUser(db, { credits: 5 })
    const listing = await seedListing(db, seller)
    expect(await call<Res>(db, seller, 'request_book($1)', [listing])).toEqual({ status: 'own_listing' })
    expect(await call<Res>(db, null, 'request_book($1)', [listing])).toEqual({ status: 'not_allowed' })
  })
})

describe('cancel_request', () => {
  it('lets the buyer cancel a request, reopening the listing', async () => {
    const seller = await createUser(db)
    const buyer = await createUser(db, { credits: 1 })
    const listing = await seedListing(db, seller)
    const r = await call<Res>(db, buyer, 'request_book($1)', [listing])
    expect(await call(db, buyer, 'cancel_request($1)', [r.id])).toBe('ok')
    expect(await listingStatus(listing)).toBe('active')
    expect((await db.query('select id from conversations where id = $1', [r.id])).rows).toHaveLength(0)
  })

  it('refuses the seller, strangers, and a confirmed exchange', async () => {
    const seller = await createUser(db)
    const buyer = await createUser(db)
    const stranger = await createUser(db)
    const listing = await seedListing(db, seller, { status: 'sold' })
    const convo = await seedConversation(db, { listingId: listing, buyerId: buyer, sellerId: seller, status: 'confirmed' })
    expect(await call(db, seller, 'cancel_request($1)', [convo])).toBe('not_allowed')
    expect(await call(db, stranger, 'cancel_request($1)', [convo])).toBe('not_allowed')
    expect(await call(db, buyer, 'cancel_request($1)', [convo])).toBe('wrong_status')
    expect(await asUser(db, buyer, 'select id from conversations where id = $1', [convo])).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run supabase/tests/exchangeRequests.test.ts`
Expected: FAIL — `function start_conversation(unknown) does not exist`.

- [ ] **Step 3: Append SQL block 3 to `supabase/schema.sql`**

```sql

-- ── Migration: shared backend 3/6 — messaging and requesting a book ──────────
-- Run this block in Supabase SQL Editor:

-- Credits are deducted only when an exchange completes, so every requested or
-- confirmed exchange holds its book_count until then. (Earlier code only
-- counted exchanges whose listing was still 'pending', but confirming marks
-- the listing 'sold' — freeing the buyer's credits too early. Mirrored in
-- lib/creditCheck.ts.)
create or replace function lbe_held_credits(p_buyer uuid, p_exclude_listing uuid)
returns integer as $$
  select coalesce(sum(l.book_count), 0)::int
  from conversations c join listings l on l.id = c.listing_id
  where c.buyer_id = p_buyer and c.type = 'exchange'
    and c.exchange_status in ('requested', 'confirmed')
    and c.listing_id is distinct from p_exclude_listing;
$$ language sql stable set search_path = public, pg_temp;

create or replace function start_conversation(p_listing_id uuid)
returns jsonb as $$
declare
  v_seller uuid;
  v_id uuid;
begin
  if auth.uid() is null then return jsonb_build_object('status', 'not_allowed'); end if;
  select user_id into v_seller from listings where id = p_listing_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_seller = auth.uid() then return jsonb_build_object('status', 'own_listing'); end if;
  select id into v_id from conversations where listing_id = p_listing_id and buyer_id = auth.uid();
  if v_id is null then
    insert into conversations (listing_id, buyer_id, seller_id) values (p_listing_id, auth.uid(), v_seller)
    returning id into v_id;
  end if;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function start_conversation(uuid) to authenticated;

-- Replaces lock_listing_for_request + the website's multi-step request: one
-- transaction, so a failure can never leave a listing locked with no request.
create or replace function request_book(p_listing_id uuid)
returns jsonb as $$
declare
  v_listing listings%rowtype;
  v_balance integer;
  v_id uuid;
begin
  if auth.uid() is null then return jsonb_build_object('status', 'not_allowed'); end if;
  select * into v_listing from listings where id = p_listing_id for update;
  if not found then return jsonb_build_object('status', 'not_available'); end if;
  if v_listing.user_id = auth.uid() then return jsonb_build_object('status', 'own_listing'); end if;
  if v_listing.status <> 'active' then return jsonb_build_object('status', 'not_available'); end if;

  select credits into v_balance from profiles where id = auth.uid() for update;
  if coalesce(v_balance, 0) - lbe_held_credits(auth.uid(), p_listing_id) < v_listing.book_count then
    return jsonb_build_object('status', 'insufficient_credits');
  end if;

  update listings set status = 'pending' where id = p_listing_id;

  select id into v_id from conversations where listing_id = p_listing_id and buyer_id = auth.uid();
  if v_id is null then
    insert into conversations (listing_id, buyer_id, seller_id, exchange_status)
    values (p_listing_id, auth.uid(), v_listing.user_id, 'requested')
    returning id into v_id;
  else
    update conversations set exchange_status = 'requested', completed_at = null where id = v_id;
  end if;

  insert into messages (conversation_id, sender_id, body, kind)
  values (v_id, auth.uid(), '🛒 I''d like to purchase this book! Please confirm when you''re ready.', 'purchase_request');

  return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function request_book(uuid) to authenticated;

create or replace function cancel_request(p_conversation_id uuid)
returns text as $$
declare v_conv conversations%rowtype;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if not found or v_conv.buyer_id is distinct from auth.uid() then return 'not_allowed'; end if;
  if v_conv.exchange_status not in ('requested', 'none') then return 'wrong_status'; end if;
  if v_conv.exchange_status = 'requested' then
    update listings set status = 'active' where id = v_conv.listing_id and status = 'pending';
  end if;
  delete from conversations where id = p_conversation_id;
  return 'ok';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function cancel_request(uuid) to authenticated;
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run supabase/tests/exchangeRequests.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Update the credit-check test for the new hold rule**

In `lib/creditCheck.test.ts` replace the test `'ignores a stale "confirmed" exchange whose listing is no longer pending'` with:

```ts
  it('counts a confirmed exchange even though confirming marked its listing sold (credits move at pickup)', () => {
    expect(availableCredits(2, [req('confirmed', 'sold')])).toBe(1)
  })
```

Run: `npx vitest run lib/creditCheck.test.ts`
Expected: FAIL on that test (gets 2, expected 1).

- [ ] **Step 6: Change the rule in `lib/creditCheck.ts`**

Replace the comment above `isOpen` and the function with:

```ts
// A request holds its credits from the moment it's made until the exchange
// completes (when they're actually deducted) or ends. Listing status doesn't
// matter: confirming marks the listing sold while the pickup is still to come.
// Mirrors lbe_held_credits() in supabase/schema.sql.
function isOpen(row: OpenRequestRow): boolean {
  return (row.exchange_status === 'requested' || row.exchange_status === 'confirmed')
    && row.listings !== null
}
```

Run: `npx vitest run lib/creditCheck.test.ts` — Expected: PASS (the "missing listing" and "finished exchanges" tests still pass).

- [ ] **Step 7: Commit**

```bash
git add supabase/schema.sql supabase/tests/exchangeRequests.test.ts lib/creditCheck.ts lib/creditCheck.test.ts
git commit -m "Add start_conversation, request_book, cancel_request; confirmed exchanges hold credits"
```

---

### Task 7: Website requests and cancels through the functions

**Files:**
- Create: `app/listings/[id]/actions.ts`, `app/listings/[id]/actions.test.ts`
- Modify: `app/listings/[id]/page.tsx` (remove inline `startConversation` / `requestPurchase`, ~lines 102-226; forms at ~330/335), `app/profile/actions.ts` (`cancelPurchase`)

**Interfaces:**
- Consumes: `start_conversation`, `request_book`, `cancel_request` (Task 6).
- Produces: `startConversationAction(listingId: string): Promise<void>`, `requestBookAction(listingId: string): Promise<void>` (both always end in `redirect`).

- [ ] **Step 1: Write the failing test**

Create `app/listings/[id]/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requestBookAction, startConversationAction } from './actions'

vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`) } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined, set: vi.fn() }) }))

let user: { id: string } | null = { id: 'buyer-1' }
let rpcData: unknown = { status: 'ok', id: 'convo-1' }
const rpcMock = vi.fn((_fn: string, _args: Record<string, unknown>) => Promise.resolve({ data: rpcData, error: null }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user } }) },
    rpc: (fn: string, args: Record<string, unknown>) => rpcMock(fn, args),
  }),
}))

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')
  user = { id: 'buyer-1' }
  rpcMock.mockClear()
})

describe('requestBookAction', () => {
  it('requests through request_book and shows the requested state', async () => {
    rpcData = { status: 'ok', id: 'convo-1' }
    await expect(requestBookAction('listing-1')).rejects.toThrow('REDIRECT:/listings/listing-1?requested=1')
    expect(rpcMock).toHaveBeenCalledWith('request_book', { p_listing_id: 'listing-1' })
  })

  it('explains a credit shortfall', async () => {
    rpcData = { status: 'insufficient_credits' }
    await expect(requestBookAction('listing-1')).rejects.toThrow('REDIRECT:/listings/listing-1?insufficient_credits=1')
  })

  it('reports any other refusal as a failed request', async () => {
    rpcData = { status: 'not_available' }
    await expect(requestBookAction('listing-1')).rejects.toThrow('REDIRECT:/listings/listing-1?purchase_failed=1')
  })

  it('sends signed-out visitors to sign in', async () => {
    user = null
    await expect(requestBookAction('listing-1')).rejects.toThrow('REDIRECT:/auth/signin?redirect=/listings/listing-1')
    expect(rpcMock).not.toHaveBeenCalled()
  })
})

describe('startConversationAction', () => {
  it('opens the thread in Messages', async () => {
    rpcData = { status: 'ok', id: 'convo-9' }
    await expect(startConversationAction('listing-1')).rejects.toThrow('REDIRECT:/profile?tab=messages&conversation=convo-9')
    expect(rpcMock).toHaveBeenCalledWith('start_conversation', { p_listing_id: 'listing-1' })
  })

  it('stays on the listing when the thread cannot be started', async () => {
    rpcData = { status: 'own_listing' }
    await expect(startConversationAction('listing-1')).rejects.toThrow('REDIRECT:/listings/listing-1')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run "app/listings/\[id\]/actions.test.ts"`
Expected: FAIL — `Cannot find module './actions'`.

- [ ] **Step 3: Write `app/listings/[id]/actions.ts`**

```ts
'use server'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { MOCK_CONVERSATIONS } from '@/lib/mock-data'

function isDemo(): boolean {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http') || !!cookies().get('lbe_demo_user')
}

export async function startConversationAction(listingId: string): Promise<void> {
  if (isDemo()) {
    const mock = MOCK_CONVERSATIONS.find(c => c.listing_id === listingId)
    revalidatePath('/profile')
    redirect(`/profile?tab=messages&conversation=${mock?.id ?? 'mock-convo-1'}`)
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/auth/signin?redirect=/listings/${listingId}`)

  const { data } = await supabase.rpc('start_conversation', { p_listing_id: listingId })
  const result = data as { status: string; id?: string } | null
  if (result?.status !== 'ok' || !result.id) redirect(`/listings/${listingId}`)

  revalidatePath('/profile')
  redirect(`/profile?tab=messages&conversation=${result!.id}`)
}

export async function requestBookAction(listingId: string): Promise<void> {
  if (isDemo()) {
    cookies().set('lbe_demo_pending', listingId, { maxAge: 86400, path: '/', sameSite: 'lax' })
    redirect(`/listings/${listingId}?requested=1`)
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/auth/signin?redirect=/listings/${listingId}`)

  const { data } = await supabase.rpc('request_book', { p_listing_id: listingId })
  const status = (data as { status?: string } | null)?.status
  if (status === 'ok') redirect(`/listings/${listingId}?requested=1`)
  if (status === 'insufficient_credits') redirect(`/listings/${listingId}?insufficient_credits=1`)
  redirect(`/listings/${listingId}?purchase_failed=1`)
}
```

Run: `npx vitest run "app/listings/\[id\]/actions.test.ts"` — Expected: PASS (6 tests).

- [ ] **Step 4: Wire the page to the new actions**

In `app/listings/[id]/page.tsx`:
- Delete the inline `async function startConversation(formData: FormData) { … }` and `async function requestPurchase(formData: FormData) { … }` (both whole functions, through the closing brace after `redirect(\`/listings/${params.id}?purchase_failed=1\`)`).
- Add the import `import { startConversationAction, requestBookAction } from './actions'`.
- Change `<form action={requestPurchase}>` to `<form action={requestBookAction.bind(null, listing.id)}>` and `<form action={startConversation}>` to `<form action={startConversationAction.bind(null, listing.id)}>`.
- Remove `availableCredits` and `MOCK_CONVERSATIONS` from the imports if nothing else in the file uses them (`creditShortfall`, `CreditShortfall`, `OpenRequestRow` stay — the shortfall note uses them).

- [ ] **Step 5: Rewrite `cancelPurchase`**

In `app/profile/actions.ts` replace everything in `cancelPurchase` between `const conversationId = …` and `redirect('/profile?tab=exchanges')` with:

```ts
  await supabase.rpc('cancel_request', { p_conversation_id: conversationId })
```

- [ ] **Step 6: Type-check and run tests**

Run: `npx tsc --noEmit` — Expected: no errors.
Run: `npx vitest run` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "app/listings/[id]" app/profile/actions.ts
git commit -m "Request, message and cancel through database functions"
```

---

### Task 8: Confirm and decline functions (SQL block 4/6)

**Files:**
- Modify: `supabase/schema.sql` (append block)
- Test: `supabase/tests/exchangeConfirm.test.ts`

**Interfaces:**
- Produces (SQL):
  - `format_pickup_availability(p_mode text, p_date date, p_start time, p_end time) returns text` — same output as `formatPickupAvailability` in `lib/formatPickupAvailability.ts` (null when incomplete).
  - `confirm_exchange(p_conversation_id uuid, p_pickup jsonb) returns text` → `'ok'|'not_allowed'|'wrong_status'|'invalid_pickup'`. `p_pickup` keys: `address, address_unit, city, state, pickup, pickup_mode ('window'|'after'|'anytime'), pickup_date ('YYYY-MM-DD'), pickup_time_start ('HH:MM'), pickup_time_end ('HH:MM')`.
  - `deny_request(p_conversation_id uuid) returns text` → `'ok'|'not_allowed'|'wrong_status'`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/exchangeConfirm.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, createUser, seedListing, call } from './harness'
import { formatPickupAvailability } from '@/lib/formatPickupAvailability'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)

let seq = 0
async function requested() {
  const seller = await createUser(db, { username: `sally_${++seq}` })
  const buyer = await createUser(db, { credits: 1 })
  const listing = await seedListing(db, seller)
  const r = await call<{ id: string }>(db, buyer, 'request_book($1)', [listing])
  return { seller, buyer, listing, convo: r.id, sellerName: `sally_${seq}` }
}
const convoRow = async (id: string) => (await db.query<Record<string, unknown>>('select * from conversations where id = $1', [id])).rows[0]
const window = { pickup_mode: 'window', pickup_date: '2026-11-12', pickup_time_start: '15:05', pickup_time_end: '17:00' }

describe('format_pickup_availability', () => {
  const cases: [string, string | null, string | null, string | null][] = [
    ['anytime', null, null, null],
    ['after', '2026-01-04', '00:30', null],
    ['window', '2026-11-12', '12:00', '13:15'],
    ['window', '2026-11-12', '09:00', null],
  ]
  it.each(cases)('matches the website formatter for %s %s %s %s', async (mode, date, start, end) => {
    const { rows } = await db.query<{ r: string | null }>('select format_pickup_availability($1, $2::date, $3::time, $4::time) as r', [mode, date, start, end])
    expect(rows[0].r).toBe(formatPickupAvailability({ mode: mode as 'window', date, timeStart: start, timeEnd: end }))
  })
})

describe('confirm_exchange', () => {
  it('confirms, stores the pickup, marks the listing sold and posts the confirmation message', async () => {
    const { seller, listing, convo, sellerName } = await requested()
    const pickup = { ...window, city: 'Springfield', state: 'IL', address: '1 Main St', address_unit: 'Apt 2', pickup: 'front porch' }
    expect(await call(db, seller, 'confirm_exchange($1, $2::jsonb)', [convo, JSON.stringify(pickup)])).toBe('ok')
    expect(await convoRow(convo)).toMatchObject({ exchange_status: 'confirmed', confirmed_address: '1 Main St', confirmed_pickup: 'front porch', confirmed_pickup_mode: 'window' })
    expect((await db.query<{ status: string }>('select status from listings where id = $1', [listing])).rows[0].status).toBe('sold')
    const msg = (await db.query<{ body: string; kind: string }>(`select body, kind from messages where conversation_id = $1 and kind = 'confirmation'`, [convo])).rows[0]
    expect(msg.body).toBe([
      "📍 Exchange confirmed! Here's how to connect:",
      `👤 ${sellerName}`,
      '📌 Springfield, IL',
      '🏠 1 Main St Apt 2',
      '📦 Pickup: front porch',
      '🕐 Thu, Nov 12 · 3:05 PM–5:00 PM',
    ].join('\n'))
  })

  it('clears date and times for "ready now"', async () => {
    const { seller, convo } = await requested()
    const pickup = { pickup_mode: 'anytime', pickup_date: '2026-11-12', pickup_time_start: '10:00', city: 'Springfield' }
    expect(await call(db, seller, 'confirm_exchange($1, $2::jsonb)', [convo, JSON.stringify(pickup)])).toBe('ok')
    expect(await convoRow(convo)).toMatchObject({ confirmed_pickup_date: null, confirmed_pickup_time_start: null, confirmed_pickup_time_end: null })
  })

  it('rejects an incomplete or garbled pickup time without confirming', async () => {
    const { seller, convo } = await requested()
    expect(await call(db, seller, 'confirm_exchange($1, $2::jsonb)', [convo, JSON.stringify({ ...window, pickup_time_end: '' })])).toBe('invalid_pickup')
    expect(await call(db, seller, 'confirm_exchange($1, $2::jsonb)', [convo, JSON.stringify({ ...window, pickup_date: 'soon' })])).toBe('invalid_pickup')
    expect(await call(db, seller, 'confirm_exchange($1, $2::jsonb)', [convo, JSON.stringify({ pickup_mode: 'whenever' })])).toBe('invalid_pickup')
    expect((await convoRow(convo)).exchange_status).toBe('requested')
  })

  it('refuses the buyer, strangers, and an exchange that is not requested', async () => {
    const { seller, buyer, convo } = await requested()
    const stranger = await createUser(db)
    expect(await call(db, buyer, 'confirm_exchange($1, $2::jsonb)', [convo, JSON.stringify(window)])).toBe('not_allowed')
    expect(await call(db, stranger, 'confirm_exchange($1, $2::jsonb)', [convo, JSON.stringify(window)])).toBe('not_allowed')
    await call(db, seller, 'confirm_exchange($1, $2::jsonb)', [convo, JSON.stringify(window)])
    expect(await call(db, seller, 'confirm_exchange($1, $2::jsonb)', [convo, JSON.stringify(window)])).toBe('wrong_status')
  })
})

describe('deny_request', () => {
  it('declines, reopens the listing and notifies the buyer', async () => {
    const { seller, buyer, listing, convo } = await requested()
    expect(await call(db, seller, 'deny_request($1)', [convo])).toBe('ok')
    expect((await convoRow(convo)).exchange_status).toBe('declined')
    expect((await db.query<{ status: string }>('select status from listings where id = $1', [listing])).rows[0].status).toBe('active')
    const notes = (await db.query(`select id from notifications where user_id = $1 and type = 'purchase_decision' and entity_id = $2`, [buyer, convo])).rows
    expect(notes).toHaveLength(1)
  })

  it('refuses the buyer and strangers', async () => {
    const { buyer, convo } = await requested()
    const stranger = await createUser(db)
    expect(await call(db, buyer, 'deny_request($1)', [convo])).toBe('not_allowed')
    expect(await call(db, stranger, 'deny_request($1)', [convo])).toBe('not_allowed')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run supabase/tests/exchangeConfirm.test.ts`
Expected: FAIL — `function format_pickup_availability(...) does not exist`.

- [ ] **Step 3: Append SQL block 4 to `supabase/schema.sql`**

```sql

-- ── Migration: shared backend 4/6 — confirming and declining ─────────────────
-- Run this block in Supabase SQL Editor:

-- Same text as formatPickupAvailability() in lib/formatPickupAvailability.ts
-- (a test checks they agree). Used for the confirmation message.
create or replace function format_pickup_availability(p_mode text, p_date date, p_start time, p_end time)
returns text as $$
  select case
    when p_mode = 'anytime' then '✅ Ready for pickup now'
    when p_mode = 'after' and p_date is not null and p_start is not null
      then to_char(p_date, 'Dy, Mon FMDD') || ' · after ' || to_char(p_start, 'FMHH12:MI AM')
    when p_mode = 'window' and p_date is not null and p_start is not null and p_end is not null
      then to_char(p_date, 'Dy, Mon FMDD') || ' · ' || to_char(p_start, 'FMHH12:MI AM')
           || '–' || to_char(p_end, 'FMHH12:MI AM')
  end;
$$ language sql immutable;

-- Phone numbers are never included in the message, on purpose — they must
-- never be shared between users.
create or replace function confirm_exchange(p_conversation_id uuid, p_pickup jsonb)
returns text as $$
declare
  v_conv conversations%rowtype;
  v_mode text := p_pickup->>'pickup_mode';
  v_date date;
  v_start time;
  v_end time;
  v_address text := btrim(coalesce(p_pickup->>'address', ''));
  v_unit text := btrim(coalesce(p_pickup->>'address_unit', ''));
  v_city text := btrim(coalesce(p_pickup->>'city', ''));
  v_state text := case when coalesce(p_pickup->>'state', '') ~ '^[A-Z]{2}$' then p_pickup->>'state' else '' end;
  v_pickup text := btrim(coalesce(p_pickup->>'pickup', ''));
  v_username text;
  v_lines text[];
  v_avail text;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if not found or v_conv.seller_id is distinct from auth.uid() then return 'not_allowed'; end if;
  if v_conv.exchange_status <> 'requested' then return 'wrong_status'; end if;

  begin
    v_date  := nullif(p_pickup->>'pickup_date', '')::date;
    v_start := nullif(p_pickup->>'pickup_time_start', '')::time;
    v_end   := nullif(p_pickup->>'pickup_time_end', '')::time;
  exception when others then
    return 'invalid_pickup';
  end;
  if not (v_mode = 'anytime'
          or (v_mode = 'after' and v_date is not null and v_start is not null)
          or (v_mode = 'window' and v_date is not null and v_start is not null and v_end is not null)) then
    return 'invalid_pickup';
  end if;
  if v_mode = 'anytime' then v_date := null; v_start := null; end if;
  if v_mode <> 'window' then v_end := null; end if;

  update conversations set
    exchange_status = 'confirmed',
    confirmed_address = nullif(v_address, ''), confirmed_address_unit = nullif(v_unit, ''),
    confirmed_pickup = nullif(v_pickup, ''), confirmed_pickup_mode = v_mode,
    confirmed_pickup_date = v_date, confirmed_pickup_time_start = v_start, confirmed_pickup_time_end = v_end
  where id = p_conversation_id;

  update notifications set read = true
  where user_id = auth.uid() and entity_id = p_conversation_id and type = 'purchase_request';

  update listings set status = 'sold' where id = v_conv.listing_id and status = 'pending';

  select username into v_username from profiles where id = auth.uid();
  v_avail := format_pickup_availability(v_mode, v_date, v_start, v_end);
  v_lines := array[
    '📍 Exchange confirmed! Here''s how to connect:',
    '👤 ' || coalesce(v_username, ''),
    '📌 ' || v_city || case when v_state <> '' then ', ' || v_state else '' end
  ];
  if v_address <> '' or v_unit <> '' then
    v_lines := v_lines || ('🏠 ' || concat_ws(' ', nullif(v_address, ''), nullif(v_unit, '')));
  end if;
  if v_pickup <> '' then v_lines := v_lines || ('📦 Pickup: ' || v_pickup); end if;
  if v_avail is not null then v_lines := v_lines || ('🕐 ' || v_avail); end if;

  insert into messages (conversation_id, sender_id, body, kind)
  values (p_conversation_id, auth.uid(), array_to_string(v_lines, E'\n'), 'confirmation');
  return 'ok';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function confirm_exchange(uuid, jsonb) to authenticated;

create or replace function deny_request(p_conversation_id uuid)
returns text as $$
declare v_conv conversations%rowtype;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if not found or v_conv.seller_id is distinct from auth.uid() then return 'not_allowed'; end if;
  if v_conv.exchange_status <> 'requested' then return 'wrong_status'; end if;

  perform create_notification(v_conv.buyer_id, 'purchase_decision', p_conversation_id);
  update conversations set exchange_status = 'declined', completed_at = now() where id = p_conversation_id;
  update listings set status = 'active' where id = v_conv.listing_id and status = 'pending';
  update notifications set read = true
  where user_id = auth.uid() and entity_id = p_conversation_id and type = 'purchase_request';
  return 'ok';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function deny_request(uuid) to authenticated;
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run supabase/tests/exchangeConfirm.test.ts`
Expected: PASS (10 tests). If a `format_pickup_availability` parity case fails only on spacing (e.g. a narrow no-break space before AM/PM from the Node locale), make the SQL match whatever `formatPickupAvailability` actually returns, since that is what buyers see today.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql supabase/tests/exchangeConfirm.test.ts
git commit -m "Add confirm_exchange and deny_request with SQL-built confirmation message"
```

---

### Task 9: Website confirms and declines through the functions

**Files:**
- Modify: `app/profile/actions.ts` (`confirmExchange`, `denyPurchase`), `app/profile/actions.test.ts` (`confirmExchange` describe block)
- Delete: `lib/buildConfirmationMessage.ts`, `lib/buildConfirmationMessage.test.ts`

**Interfaces:**
- Consumes: `confirm_exchange`, `deny_request` (Task 8); `isValidStateCode` from `lib/usStates.ts`.

- [ ] **Step 1: Replace the `confirmExchange` tests**

In `app/profile/actions.test.ts` replace the whole `describe('confirmExchange', …)` block with the block below, and add `rpc: rpcMock` to the mocked client (keeping the `rpc` for `get_my_profile` from Task 3 — route by function name):

```ts
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = []
// in the mocked client:
//   rpc: (fn: string, args: Record<string, unknown>) => {
//     if (fn === 'get_my_profile') return { maybeSingle: () => Promise.resolve(selectResult) }
//     rpcCalls.push({ fn, args }); return Promise.resolve({ data: 'ok', error: null })
//   },

describe('confirmExchange', () => {
  beforeEach(() => { rpcCalls.length = 0 })

  const fields = {
    conversation_id: 'convo-1', address: ' 1 Main St ', address_unit: '', city: 'Springfield', state: 'IL',
    pickup: 'front porch', pickup_mode: 'window', pickup_date: '2026-11-12', pickup_time_start: '15:05', pickup_time_end: '17:00',
  }

  it('sends the pickup details to confirm_exchange and returns to Exchanges', async () => {
    await expect(confirmExchange(buildFormData(fields))).rejects.toThrow('REDIRECT:/profile?tab=exchanges')
    expect(rpcCalls).toEqual([{ fn: 'confirm_exchange', args: {
      p_conversation_id: 'convo-1',
      p_pickup: {
        address: '1 Main St', address_unit: '', city: 'Springfield', state: 'IL', pickup: 'front porch',
        pickup_mode: 'window', pickup_date: '2026-11-12', pickup_time_start: '15:05', pickup_time_end: '17:00',
      },
    } }])
  })

  it('drops a state that is not a real state code', async () => {
    await expect(confirmExchange(buildFormData({ ...fields, state: 'ZZ' }))).rejects.toThrow('REDIRECT:')
    expect((rpcCalls[0].args.p_pickup as Record<string, string>).state).toBe('')
  })
})
```

Delete the old `conversationsUpdateMock`, `notificationsUpdateMock`, `listingsUpdateMock`, `messagesInsertMock` declarations and their `fromMock` cases if nothing else uses them.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run app/profile/actions.test.ts`
Expected: FAIL — `confirm_exchange` not called.

- [ ] **Step 3: Rewrite `confirmExchange` and `denyPurchase`**

Replace the body of `confirmExchange` after the `if (!user) redirect('/auth/signin')` line with:

```ts
  const conversationId = formData.get('conversation_id') as string
  const text = (key: string) => ((formData.get(key) as string) || '').trim()
  const rawState = text('state')

  // These come from the seller's confirm-and-review popup — a one-time
  // override for this exchange only. confirm_exchange (supabase/schema.sql,
  // shared backend 4/6) validates the pickup time, stores it, marks the
  // listing sold and posts the confirmation message.
  await supabase.rpc('confirm_exchange', {
    p_conversation_id: conversationId,
    p_pickup: {
      address: text('address'),
      address_unit: text('address_unit'),
      city: text('city'),
      state: isValidStateCode(rawState) ? rawState : '',
      pickup: text('pickup'),
      pickup_mode: text('pickup_mode'),
      pickup_date: text('pickup_date'),
      pickup_time_start: text('pickup_time_start'),
      pickup_time_end: text('pickup_time_end'),
    },
  })

  redirect('/profile?tab=exchanges')
```

Replace the body of `denyPurchase` after `const conversationId = formData.get('conversation_id') as string` with:

```ts
  await supabase.rpc('deny_request', { p_conversation_id: conversationId })

  redirect('/profile?tab=exchanges')
```

Remove now-unused imports from `app/profile/actions.ts` (`buildConfirmationMessage`, and `formatPickupAvailability` if unused there).

- [ ] **Step 4: Delete the TypeScript message builder**

Run (Bash): `grep -rn "buildConfirmationMessage" app lib components`
Expected: only `lib/buildConfirmationMessage.ts` and its test. Then:

```bash
git rm lib/buildConfirmationMessage.ts lib/buildConfirmationMessage.test.ts
```

- [ ] **Step 5: Run tests and type-check**

Run: `npx vitest run` — Expected: PASS.
Run: `npx tsc --noEmit` — Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A app/profile lib
git commit -m "Confirm and decline requests through database functions"
```

---

### Task 10: Pickup, dispute, hide, support, saved→TBR functions (SQL block 5/6)

**Files:**
- Modify: `supabase/schema.sql` (append block)
- Test: `supabase/tests/exchangePickup.test.ts`

**Interfaces:**
- Produces (SQL):
  - column `disputes.admin_notified_at timestamptz` (null until the admin email is sent)
  - `mark_picked_up(p_conversation_id uuid) returns text` → `'not_allowed'|'wrong_status'|'already_marked'` or whatever `resolve_pickup` returns (`'waiting'`, `'completed_manual'`, `'blocked_dispute'`, …)
  - `file_dispute(p_conversation_id uuid, p_message text) returns jsonb` → `{status:'ok', id}` | `{status:'not_allowed'|'empty_message'|'already_open'}`
  - `hide_exchange(p_conversation_id uuid) returns text` → `'ok'|'not_allowed'`
  - `start_support_conversation() returns jsonb` → `{status:'ok', id}` | `{status:'not_allowed'}`
  - `move_saved_to_tbr(p_listing_id uuid) returns text` → `'ok'|'not_allowed'|'not_found'`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/exchangePickup.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, createUser, seedListing, call, credits } from './harness'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)

async function confirmed(opts: { bundleBooks?: number; buyerCredits?: number } = {}) {
  const seller = await createUser(db, { username: `seller_${Math.random().toString(36).slice(2, 8)}` })
  const buyer = await createUser(db, { credits: opts.buyerCredits ?? 1 })
  const listing = await seedListing(db, seller, { bundleBooks: opts.bundleBooks })
  const { id } = await call<{ id: string }>(db, buyer, 'request_book($1)', [listing])
  await call(db, seller, 'confirm_exchange($1, $2::jsonb)', [id, JSON.stringify({ pickup_mode: 'anytime', city: 'Springfield' })])
  return { seller, buyer, listing, convo: id }
}
const status = async (id: string) => (await db.query<{ exchange_status: string }>('select exchange_status from conversations where id = $1', [id])).rows[0].exchange_status

describe('mark_picked_up', () => {
  it('waits for the other side, then completes and moves credits exactly once', async () => {
    const { seller, buyer, convo } = await confirmed({ bundleBooks: 1, buyerCredits: 2 })
    expect(await call(db, buyer, 'mark_picked_up($1)', [convo])).toBe('waiting')
    expect(await call(db, buyer, 'mark_picked_up($1)', [convo])).toBe('already_marked')
    const pickupMsgs = (await db.query(`select id from messages where conversation_id = $1 and kind = 'pickup'`, [convo])).rows
    expect(pickupMsgs).toHaveLength(1)
    expect(await call(db, seller, 'mark_picked_up($1)', [convo])).toBe('completed_manual')
    expect(await call(db, seller, 'mark_picked_up($1)', [convo])).toBe('wrong_status')
    expect(await status(convo)).toBe('completed')
    expect(await credits(db, buyer)).toBe(0)
    expect(await credits(db, seller)).toBe(2)
  })

  it('refuses strangers and exchanges that are not confirmed', async () => {
    const { convo } = await confirmed()
    const stranger = await createUser(db)
    expect(await call(db, stranger, 'mark_picked_up($1)', [convo])).toBe('not_allowed')
    const seller = await createUser(db)
    const buyer = await createUser(db, { credits: 1 })
    const listing = await seedListing(db, seller)
    const { id } = await call<{ id: string }>(db, buyer, 'request_book($1)', [listing])
    expect(await call(db, buyer, 'mark_picked_up($1)', [id])).toBe('wrong_status')
  })
})

describe('file_dispute', () => {
  it('files one open dispute per exchange and blocks completion', async () => {
    const { seller, buyer, convo } = await confirmed()
    const r = await call<{ status: string; id: string }>(db, buyer, 'file_dispute($1, $2)', [convo, '  Book never left out  '])
    expect(r.status).toBe('ok')
    const row = (await db.query<{ message: string; admin_notified_at: string | null }>('select message, admin_notified_at from disputes where id = $1', [r.id])).rows[0]
    expect(row).toEqual({ message: 'Book never left out', admin_notified_at: null })
    expect(await call(db, seller, 'file_dispute($1, $2)', [convo, 'Second'])).toEqual({ status: 'already_open' })
    await call(db, buyer, 'mark_picked_up($1)', [convo])
    expect(await call(db, seller, 'mark_picked_up($1)', [convo])).toBe('blocked_dispute')
  })

  it('refuses an empty message and strangers', async () => {
    const { buyer, convo } = await confirmed()
    const stranger = await createUser(db)
    expect(await call(db, buyer, 'file_dispute($1, $2)', [convo, '   '])).toEqual({ status: 'empty_message' })
    expect(await call(db, stranger, 'file_dispute($1, $2)', [convo, 'hi'])).toEqual({ status: 'not_allowed' })
  })
})

describe('hide_exchange', () => {
  it("hides only the caller's own side", async () => {
    const { buyer, convo } = await confirmed()
    expect(await call(db, buyer, 'hide_exchange($1)', [convo])).toBe('ok')
    const row = (await db.query('select buyer_hidden, seller_hidden from conversations where id = $1', [convo])).rows[0]
    expect(row).toEqual({ buyer_hidden: true, seller_hidden: false })
    expect(await call(db, await createUser(db), 'hide_exchange($1)', [convo])).toBe('not_allowed')
  })
})

describe('start_support_conversation', () => {
  it('creates one support thread and reuses it', async () => {
    const me = await createUser(db)
    const a = await call<{ status: string; id: string }>(db, me, 'start_support_conversation()')
    const b = await call<{ status: string; id: string }>(db, me, 'start_support_conversation()')
    expect(a.status).toBe('ok')
    expect(b.id).toBe(a.id)
    expect(await call(db, null, 'start_support_conversation()')).toEqual({ status: 'not_allowed' })
  })
})

describe('move_saved_to_tbr', () => {
  it('copies the listing into To-Be-Read and unsaves it in one step', async () => {
    const seller = await createUser(db)
    const me = await createUser(db)
    const listing = await seedListing(db, seller, { title: 'Emma', author: 'Jane Austen' })
    await db.query('insert into saved_listings (user_id, listing_id) values ($1, $2)', [me, listing])
    expect(await call(db, me, 'move_saved_to_tbr($1)', [listing])).toBe('ok')
    expect((await db.query('select title, author from tbr_entries where user_id = $1', [me])).rows).toEqual([{ title: 'Emma', author: 'Jane Austen' }])
    expect((await db.query('select id from saved_listings where user_id = $1', [me])).rows).toHaveLength(0)
    expect(await call(db, me, 'move_saved_to_tbr($1)', ['00000000-0000-0000-0000-000000000000'])).toBe('not_found')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run supabase/tests/exchangePickup.test.ts`
Expected: FAIL — `function mark_picked_up(unknown) does not exist`.

- [ ] **Step 3: Append SQL block 5 to `supabase/schema.sql`**

```sql

-- ── Migration: shared backend 5/6 — pickup, disputes, history, support, TBR ──
-- Run this block in Supabase SQL Editor:

-- Set (by the server, service role) once the admins have been emailed about a
-- dispute, so the app's notify endpoint can't be used to spam them.
alter table disputes add column if not exists admin_notified_at timestamptz;

create or replace function mark_picked_up(p_conversation_id uuid)
returns text as $$
declare
  v_conv conversations%rowtype;
  v_result text;
  v_username text;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if not found or auth.uid() is null or auth.uid() not in (v_conv.buyer_id, v_conv.seller_id) then
    return 'not_allowed';
  end if;
  if v_conv.exchange_status <> 'confirmed' then return 'wrong_status'; end if;

  if auth.uid() = v_conv.seller_id then
    if v_conv.seller_picked_up_at is not null then return 'already_marked'; end if;
    update conversations set seller_picked_up_at = now() where id = p_conversation_id;
  else
    if v_conv.buyer_picked_up_at is not null then return 'already_marked'; end if;
    update conversations set buyer_picked_up_at = now() where id = p_conversation_id;
  end if;

  -- resolve_pickup completes the exchange (and so moves credits) only when its
  -- own rules say so: both sides marked, no open dispute.
  v_result := resolve_pickup(p_conversation_id, auth.uid());
  if v_result = 'waiting' then
    select username into v_username from profiles where id = auth.uid();
    insert into messages (conversation_id, sender_id, body, kind)
    values (p_conversation_id, auth.uid(),
            '📦 ' || coalesce(v_username, 'They') || ' marked this picked up! Please confirm on your end within 48 hours.',
            'pickup');
  end if;
  return v_result;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function mark_picked_up(uuid) to authenticated;

create or replace function file_dispute(p_conversation_id uuid, p_message text)
returns jsonb as $$
declare
  v_conv conversations%rowtype;
  v_id uuid;
begin
  select * into v_conv from conversations where id = p_conversation_id;
  if not found or auth.uid() is null or auth.uid() not in (v_conv.buyer_id, v_conv.seller_id) then
    return jsonb_build_object('status', 'not_allowed');
  end if;
  if btrim(coalesce(p_message, '')) = '' then return jsonb_build_object('status', 'empty_message'); end if;
  if exists (select 1 from disputes where conversation_id = p_conversation_id and status = 'open') then
    return jsonb_build_object('status', 'already_open');
  end if;
  insert into disputes (conversation_id, reporter_id, message)
  values (p_conversation_id, auth.uid(), btrim(p_message))
  returning id into v_id;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function file_dispute(uuid, text) to authenticated;

create or replace function hide_exchange(p_conversation_id uuid)
returns text as $$
begin
  update conversations set
    buyer_hidden  = buyer_hidden  or buyer_id  = auth.uid(),
    seller_hidden = seller_hidden or seller_id = auth.uid()
  where id = p_conversation_id and auth.uid() in (buyer_id, seller_id);
  if not found then return 'not_allowed'; end if;
  return 'ok';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function hide_exchange(uuid) to authenticated;

create or replace function start_support_conversation()
returns jsonb as $$
declare v_id uuid;
begin
  if auth.uid() is null then return jsonb_build_object('status', 'not_allowed'); end if;
  select id into v_id from conversations
  where type = 'admin' and user_id = auth.uid() and repliable = true
  order by created_at desc limit 1;
  if v_id is null then
    insert into conversations (type, user_id, repliable) values ('admin', auth.uid(), true)
    returning id into v_id;
  end if;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function start_support_conversation() to authenticated;

create or replace function move_saved_to_tbr(p_listing_id uuid)
returns text as $$
declare v_listing listings%rowtype;
begin
  if auth.uid() is null then return 'not_allowed'; end if;
  select * into v_listing from listings where id = p_listing_id;
  if not found then return 'not_found'; end if;
  insert into tbr_entries (user_id, title, author, city, state)
  values (auth.uid(), v_listing.title, v_listing.author, coalesce(v_listing.city, ''), '');
  delete from saved_listings where user_id = auth.uid() and listing_id = p_listing_id;
  return 'ok';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
grant execute on function move_saved_to_tbr(uuid) to authenticated;
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run supabase/tests/exchangePickup.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql supabase/tests/exchangePickup.test.ts
git commit -m "Add mark_picked_up, file_dispute, hide_exchange, support and saved-to-TBR functions"
```

---

### Task 11: Website pickup, dispute, hide, support and saved→TBR through the functions

**Files:**
- Create: `lib/disputes/notifyAdmins.ts`, `lib/disputes/notifyAdmins.test.ts`
- Modify: `app/profile/actions.ts` (`markPickedUp`, `fileDispute`, `hideExchangeHistory`, `startSupportConversation`), `lib/actions/savedListings.ts` (`moveSavedListingToTbr`), `app/profile/markPickedUp.test.ts`, `lib/actions/savedListings.test.ts`

**Interfaces:**
- Consumes: Task 10 functions; `createServiceRoleClient` (`lib/supabase/serviceRole.ts`); `sendEmail` (`lib/email/resend.ts`).
- Produces: `notifyAdminsOfDispute(disputeId: string): Promise<boolean>` — true when this call sent the email; false when already sent or not found. Server-only.

- [ ] **Step 1: Write the failing `notifyAdminsOfDispute` test**

Create `lib/disputes/notifyAdmins.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notifyAdminsOfDispute } from './notifyAdmins'

vi.mock('server-only', () => ({}))
const sendEmail = vi.fn((_: { to: string; subject: string; text: string }) => Promise.resolve({ ok: true }))
vi.mock('@/lib/email/resend', () => ({ sendEmail: (m: { to: string; subject: string; text: string }) => sendEmail(m) }))

let claimed: { id: string; message: string; conversation_id: string } | null
const tables: Record<string, unknown> = {
  disputes: { update: () => ({ eq: () => ({ is: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: claimed }) }) }) }) }) },
  conversations: { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { listing_id: 'listing-1' } }) }) }) },
  listings: { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { title: 'Dune' } }) }) }) },
  profiles: { select: () => ({ eq: () => Promise.resolve({ data: [{ email: 'admin@example.com' }, { email: null }] }) }) },
}
vi.mock('@/lib/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({ from: (t: string) => tables[t] }) }))

describe('notifyAdminsOfDispute', () => {
  beforeEach(() => { sendEmail.mockClear() })

  it('emails every admin once with the book title and message', async () => {
    claimed = { id: 'd-1', message: 'Book never left out', conversation_id: 'convo-1' }
    expect(await notifyAdminsOfDispute('d-1')).toBe(true)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledWith({
      to: 'admin@example.com',
      subject: 'Dispute filed: Dune',
      text: 'A dispute was filed on an exchange.\n\nMessage:\nBook never left out\n\nConversation ID: convo-1',
    })
  })

  it('sends nothing when the email already went out', async () => {
    claimed = null
    expect(await notifyAdminsOfDispute('d-1')).toBe(false)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/disputes/notifyAdmins.test.ts`
Expected: FAIL — `Cannot find module './notifyAdmins'`.

- [ ] **Step 3: Write `lib/disputes/notifyAdmins.ts`**

```ts
import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { sendEmail } from '@/lib/email/resend'

// Emails every admin about a newly filed dispute — at most once per dispute:
// admin_notified_at is claimed atomically before sending, so a retry (or the
// app calling /api/disputes/notify twice) can't send it again. Best-effort:
// the dispute row itself is what freezes the exchange.
export async function notifyAdminsOfDispute(disputeId: string): Promise<boolean> {
  const admin = createServiceRoleClient()
  const { data: claimed } = await admin
    .from('disputes')
    .update({ admin_notified_at: new Date().toISOString() })
    .eq('id', disputeId)
    .is('admin_notified_at', null)
    .select('id, message, conversation_id')
    .maybeSingle()
  if (!claimed) return false

  const { data: convo } = await admin.from('conversations').select('listing_id').eq('id', claimed.conversation_id).single()
  const { data: listing } = convo?.listing_id
    ? await admin.from('listings').select('title').eq('id', convo.listing_id).single()
    : { data: null }
  const { data: admins } = await admin.from('profiles').select('email').eq('is_admin', true)

  for (const a of admins ?? []) {
    if (!a.email) continue
    await sendEmail({
      to: a.email,
      subject: `Dispute filed: ${listing?.title ?? 'an exchange'}`,
      text: `A dispute was filed on an exchange.\n\nMessage:\n${claimed.message}\n\nConversation ID: ${claimed.conversation_id}`,
    })
  }
  return true
}
```

Run: `npx vitest run lib/disputes/notifyAdmins.test.ts` — Expected: PASS.

- [ ] **Step 4: Update the `markPickedUp` test to the RPC**

In `app/profile/markPickedUp.test.ts`, replace the mocked client so that `rpc` records calls and returns `rpcResult`, and `from` is no longer needed:

```ts
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = []
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => (createClientMock(), {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
    rpc: (fn: string, args: Record<string, unknown>) => { rpcCalls.push({ fn, args }); return Promise.resolve({ data: rpcResult }) },
  }),
}))
```

Delete the `updated` variable and `convoChain`. Keep the existing tests that assert `revalidate:/:layout` happens before the redirect when `rpcResult = 'completed_manual'` and does not happen for `'waiting'`; add:

```ts
  it('marks the pickup through mark_picked_up', async () => {
    rpcResult = 'waiting'
    await expect(markPickedUp(form())).rejects.toThrow('REDIRECT:/profile?tab=exchanges')
    expect(rpcCalls.at(-1)).toEqual({ fn: 'mark_picked_up', args: { p_conversation_id: 'convo-1' } })
  })
```

Run: `npx vitest run app/profile/markPickedUp.test.ts` — Expected: FAIL (action still uses `from('conversations')`).

- [ ] **Step 5: Rewrite the profile actions**

In `app/profile/actions.ts`:

`markPickedUp` — replace everything from `const conversationId = formData.get('conversation_id') as string` (after the auth check) to the end of the function with:

```ts
  const conversationId = formData.get('conversation_id') as string
  const { data: result } = await supabase.rpc('mark_picked_up', { p_conversation_id: conversationId })

  // Completing moves credits; the root layout reads them (and the unseen
  // ones the nav's coin show plays), and a redirect alone doesn't
  // re-render that layout.
  if (typeof result === 'string' && result.startsWith('completed_')) revalidatePath('/', 'layout')

  redirect('/profile?tab=exchanges')
}
```

`fileDispute` — replace everything after `if (!message) return { ok: false, error: 'Please describe the issue.' }` with:

```ts
  const { data, error } = await supabase.rpc('file_dispute', { p_conversation_id: conversationId, p_message: message })
  const result = data as { status: string; id?: string } | null
  if (error || !result) return { ok: false, error: 'Could not file the dispute. Please try again.' }
  if (result.status === 'not_allowed') return { ok: false, error: 'Exchange not found.' }
  if (result.status === 'already_open') return { ok: false, error: 'A dispute is already open for this exchange.' }
  if (result.status !== 'ok' || !result.id) return { ok: false, error: 'Could not file the dispute. Please try again.' }

  // Best-effort admin alert — the dispute row is what actually freezes the exchange.
  try { await notifyAdminsOfDispute(result.id) } catch {}

  return { ok: true }
}
```

and add `import { notifyAdminsOfDispute } from '@/lib/disputes/notifyAdmins'` at the top.

`hideExchangeHistory` — replace the `await supabase.from('conversations').update(…)…` statement (and the now-unused `role` line) with:

```ts
  await supabase.rpc('hide_exchange', { p_conversation_id: conversationId })
```

`startSupportConversation` — replace everything after the `if (!user) …` line with:

```ts
  const { data, error } = await supabase.rpc('start_support_conversation')
  const result = data as { status: string; id?: string } | null
  if (error || result?.status !== 'ok' || !result.id) {
    return { ok: false, error: 'Could not start a support conversation. Please try again.' }
  }
  return { ok: true, conversationId: result.id }
}
```

- [ ] **Step 6: Rewrite `moveSavedListingToTbr`**

In `lib/actions/savedListings.ts` replace everything in `moveSavedListingToTbr` between `const listingId = formData.get('listing_id') as string` and the final `redirect('/profile?tab=saved')` with:

```ts
  // One transaction: if adding to TBR fails, the saved listing is kept.
  await supabase.rpc('move_saved_to_tbr', { p_listing_id: listingId })
```

In `lib/actions/savedListings.test.ts`, change the `moveSavedListingToTbr` tests' mock to provide `rpc` and replace the three data-path tests with:

```ts
  it('moves the listing to TBR through move_saved_to_tbr', async () => {
    await expect(moveSavedListingToTbr(form({ listing_id: 'listing-1' }))).rejects.toThrow('REDIRECT:/profile?tab=saved')
    expect(rpcMock).toHaveBeenCalledWith('move_saved_to_tbr', { p_listing_id: 'listing-1' })
  })
```

(declare `const rpcMock = vi.fn((_f: string, _a: Record<string, unknown>) => Promise.resolve({ data: 'ok', error: null }))` and add `rpc: (f: string, a: Record<string, unknown>) => rpcMock(f, a)` to the mocked client; use the file's existing FormData helper name in place of `form` if it differs). Keep the "redirects to sign in when not authenticated" test.

- [ ] **Step 7: Run tests and type-check**

Run: `npx vitest run` — Expected: PASS.
Run: `npx tsc --noEmit` — Expected: no errors (remove any imports left unused).

- [ ] **Step 8: Commit**

```bash
git add -A app/profile lib
git commit -m "Pickup, disputes, hiding, support and saved-to-TBR through database functions"
```

---

### Task 12: Vercel endpoints for the app (username sign-in, dispute email)

**Files:**
- Create: `lib/supabase/fromBearer.ts`, `lib/auth/usernameLookup.ts`, `app/api/auth/username-signin/route.ts`, `app/api/auth/username-signin/route.test.ts`, `app/api/disputes/notify/route.ts`, `app/api/disputes/notify/route.test.ts`
- Modify: `app/auth/signin/page.tsx` (username lookup)

**Interfaces:**
- Consumes: `notifyAdminsOfDispute` (Task 11), `createServiceRoleClient`.
- Produces:
  - `userFromBearer(request: Request): Promise<{ supabase: SupabaseClient; user: User } | null>`
  - `lookupEmailForUsername(username: string): Promise<string | null>`
  - `POST /api/auth/username-signin` body `{ username, password }` → 200 `{ access_token, refresh_token, expires_at }` | 400 `{ error: 'Enter your username and password.' }` | 401 `{ error: 'Wrong username or password.' }`
  - `POST /api/disputes/notify` header `Authorization: Bearer <access token>`, body `{ dispute_id }` → 200 `{ sent: boolean }` | 401 | 404

- [ ] **Step 1: Write the failing endpoint tests**

Create `app/api/auth/username-signin/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

vi.mock('server-only', () => ({}))
let email: string | null = 'sally@example.com'
vi.mock('@/lib/auth/usernameLookup', () => ({ lookupEmailForUsername: () => Promise.resolve(email) }))
let signIn: { data: { session: unknown }; error: unknown }
const signInMock = vi.fn((_: { email: string; password: string }) => Promise.resolve(signIn))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { signInWithPassword: (c: { email: string; password: string }) => signInMock(c) } }) }))

const req = (body: unknown) => new Request('http://x/api/auth/username-signin', { method: 'POST', body: JSON.stringify(body) })

describe('POST /api/auth/username-signin', () => {
  beforeEach(() => {
    email = 'sally@example.com'
    signIn = { data: { session: { access_token: 'a', refresh_token: 'r', expires_at: 123 } }, error: null }
    signInMock.mockClear()
  })

  it('signs in with the email behind the username and returns the session tokens', async () => {
    const res = await POST(req({ username: 'sally', password: 'pw' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ access_token: 'a', refresh_token: 'r', expires_at: 123 })
    expect(signInMock).toHaveBeenCalledWith({ email: 'sally@example.com', password: 'pw' })
  })

  it('gives the same answer for an unknown username and a wrong password', async () => {
    email = null
    const unknown = await POST(req({ username: 'nobody', password: 'pw' }))
    email = 'sally@example.com'
    signIn = { data: { session: null }, error: { message: 'Invalid login credentials' } }
    const wrong = await POST(req({ username: 'sally', password: 'bad' }))
    expect(unknown.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(await unknown.json()).toEqual(await wrong.json())
  })

  it('never returns the email address', async () => {
    const res = await POST(req({ username: 'sally', password: 'pw' }))
    expect(JSON.stringify(await res.json())).not.toContain('sally@example.com')
  })

  it('rejects a missing username or password', async () => {
    expect((await POST(req({ username: '' }))).status).toBe(400)
  })
})
```

Create `app/api/disputes/notify/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

vi.mock('server-only', () => ({}))
const notify = vi.fn((_: string) => Promise.resolve(true))
vi.mock('@/lib/disputes/notifyAdmins', () => ({ notifyAdminsOfDispute: (id: string) => notify(id) }))
let auth: { user: { id: string }; supabase: unknown } | null
let ownDispute: { id: string } | null
vi.mock('@/lib/supabase/fromBearer', () => ({ userFromBearer: () => Promise.resolve(auth) }))

const req = (body: unknown) => new Request('http://x/api/disputes/notify', { method: 'POST', body: JSON.stringify(body), headers: { authorization: 'Bearer t' } })

describe('POST /api/disputes/notify', () => {
  beforeEach(() => {
    notify.mockClear()
    ownDispute = { id: 'd-1' }
    auth = {
      user: { id: 'buyer-1' },
      supabase: { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: ownDispute }) }) }) }) }) },
    }
  })

  it('emails the admins about a dispute the caller filed', async () => {
    const res = await POST(req({ dispute_id: 'd-1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: true })
    expect(notify).toHaveBeenCalledWith('d-1')
  })

  it('refuses a caller without a valid token', async () => {
    auth = null
    expect((await POST(req({ dispute_id: 'd-1' }))).status).toBe(401)
    expect(notify).not.toHaveBeenCalled()
  })

  it("refuses a dispute the caller didn't file", async () => {
    ownDispute = null
    expect((await POST(req({ dispute_id: 'd-1' }))).status).toBe(404)
    expect(notify).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run app/api`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the helpers**

`lib/supabase/fromBearer.ts`:

```ts
import 'server-only'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'

// For API routes the iPhone app calls with its Supabase access token
// (`Authorization: Bearer <token>`). The returned client acts as that user,
// so row-level security applies exactly as it does in the app itself.
export async function userFromBearer(request: Request): Promise<{ supabase: SupabaseClient; user: User } | null> {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  if (!token) return null
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user } } = await supabase.auth.getUser(token)
  return user ? { supabase, user } : null
}
```

`lib/auth/usernameLookup.ts`:

```ts
import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

// Emails are hidden from public reads (shared backend 6/6), so signing in by
// username needs the service role to find the address. Never send the
// result back to a browser or app.
export async function lookupEmailForUsername(username: string): Promise<string | null> {
  const { data } = await createServiceRoleClient()
    .from('profiles').select('email').eq('username', username).maybeSingle()
  return data?.email ?? null
}
```

- [ ] **Step 4: Write the routes**

`app/api/auth/username-signin/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { lookupEmailForUsername } from '@/lib/auth/usernameLookup'

const WRONG = { error: 'Wrong username or password.' }

// The iPhone app's "sign in with username". Email sign-in goes straight to
// Supabase Auth; this exists only because the username → email lookup needs
// the service role. Returns session tokens for supabase.auth.setSession().
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!username || !password) return NextResponse.json({ error: 'Enter your username and password.' }, { status: 400 })

  const email = await lookupEmailForUsername(username)
  if (!email) return NextResponse.json(WRONG, { status: 401 })

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.session) return NextResponse.json(WRONG, { status: 401 })

  const { access_token, refresh_token, expires_at } = data.session
  return NextResponse.json({ access_token, refresh_token, expires_at })
}
```

`app/api/disputes/notify/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { userFromBearer } from '@/lib/supabase/fromBearer'
import { notifyAdminsOfDispute } from '@/lib/disputes/notifyAdmins'

// Called by the iPhone app right after file_dispute succeeds. The website
// calls notifyAdminsOfDispute directly from its server action instead.
export async function POST(request: Request) {
  const auth = await userFromBearer(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const disputeId = typeof body.dispute_id === 'string' ? body.dispute_id : ''
  const { data: own } = await auth.supabase
    .from('disputes').select('id').eq('id', disputeId).eq('reporter_id', auth.user.id).maybeSingle()
  if (!own) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const sent = await notifyAdminsOfDispute(disputeId)
  return NextResponse.json({ sent })
}
```

- [ ] **Step 5: Run the endpoint tests**

Run: `npx vitest run app/api`
Expected: PASS (7 tests).

- [ ] **Step 6: Switch the website sign-in page**

In `app/auth/signin/page.tsx`, replace

```ts
        const { data: profile } = await supabase
          .from('profiles').select('email').eq('username', identifier).single()
        if (!profile?.email) go(`/auth/signin?error=${encodeURIComponent('No account found with that username.')}`)
        email = profile!.email
```

with:

```ts
        const { lookupEmailForUsername } = await import('@/lib/auth/usernameLookup')
        const found = await lookupEmailForUsername(identifier)
        if (!found) go(`/auth/signin?error=${encodeURIComponent('No account found with that username.')}`)
        email = found!
```

- [ ] **Step 7: Type-check, test, commit**

Run: `npx tsc --noEmit` — Expected: no errors.
Run: `npx vitest run` — Expected: PASS.

```bash
git add lib/supabase/fromBearer.ts lib/auth app/api app/auth/signin/page.tsx
git commit -m "Add username sign-in and dispute-notify endpoints for the app"
```

---

### Task 13: Lockdown (SQL block 6/6) and security tests

**Files:**
- Modify: `supabase/schema.sql` (append block)
- Test: `supabase/tests/lockdown.test.ts`, `lib/noDirectWrites.test.ts`

**Interfaces:**
- Consumes: everything above. After this block: members cannot insert/update/delete `conversations`, `listings`, `listing_books` or `disputes` directly; can insert only `kind = 'chat'` messages; can upload only into their own photo folder; can read only `id, username, city, state, created_at, is_admin` of `profiles`; cannot call `lock_listing_for_request`.

- [ ] **Step 1: Write the failing security tests**

Create `supabase/tests/lockdown.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, createUser, seedListing, seedConversation, asUser, call, credits } from './harness'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)

async function confirmedExchange() {
  const seller = await createUser(db)
  const buyer = await createUser(db, { credits: 1 })
  const listing = await seedListing(db, seller)
  const { id } = await call<{ id: string }>(db, buyer, 'request_book($1)', [listing])
  await call(db, seller, 'confirm_exchange($1, $2::jsonb)', [id, JSON.stringify({ pickup_mode: 'anytime' })])
  return { seller, buyer, listing, convo: id }
}

describe('the exchange-status hole is closed', () => {
  it('a seller cannot mark their own exchange completed to take the buyer credits', async () => {
    const { seller, buyer, convo } = await confirmedExchange()
    await expect(asUser(db, seller, `update conversations set exchange_status = 'completed' where id = $1 returning id`, [convo]))
      .resolves.toEqual([])
    expect(await credits(db, buyer)).toBe(1)
    expect(await credits(db, seller)).toBe(0)
  })

  it('nobody can create, edit or delete exchanges, listings, bundle books or disputes directly', async () => {
    const { seller, buyer, listing, convo } = await confirmedExchange()
    const other = await seedListing(db, seller)
    await expect(asUser(db, buyer, `insert into conversations (listing_id, buyer_id, seller_id, exchange_status) values ($1, $2, $3, 'confirmed')`, [other, buyer, seller])).rejects.toThrow(/row-level security/)
    expect(await asUser(db, buyer, 'delete from conversations where id = $1 returning id', [convo])).toEqual([])
    await expect(asUser(db, seller, `insert into listings (user_id, title, author, condition) values ($1, 'a', 'b', 'Good')`, [seller])).rejects.toThrow(/row-level security/)
    expect(await asUser(db, seller, `update listings set status = 'active' where id = $1 returning id`, [listing])).toEqual([])
    await expect(asUser(db, seller, `insert into listing_books (listing_id, title, author) values ($1, 'x', 'y')`, [other])).rejects.toThrow(/row-level security/)
    await expect(asUser(db, buyer, `insert into disputes (conversation_id, reporter_id, message) values ($1, $2, 'x')`, [convo, buyer])).rejects.toThrow(/row-level security/)
  })

  it('members can send chat messages but not fake system messages', async () => {
    const { buyer, convo } = await confirmedExchange()
    expect(await asUser(db, buyer, `insert into messages (conversation_id, sender_id, body) values ($1, $2, 'hi') returning kind`, [convo, buyer])).toEqual([{ kind: 'chat' }])
    for (const kind of ['confirmation', 'pickup', 'purchase_request']) {
      await expect(asUser(db, buyer, `insert into messages (conversation_id, sender_id, body, kind) values ($1, $2, 'x', $3)`, [convo, buyer, kind])).rejects.toThrow(/row-level security/)
    }
  })

  it('a stranger cannot send messages into someone else exchange', async () => {
    const { convo } = await confirmedExchange()
    const stranger = await createUser(db)
    await expect(asUser(db, stranger, `insert into messages (conversation_id, sender_id, body) values ($1, $2, 'hi')`, [convo, stranger])).rejects.toThrow(/row-level security/)
  })

  it('lock_listing_for_request can no longer be called by members', async () => {
    const seller = await createUser(db)
    const member = await createUser(db)
    const listing = await seedListing(db, seller)
    await expect(asUser(db, member, 'select lock_listing_for_request($1)', [listing])).rejects.toThrow(/permission denied/)
  })
})

describe('photo uploads', () => {
  it('are allowed only into your own folder', async () => {
    const me = await createUser(db)
    const other = await createUser(db)
    await expect(asUser(db, me, `insert into storage.objects (bucket_id, name) values ('book-photos', $1)`, [`${me}/1-1.jpg`])).resolves.toEqual([])
    await expect(asUser(db, me, `insert into storage.objects (bucket_id, name) values ('book-photos', $1)`, [`${other}/1-1.jpg`])).rejects.toThrow(/row-level security/)
  })
})

describe('private profile data', () => {
  it('public profile columns stay readable, signed in or not', async () => {
    const someone = await createUser(db, { username: 'public_name', city: 'Springfield' })
    expect(await asUser(db, null, 'select username, city from profiles where id = $1', [someone])).toEqual([{ username: 'public_name', city: 'Springfield' }])
    expect(await asUser(db, await createUser(db), 'select username from profiles where id = $1', [someone])).toEqual([{ username: 'public_name' }])
  })

  it.each(['email', 'phone', 'address', 'address_unit', 'zip', 'credits', 'marketing_opt_out'])('hides %s from members and visitors', async (column) => {
    const member = await createUser(db)
    await expect(asUser(db, member, `select ${column} from profiles`)).rejects.toThrow(/permission denied/)
    await expect(asUser(db, null, `select ${column} from profiles`)).rejects.toThrow(/permission denied/)
  })

  it('hides private columns through joins too', async () => {
    const member = await createUser(db)
    await expect(asUser(db, member, 'select l.id, p.email from listings l join profiles p on p.id = l.user_id')).rejects.toThrow(/permission denied/)
  })

  it('members can still edit their own public and private details', async () => {
    const me = await createUser(db)
    expect(await asUser(db, me, `update profiles set city = 'Shelbyville', phone = '5551234567' where id = $1`, [me])).toEqual([])
    const { rows } = await db.query<{ city: string; phone: string }>('select city, phone from profiles where id = $1', [me])
    expect(rows[0]).toEqual({ city: 'Shelbyville', phone: '5551234567' })
  })

  it('the homepage stats still work for visitors', async () => {
    await expect(asUser(db, null, 'select * from home_top_readers()')).resolves.toBeDefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run supabase/tests/lockdown.test.ts`
Expected: FAIL — the seller's direct update returns a row, credits move, and `select email from profiles` succeeds.

- [ ] **Step 3: Append SQL block 6 to `supabase/schema.sql`**

```sql

-- ── Migration: shared backend 6/6 — lockdown ─────────────────────────────────
-- Run this block in Supabase SQL Editor ONLY AFTER the website using blocks
-- 1–5 is deployed. From here on members change exchanges, listings and
-- disputes only through the functions in blocks 2–5, and private profile
-- columns are readable only through get_my_profile() / admin_list_users().
-- Policies are dropped under both names they have had (schema.sql and the
-- older rls-policies.sql) since either may be live.

-- Exchanges: no direct member writes (admin policies stay).
drop policy if exists "Buyers can create conversations" on conversations;
drop policy if exists "create conversations as buyer" on conversations;
drop policy if exists "Participants can update conversations" on conversations;
drop policy if exists "update own conversations" on conversations;
drop policy if exists "buyer can cancel conversations" on conversations;
drop policy if exists "Sellers can deny conversations" on conversations;

-- Listings and bundle books: only via create/update/set_status/delete_listing.
drop policy if exists "Users can insert own listings" on listings;
drop policy if exists "Users can update own listings" on listings;
drop policy if exists "Users can delete own listings" on listings;
drop policy if exists "Owners can manage their listing's books" on listing_books;

-- Disputes: only via file_dispute (admins keep update/delete).
drop policy if exists "A participant can file a dispute on their own exchange" on disputes;

-- Messages: members send plain chat only; request/confirmation/pickup
-- messages come from the functions. Support-thread policy is unchanged.
drop policy if exists "Participants can send messages" on messages;
drop policy if exists "participants can send messages" on messages;
drop policy if exists "Participants can send chat messages" on messages;
create policy "Participants can send chat messages" on messages
  for insert with check (
    kind = 'chat'
    and auth.uid() = sender_id
    and exists (
      select 1 from conversations c
      where c.id = conversation_id and c.type = 'exchange'
        and auth.uid() in (c.buyer_id, c.seller_id)
    )
  );

-- Photos: only into your own folder (the path the site already uses).
drop policy if exists "Authenticated users can upload photos" on storage.objects;
drop policy if exists "Users can upload photos to their own folder" on storage.objects;
create policy "Users can upload photos to their own folder" on storage.objects
  for insert with check (
    bucket_id = 'book-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Folded into request_book.
revoke execute on function lock_listing_for_request(uuid) from public, anon, authenticated;

-- Profiles: only public columns are directly readable. is_admin stays
-- readable because many policies check it for the caller.
revoke select on profiles from anon, authenticated;
grant select (id, username, city, state, created_at, is_admin) on profiles to anon, authenticated;
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 4: Run all database tests**

Run: `npx vitest run supabase/tests`
Expected: PASS — the lockdown tests and every earlier database test (the functions still work with direct writes revoked).

- [ ] **Step 5: Write the "no direct writes left" source test**

Create `lib/noDirectWrites.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// After shared backend 6/6, members can't write these tables directly — any
// leftover direct write in website code would silently do nothing. Admin
// code (app/admin, lib/actions/admin*, emailAdmin) and service-role code
// are allowed.
const LOCKED = ['conversations', 'listings', 'listing_books', 'disputes']
const ALLOWED = [/app[\\/]admin[\\/]/, /lib[\\/]actions[\\/](admin|emailAdmin)\.ts$/, /lib[\\/]disputes[\\/]notifyAdmins\.ts$/, /app[\\/]api[\\/]cron[\\/]/]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

describe('website code', () => {
  it('never writes locked tables directly', () => {
    const offenders: string[] = []
    for (const file of [...sourceFiles('app'), ...sourceFiles('lib'), ...sourceFiles('components')]) {
      if (ALLOWED.some((re) => re.test(file))) continue
      const src = readFileSync(file, 'utf8')
      for (const table of LOCKED) {
        const re = new RegExp(`from\\('${table}'\\)[\\s\\S]{0,80}?\\.(insert|update|delete|upsert)\\(`, 'g')
        if (re.test(src)) offenders.push(`${file} → ${table}`)
      }
      if (/from\('messages'\)[\s\S]{0,120}?kind:\s*'(?!chat)/.test(src)) offenders.push(`${file} → messages (non-chat kind)`)
    }
    expect(offenders).toEqual([])
  })
})
```

Run: `npx vitest run lib/noDirectWrites.test.ts`
Expected: PASS. If it lists an offender, convert that call to the matching function from Tasks 4–10 (or, for a genuinely admin-only write, add its path to `ALLOWED` with a comment saying why).

- [ ] **Step 6: Full suite, type-check, commit**

Run: `npx vitest run` — Expected: PASS.
Run: `npx tsc --noEmit` — Expected: no errors.

```bash
git add supabase/schema.sql supabase/tests/lockdown.test.ts lib/noDirectWrites.test.ts
git commit -m "Lock down direct writes and private profile columns"
```

---

### Task 14: Roll out to Supabase and verify by hand

**Files:**
- Modify: `docs/superpowers/specs/2026-11-09-shared-backend-design.md` (status line)

This task is done **with the user**: they run the SQL in the Supabase SQL editor; the implementer prepares each block and checks results.

- [ ] **Step 1: Run blocks 1–5 in Supabase**

Ask the user to paste and run, in order, the five blocks headed `shared backend 1/6` … `5/6` from `supabase/schema.sql`. Each should finish with "Success. No rows returned".

- [ ] **Step 2: Build and deploy the website**

Run: `npx next build` — Expected: build succeeds.
Merge the `shared-backend` branch to `master` and push (Vercel deploys `master`), or deploy a preview with the vercel:deploy skill and test there first — ask the user which.

- [ ] **Step 3: Two-account walkthrough before lockdown**

On the deployed site with two test accounts (seller, buyer with ≥ 2 credits), check each and tick off:
1. Seller posts a single book with a photo, and a 2-book bundle; both open correctly.
2. Seller edits a listing (title change; photo kept), pauses it, reactivates it.
3. Buyer messages the seller (lands in Messages), then requests the single book (listing shows requested).
4. Buyer cancels; listing is active again. Buyer requests again.
5. Seller declines; buyer sees the decline in History. Buyer requests the bundle instead.
6. Seller confirms with a time window; the buyer sees the confirmation message with the pickup time.
7. Buyer marks picked up (seller gets the "marked this picked up" message); seller marks picked up; the coin show plays; balances moved by 2.
8. File a dispute on a second confirmed exchange; the admin gets one email.
9. Hide an exchange from History; Contact Support opens a support thread; move a saved listing to TBR.
10. Sign out and sign in **by username**.
11. Admin: Users tab shows emails; broadcast count works; location reports show reporter usernames.

- [ ] **Step 4: Run block 6 (lockdown)**

Ask the user to run the `shared backend 6/6 — lockdown` block. Then run this check in the SQL editor and confirm no member insert/update/delete policies remain on the locked tables:

```sql
select tablename, policyname, cmd from pg_policies
where tablename in ('conversations', 'listings', 'listing_books', 'disputes', 'messages')
order by tablename, cmd;
```

Expected: `conversations` only admin policies + participant `SELECT`; `listings`/`listing_books` only `SELECT`; `disputes` admin `UPDATE`/`DELETE` + `SELECT`; `messages` `SELECT` policies, `Participants can send chat messages` and the admin-conversation insert policy.

- [ ] **Step 5: Repeat the walkthrough after lockdown**

Repeat Step 3 items 1, 3, 6, 7, 10 and 11. Everything must behave the same. Additionally, in the browser devtools console on the site run:

```js
const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
const sb = createClient('<NEXT_PUBLIC_SUPABASE_URL>', '<NEXT_PUBLIC_SUPABASE_ANON_KEY>')
console.log(await sb.from('profiles').select('email').limit(1))
```

Expected: an error mentioning `permission denied`, not an email address.

- [ ] **Step 6: Mark the spec done and commit**

Set the spec's status line to `**Status:** Implemented 2026-MM-DD` (today's date), then:

```bash
git add docs/superpowers/specs/2026-11-09-shared-backend-design.md
git commit -m "Shared backend rolled out"
```
