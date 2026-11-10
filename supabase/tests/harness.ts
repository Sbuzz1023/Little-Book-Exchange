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
