# Email Foundation & Admin Email Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build real email sending for Little Book Exchange — welcome/confirmation at signup, a working password reset flow (currently entirely missing), and an admin "Emails" section for broadcast announcements, admin-editable wording for the two automatic emails, and a per-user resend tool.

**Architecture:** [Resend](https://resend.com) sends all mail. Supabase Auth still generates the actual secure confirmation/recovery tokens; a new Next.js route (`/api/auth/email-hook`) intercepts Supabase's "about to send an email" moment via its Send Email Hook, renders the matching admin-editable template, and sends via Resend instead of Supabase's default mailer. A second new route (`/auth/confirm`) verifies the token when the user clicks the emailed link and establishes their session directly (no bounce through Supabase's own hosted domain). Admin broadcast/resend tools are ordinary server actions gated by the existing `requireAdmin` helper.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript, Supabase (`@supabase/ssr`, `@supabase/supabase-js`), Tailwind CSS, Vitest + Testing Library, Resend (new), `standardwebhooks` (new).

## Global Constraints

- Schema changes are applied by hand in the Supabase SQL Editor — this project has no local Supabase CLI/migration tooling. Every schema task's "test" is a manual query, run and eyeballed, not an automated assertion (matches the convention used in `docs/superpowers/plans/2026-08-05-credit-ledger.md`).
- Server actions return `{ ok: boolean; error?: string }` (see `lib/actions/verification.ts`, `lib/actions/admin.ts`) — every new action follows this shape.
- Admin-only actions call `requireAdmin(supabase)` from `lib/actions/libraryLocations.ts` first and bail out on `!admin.ok`, matching `lib/actions/admin.ts`.
- Admin-only tables are RLS-gated with `exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true)`, matching every existing admin policy in `supabase/schema.sql`.
- No custom domain exists yet. Emails send from Resend's default sending identity; swapping in a real domain later is a one-line env var change, not a rebuild (see spec §11).
- Templates are plain text (not HTML) for this pass — simpler, and Resend delivers plain text mail fine. Placeholders use `{{name}}` syntax.
- New env vars needed (local `.env.local` + Vercel Production/Preview): `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_EMAIL_HOOK_SECRET`, `UNSUBSCRIBE_SECRET`. Optional: `EMAIL_FROM_ADDRESS` (defaults to a placeholder if unset).
- Admin-tab React components in this codebase (`LocationsAdminTab.tsx`) are not unit-tested with Testing Library — verified by manual click-through instead. The new admin Emails UI follows that same precedent; Task 13 is the manual verification pass that closes the loop, matching Sean's "real verification, not shortcuts" standard.

---

### Task 1: Database schema — `email_templates`, `email_log`, `profiles.marketing_opt_out`

**Files:**
- Modify: `supabase/schema.sql` (append a new migration block at the end, matching the file's existing convention — see the `-- ── Migration: ... ──` banners already in the file)

**Interfaces:**
- Produces: tables `email_templates(type, subject, body, updated_at, updated_by)` and `email_log(id, kind, recipient_user_id, recipient_email, subject, status, error, sent_at)`, plus `profiles.marketing_opt_out`. All later tasks read/write these.

- [ ] **Step 1: Append the migration block to `supabase/schema.sql`**

```sql
-- ── Migration: email foundation (templates, send log, marketing opt-out) ─────
-- Run this block in Supabase SQL Editor:

create table if not exists email_templates (
  id uuid primary key default gen_random_uuid(),
  type text not null unique check (type in ('welcome_confirmation', 'password_reset')),
  subject text not null,
  body text not null, -- plain text; supports {{username}} and {{link}} placeholders
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

alter table email_templates enable row level security;

create policy "Admins can view email templates" on email_templates
  for select using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Admins can update email templates" on email_templates
  for update using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

insert into email_templates (type, subject, body) values
  ('welcome_confirmation',
   'Welcome to Little Book Exchange, {{username}}! Confirm your email',
   E'Hi {{username}},\n\nWelcome to Little Book Exchange! Please confirm your email address by clicking the link below:\n\n{{link}}\n\nHappy trading!\n— The Little Book Exchange Team'),
  ('password_reset',
   'Reset your Little Book Exchange password',
   E'Hi {{username}},\n\nWe received a request to reset your password. Click the link below to choose a new one:\n\n{{link}}\n\nIf you did not request this, you can safely ignore this email — your password has not been changed.\n\n— The Little Book Exchange Team')
on conflict (type) do nothing;

create table if not exists email_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('welcome_confirmation', 'password_reset', 'broadcast')),
  -- one row per recipient per send (a broadcast to 42 people creates 42 rows);
  -- null only if the recipient somehow isn't a registered user
  recipient_user_id uuid references profiles(id),
  recipient_email text not null,
  subject text not null,
  status text not null check (status in ('sent', 'failed')),
  error text,
  sent_at timestamptz not null default now()
);

alter table email_log enable row level security;

create policy "Admins can view email log" on email_log
  for select using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Admins can insert email log" on email_log
  for insert with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

alter table profiles add column if not exists marketing_opt_out boolean not null default false;
-- ──────────────────────────────────────────────────────────────────────────────
```

Paste this whole block into the Supabase project's SQL Editor and run it. Expected: "Success. No rows returned."

- [ ] **Step 2: Verify manually**

Run in the SQL Editor:
```sql
select type, subject from email_templates order by type;
```
Expected: two rows, `password_reset` and `welcome_confirmation`, each with a non-empty subject.

```sql
select column_name from information_schema.columns where table_name = 'profiles' and column_name = 'marketing_opt_out';
```
Expected: one row.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: add email_templates, email_log, and profiles.marketing_opt_out"
```

---

### Task 2: Email sending primitives — `renderTemplate` and `sendEmail`

**Files:**
- Create: `lib/email/renderTemplate.ts`
- Test: `lib/email/renderTemplate.test.ts`
- Create: `lib/email/resend.ts`
- Test: `lib/email/resend.test.ts`

**Interfaces:**
- Produces: `renderTemplate(template: string, vars: Record<string, string>): string` and `sendEmail(params: { to: string; subject: string; text: string }): Promise<{ ok: boolean; error?: string }>`. Consumed by Task 3's webhook route and Task 7's broadcast action.

- [ ] **Step 1: Write the failing test for `renderTemplate`**

```typescript
// lib/email/renderTemplate.test.ts
import { describe, it, expect } from 'vitest'
import { renderTemplate } from './renderTemplate'

describe('renderTemplate', () => {
  it('substitutes a known placeholder', () => {
    expect(renderTemplate('Hi {{username}}!', { username: 'Sean' })).toBe('Hi Sean!')
  })

  it('substitutes multiple placeholders, including repeats', () => {
    const result = renderTemplate('{{username}}, click {{link}}. Thanks, {{username}}.', { username: 'Sean', link: 'http://x' })
    expect(result).toBe('Sean, click http://x. Thanks, Sean.')
  })

  it('leaves an unknown placeholder untouched', () => {
    expect(renderTemplate('Hi {{nickname}}!', { username: 'Sean' })).toBe('Hi {{nickname}}!')
  })

  it('returns the template unchanged when it has no placeholders', () => {
    expect(renderTemplate('Plain text.', { username: 'Sean' })).toBe('Plain text.')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- lib/email/renderTemplate.test.ts`
Expected: FAIL — `Cannot find module './renderTemplate'`

- [ ] **Step 3: Implement `renderTemplate`**

```typescript
// lib/email/renderTemplate.ts
// Fills {{name}} placeholders in a plain-text email template. Unknown
// placeholders (not present in `vars`) are left as-is rather than blanked
// out, so a typo in an admin-edited template is visible, not silently eaten.
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- lib/email/renderTemplate.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Install the Resend package**

Run: `npm install resend`

- [ ] **Step 6: Write the failing test for `sendEmail`**

```typescript
// lib/email/resend.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendMock = vi.fn()

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}))

// Import after the mock so the mocked constructor is what sendEmail sees.
import { sendEmail } from './resend'

describe('sendEmail', () => {
  beforeEach(() => {
    sendMock.mockReset()
    process.env.RESEND_API_KEY = 'test-key'
    delete process.env.EMAIL_FROM_ADDRESS
  })

  it('sends with the default from-address when EMAIL_FROM_ADDRESS is unset', async () => {
    sendMock.mockResolvedValue({ data: { id: 'abc' }, error: null })
    const res = await sendEmail({ to: 'user@example.com', subject: 'Hi', text: 'Body' })
    expect(res).toEqual({ ok: true })
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@example.com',
      subject: 'Hi',
      text: 'Body',
      from: expect.stringContaining('resend.dev'),
    }))
  })

  it('uses EMAIL_FROM_ADDRESS when set, so swapping in a real domain later is a one-line change', async () => {
    process.env.EMAIL_FROM_ADDRESS = 'Little Book Exchange <hello@littlebookexchange.com>'
    sendMock.mockResolvedValue({ data: { id: 'abc' }, error: null })
    await sendEmail({ to: 'user@example.com', subject: 'Hi', text: 'Body' })
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ from: 'Little Book Exchange <hello@littlebookexchange.com>' }))
  })

  it('reports failure when Resend returns an error', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: 'Invalid API key' } })
    const res = await sendEmail({ to: 'user@example.com', subject: 'Hi', text: 'Body' })
    expect(res).toEqual({ ok: false, error: 'Invalid API key' })
  })

  it('reports failure when the Resend call throws', async () => {
    sendMock.mockRejectedValue(new Error('network down'))
    const res = await sendEmail({ to: 'user@example.com', subject: 'Hi', text: 'Body' })
    expect(res).toEqual({ ok: false, error: 'network down' })
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npm run test:run -- lib/email/resend.test.ts`
Expected: FAIL — `Cannot find module './resend'`

- [ ] **Step 8: Implement `sendEmail`**

```typescript
// lib/email/resend.ts
import { Resend } from 'resend'

// Lazily constructed so tests can set RESEND_API_KEY before first use, and so
// importing this module never throws in an environment where the key isn't
// set yet (e.g. during `next build`).
let client: Resend | null = null
function getClient(): Resend {
  if (!client) client = new Resend(process.env.RESEND_API_KEY)
  return client
}

export async function sendEmail(params: { to: string; subject: string; text: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const from = process.env.EMAIL_FROM_ADDRESS || 'Little Book Exchange <onboarding@resend.dev>'
    const { error } = await getClient().emails.send({ from, to: params.to, subject: params.subject, text: params.text })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'Failed to send email.' }
  }
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm run test:run -- lib/email/resend.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json lib/email/renderTemplate.ts lib/email/renderTemplate.test.ts lib/email/resend.ts lib/email/resend.test.ts
git commit -m "feat: add email template rendering and Resend send wrapper"
```

---

### Task 3: Service-role client + the Send Email Hook receiver

**Files:**
- Create: `lib/supabase/serviceRole.ts`
- Create: `app/api/auth/email-hook/route.ts`
- Test: `app/api/auth/email-hook/route.test.ts`

**Interfaces:**
- Consumes: `renderTemplate` and `sendEmail` from Task 2.
- Produces: `createServiceRoleClient()` (also reused by Task 5's unsubscribe page) and the live `POST /api/auth/email-hook` endpoint that Task 15's ops step registers with Supabase.

**Why a service-role client here:** this endpoint is called server-to-server by Supabase, not by a logged-in browser session — there's no `auth.uid()` for RLS to check. It needs to read `email_templates` and write `email_log` (both admin-only tables) without a user session, so it uses the Supabase **service role key**, which bypasses RLS. This key must never be exposed to the browser — it only ever lives in this server-only module and the server's env vars.

- [ ] **Step 1: Install the webhook-verification package**

Run: `npm install standardwebhooks`

- [ ] **Step 2: Create the service-role client**

```typescript
// lib/supabase/serviceRole.ts
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Server-only. Bypasses Row Level Security entirely — use this ONLY for code
// that runs with no logged-in user (like the Send Email Hook receiver), never
// for anything reachable from a browser request. The service role key must
// never be sent to the client; it isn't prefixed NEXT_PUBLIC_ for that reason.
export function createServiceRoleClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
```

- [ ] **Step 3: Write the failing tests for the hook route**

```typescript
// app/api/auth/email-hook/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const verifyMock = vi.fn()
vi.mock('standardwebhooks', () => ({
  Webhook: vi.fn().mockImplementation(() => ({ verify: verifyMock })),
}))

const sendEmailMock = vi.fn()
vi.mock('@/lib/email/resend', () => ({ sendEmail: sendEmailMock }))

let templateRow: { subject: string; body: string } | null
let profileRow: { username: string } | null
const insertMock = vi.fn(() => Promise.resolve({ error: null }))

const fromMock = vi.fn((table: string) => {
  if (table === 'email_templates') {
    return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: templateRow }) }) }) }
  }
  if (table === 'profiles') {
    return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: profileRow }) }) }) }
  }
  if (table === 'email_log') {
    return { insert: insertMock }
  }
  throw new Error(`unexpected table ${table}`)
})

vi.mock('@/lib/supabase/serviceRole', () => ({
  createServiceRoleClient: () => ({ from: fromMock }),
}))

import { POST } from './route'

function buildRequest(body: unknown) {
  return new NextRequest('http://localhost/api/auth/email-hook', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'webhook-id': 'id', 'webhook-timestamp': '1', 'webhook-signature': 'sig' },
  })
}

describe('POST /api/auth/email-hook', () => {
  beforeEach(() => {
    verifyMock.mockReset()
    sendEmailMock.mockReset()
    insertMock.mockClear()
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'
    templateRow = { subject: 'Hi {{username}}', body: 'Click {{link}}, {{username}}' }
    profileRow = { username: 'seanb' }
  })

  it('rejects a request with an invalid signature', async () => {
    verifyMock.mockImplementation(() => { throw new Error('bad signature') })
    const res = await POST(buildRequest({}))
    expect(res.status).toBe(401)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('renders the password_reset template and sends via Resend for a recovery action', async () => {
    verifyMock.mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com' },
      email_data: { token_hash: 'th_123', email_action_type: 'recovery' },
    })
    sendEmailMock.mockResolvedValue({ ok: true })

    const res = await POST(buildRequest({}))

    expect(res.status).toBe(200)
    expect(fromMock).toHaveBeenCalledWith('email_templates')
    expect(sendEmailMock).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'Hi seanb',
      text: expect.stringContaining('http://localhost:3000/auth/confirm?token_hash=th_123&type=recovery&next=%2Fauth%2Freset-password'),
    })
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'password_reset', status: 'sent', recipient_email: 'user@example.com' }))
  })

  it('renders the welcome_confirmation template and points next at sign-in for a signup action', async () => {
    templateRow = { subject: 'Welcome {{username}}', body: 'Confirm: {{link}}' }
    verifyMock.mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com' },
      email_data: { token_hash: 'th_456', email_action_type: 'signup' },
    })
    sendEmailMock.mockResolvedValue({ ok: true })

    await POST(buildRequest({}))

    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('/auth/confirm?token_hash=th_456&type=signup&next=%2Fauth%2Fsignin%3Finfo%3Dconfirmed'),
    }))
  })

  it('logs a failed send and returns an error when Resend fails', async () => {
    verifyMock.mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com' },
      email_data: { token_hash: 'th_789', email_action_type: 'recovery' },
    })
    sendEmailMock.mockResolvedValue({ ok: false, error: 'Invalid API key' })

    const res = await POST(buildRequest({}))

    expect(res.status).toBe(500)
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'Invalid API key' }))
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm run test:run -- app/api/auth/email-hook/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 5: Implement the route**

```typescript
// app/api/auth/email-hook/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'standardwebhooks'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { renderTemplate } from '@/lib/email/renderTemplate'
import { sendEmail } from '@/lib/email/resend'

type HookPayload = {
  user: { id: string; email: string }
  email_data: { token_hash: string; email_action_type: 'signup' | 'recovery' | string }
}

const TEMPLATE_BY_ACTION: Record<string, 'welcome_confirmation' | 'password_reset'> = {
  signup: 'welcome_confirmation',
  recovery: 'password_reset',
}

// Where the user lands after /auth/confirm verifies their link. Signup just
// needs them back at sign-in; recovery needs the set-new-password page.
const NEXT_BY_ACTION: Record<string, string> = {
  signup: '/auth/signin?info=confirmed',
  recovery: '/auth/reset-password',
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const headers = Object.fromEntries(request.headers)

  let payload: HookPayload
  try {
    const wh = new Webhook(process.env.SUPABASE_EMAIL_HOOK_SECRET!)
    payload = wh.verify(rawBody, headers) as HookPayload
  } catch {
    return NextResponse.json({ error: { http_code: 401, message: 'Invalid webhook signature.' } }, { status: 401 })
  }

  const templateType = TEMPLATE_BY_ACTION[payload.email_data.email_action_type]
  const next = NEXT_BY_ACTION[payload.email_data.email_action_type]
  if (!templateType || !next) {
    // Only signup + recovery are used by this app today (see spec §7 note on
    // scope). Anything else is unexpected — fail loudly rather than silently
    // skip sending.
    return NextResponse.json({ error: { http_code: 400, message: `Unsupported email action: ${payload.email_data.email_action_type}` } }, { status: 400 })
  }

  const supabase = createServiceRoleClient()

  const { data: template } = await supabase
    .from('email_templates').select('subject, body').eq('type', templateType).single()
  const { data: profile } = await supabase
    .from('profiles').select('username').eq('id', payload.user.id).single()

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  const link = `${siteUrl}/auth/confirm?token_hash=${payload.email_data.token_hash}&type=${payload.email_data.email_action_type}&next=${encodeURIComponent(next)}`
  const vars = { username: profile?.username || 'there', link }

  const subject = renderTemplate(template?.subject ?? '', vars)
  const text = renderTemplate(template?.body ?? '', vars)

  const result = await sendEmail({ to: payload.user.email, subject, text })

  await supabase.from('email_log').insert({
    kind: templateType,
    recipient_user_id: payload.user.id,
    recipient_email: payload.user.email,
    subject,
    status: result.ok ? 'sent' : 'failed',
    error: result.ok ? null : result.error,
  })

  if (!result.ok) {
    return NextResponse.json({ error: { http_code: 500, message: 'Failed to send email.' } }, { status: 500 })
  }
  return NextResponse.json({})
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:run -- app/api/auth/email-hook/route.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/supabase/serviceRole.ts app/api/auth/email-hook/route.ts app/api/auth/email-hook/route.test.ts
git commit -m "feat: add Send Email Hook receiver, rendering templates via Resend"
```

---

### Task 4: `/auth/confirm` verification route + password reset pages

**Files:**
- Create: `app/auth/confirm/route.ts`
- Create: `app/auth/forgot-password/page.tsx`
- Create: `app/auth/reset-password/page.tsx`
- Modify: `app/auth/signin/page.tsx` (add the `info=confirmed` banner)

**Interfaces:**
- Consumes: `createClient` from `lib/supabase/server.ts` (existing).
- Produces: the three real pages/routes that Task 3's emailed links point at. `/auth/forgot-password`'s dead link on the sign-in page now resolves.

- [ ] **Step 1: Implement `/auth/confirm/route.ts`**

This is the route both the welcome-confirmation and password-reset emails link to. It verifies the one-time token directly (no bounce through Supabase's own hosted domain) and establishes the session via cookies, then redirects to wherever the email said to go next.

```typescript
// app/auth/confirm/route.ts
import { NextRequest, NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next') || '/'

  if (!token_hash || !type) {
    return NextResponse.redirect(`${origin}/auth/signin?error=${encodeURIComponent('That link is invalid or incomplete.')}`)
  }

  const supabase = createClient()
  const { error } = await supabase.auth.verifyOtp({ type, token_hash })
  if (error) {
    return NextResponse.redirect(`${origin}/auth/signin?error=${encodeURIComponent('That link has expired or already been used.')}`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
```

- [ ] **Step 2: Implement `/auth/forgot-password/page.tsx`**

Styled to match `app/auth/signin/page.tsx`.

```tsx
// app/auth/forgot-password/page.tsx
import Link from 'next/link'

export default function ForgotPasswordPage({ searchParams }: { searchParams: { sent?: string } }) {
  async function requestReset(formData: FormData) {
    'use server'
    const { redirect } = await import('next/navigation')
    const email = (formData.get('email') as string ?? '').trim()

    if (email) {
      const { createClient } = await import('@/lib/supabase/server')
      const supabase = createClient()
      // Errors are intentionally swallowed here — always show the same
      // "check your email" message, so this can't be used to test which
      // addresses have an account.
      await supabase.auth.resetPasswordForEmail(email)
    }
    redirect('/auth/forgot-password?sent=1')
  }

  return (
    <div className="flex items-center justify-center px-4 md:px-8 py-8 md:py-10" style={{ minHeight: 'calc(100vh - 68px)' }}>
      <div className="bg-white rounded-[28px] p-6 md:p-10 w-full max-w-[440px] border-2 border-gray-100 shadow-[0_8px_0_#e5e7eb]">
        <h1 className="font-display text-[28px] text-bk-orange text-center mb-1.5">Reset Password</h1>
        <p className="text-[14px] font-bold text-center mb-7" style={{ color: '#aaa' }}>
          Enter your email and we'll send you a link to reset your password.
        </p>

        {searchParams.sent === '1' ? (
          <div className="bg-teal-50 border-2 border-teal-200 rounded-xl px-4 py-3 text-teal-700 font-bold text-sm">
            If that email has an account, we've sent a reset link. Check your inbox.
          </div>
        ) : (
          <form action={requestReset} className="space-y-4">
            <div>
              <label
                className="block mb-1.5"
                style={{ fontSize: 12, fontWeight: 900, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}
              >
                Email
              </label>
              <input
                name="email"
                type="email"
                placeholder="you@email.com"
                required
                autoComplete="email"
                className="w-full border-2 border-[#fed7aa] rounded-[14px] px-4 bg-cream font-bold text-[15px] focus:outline-none focus:border-bk-orange"
                style={{ padding: '13px 16px' }}
              />
            </div>
            <button
              type="submit"
              className="w-full bg-bk-orange text-white rounded-[14px] font-black text-base shadow-[0_5px_0_#c2410c] hover:shadow-[0_3px_0_#c2410c] hover:translate-y-0.5 transition-all mt-2"
              style={{ padding: 15, border: 'none' }}
            >
              Send Reset Link →
            </button>
          </form>
        )}

        <p className="text-center font-bold text-[14px] mt-5" style={{ color: '#aaa' }}>
          <Link href="/auth/signin" className="text-bk-orange font-extrabold hover:underline">Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Implement `/auth/reset-password/page.tsx`**

By the time a user lands here, `/auth/confirm` has already verified their token and established a recovery session via cookies — this page just needs to call `updateUser`.

```tsx
// app/auth/reset-password/page.tsx
export default function ResetPasswordPage({ searchParams }: { searchParams: { error?: string } }) {
  async function setNewPassword(formData: FormData) {
    'use server'
    const { redirect } = await import('next/navigation')
    const password = formData.get('password') as string
    const confirm = formData.get('confirm') as string

    if (!password || password.length < 8) {
      redirect(`/auth/reset-password?error=${encodeURIComponent('Password must be at least 8 characters.')}`)
    }
    if (password !== confirm) {
      redirect(`/auth/reset-password?error=${encodeURIComponent('Passwords do not match.')}`)
    }

    const { createClient } = await import('@/lib/supabase/server')
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      redirect(`/auth/reset-password?error=${encodeURIComponent('That reset link has expired. Request a new one.')}`)
    }
    redirect('/auth/signin?info=password_reset')
  }

  return (
    <div className="flex items-center justify-center px-4 md:px-8 py-8 md:py-10" style={{ minHeight: 'calc(100vh - 68px)' }}>
      <div className="bg-white rounded-[28px] p-6 md:p-10 w-full max-w-[440px] border-2 border-gray-100 shadow-[0_8px_0_#e5e7eb]">
        <h1 className="font-display text-[28px] text-bk-orange text-center mb-1.5">Set New Password</h1>
        <p className="text-[14px] font-bold text-center mb-7" style={{ color: '#aaa' }}>Choose a new password for your account.</p>

        {searchParams.error && (
          <div className="bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-red-700 font-bold text-sm mb-4">
            {decodeURIComponent(searchParams.error)}
          </div>
        )}

        <form action={setNewPassword} className="space-y-4">
          <div>
            <label className="block mb-1.5" style={{ fontSize: 12, fontWeight: 900, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              New Password
            </label>
            <input
              name="password" type="password" placeholder="At least 8 characters" required minLength={8}
              autoComplete="new-password"
              className="w-full border-2 border-[#fed7aa] rounded-[14px] px-4 bg-cream font-bold text-[15px] focus:outline-none focus:border-bk-orange"
              style={{ padding: '13px 16px' }}
            />
          </div>
          <div>
            <label className="block mb-1.5" style={{ fontSize: 12, fontWeight: 900, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Confirm Password
            </label>
            <input
              name="confirm" type="password" placeholder="Re-enter password" required minLength={8}
              autoComplete="new-password"
              className="w-full border-2 border-[#fed7aa] rounded-[14px] px-4 bg-cream font-bold text-[15px] focus:outline-none focus:border-bk-orange"
              style={{ padding: '13px 16px' }}
            />
          </div>
          <button
            type="submit"
            className="w-full bg-bk-orange text-white rounded-[14px] font-black text-base shadow-[0_5px_0_#c2410c] hover:shadow-[0_3px_0_#c2410c] hover:translate-y-0.5 transition-all mt-2"
            style={{ padding: 15, border: 'none' }}
          >
            Set Password →
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add the `info=confirmed` / `info=password_reset` banners to sign-in**

```tsx
// app/auth/signin/page.tsx
// Change the searchParams type:
  searchParams,
}: {
  searchParams: { redirect?: string; error?: string; info?: string }
}) {
```
(already this shape — no type change needed). Add a second info branch right after the existing `already_registered` block:

```tsx
        {searchParams.info === 'already_registered' && (
          <div className="bg-teal-50 border-2 border-teal-200 rounded-xl px-4 py-3 text-teal-700 font-bold text-sm mb-4">
            Looks like you already have an account! Sign in below.
          </div>
        )}

        {searchParams.info === 'confirmed' && (
          <div className="bg-teal-50 border-2 border-teal-200 rounded-xl px-4 py-3 text-teal-700 font-bold text-sm mb-4">
            Email confirmed! You can sign in now.
          </div>
        )}

        {searchParams.info === 'password_reset' && (
          <div className="bg-teal-50 border-2 border-teal-200 rounded-xl px-4 py-3 text-teal-700 font-bold text-sm mb-4">
            Password updated! Sign in with your new password.
          </div>
        )}
```

- [ ] **Step 5: Manually verify the pages render**

Run: `npm run dev`, visit `http://localhost:3000/auth/forgot-password` and `http://localhost:3000/auth/reset-password`. Expected: both render without errors, styled consistently with the sign-in page. (Full end-to-end email verification happens in Task 15, once Resend + the hook are actually configured.)

- [ ] **Step 6: Commit**

```bash
git add app/auth/confirm app/auth/forgot-password app/auth/reset-password app/auth/signin/page.tsx
git commit -m "feat: build the missing password reset flow and email-link verification route"
```

---

### Task 5: Unsubscribe flow

**Files:**
- Create: `lib/email/unsubscribeToken.ts`
- Test: `lib/email/unsubscribeToken.test.ts`
- Create: `lib/actions/unsubscribe.ts`
- Create: `app/unsubscribe/[userId]/page.tsx`

**Interfaces:**
- Consumes: `createServiceRoleClient` from Task 3.
- Produces: `makeUnsubscribeToken(userId)` / `verifyUnsubscribeToken(userId, token)`, consumed by Task 7's broadcast action to build the link it appends to every compose email.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/email/unsubscribeToken.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { makeUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribeToken'

describe('unsubscribe token', () => {
  beforeEach(() => {
    process.env.UNSUBSCRIBE_SECRET = 'test-secret'
  })

  it('a token generated for a user verifies for that same user', () => {
    const token = makeUnsubscribeToken('user-1')
    expect(verifyUnsubscribeToken('user-1', token)).toBe(true)
  })

  it('a token does not verify for a different user', () => {
    const token = makeUnsubscribeToken('user-1')
    expect(verifyUnsubscribeToken('user-2', token)).toBe(false)
  })

  it('a garbage token does not verify', () => {
    expect(verifyUnsubscribeToken('user-1', 'not-a-real-token')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- lib/email/unsubscribeToken.test.ts`
Expected: FAIL — `Cannot find module './unsubscribeToken'`

- [ ] **Step 3: Implement the token util**

```typescript
// lib/email/unsubscribeToken.ts
import { createHmac, timingSafeEqual } from 'crypto'

// Low-stakes by design: worst case is someone unsubscribes another user from
// marketing email, which is not a security-sensitive action. This just stops
// a plain "?userId=..." link from being trivially guessable/scriptable.
export function makeUnsubscribeToken(userId: string): string {
  return createHmac('sha256', process.env.UNSUBSCRIBE_SECRET!).update(userId).digest('hex')
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  const expected = makeUnsubscribeToken(userId)
  const a = Buffer.from(expected)
  const b = Buffer.from(token)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- lib/email/unsubscribeToken.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Add the unsubscribe server action**

```typescript
// lib/actions/unsubscribe.ts
'use server'

import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribeToken'

export async function unsubscribeFromMarketing(userId: string, token: string): Promise<{ ok: boolean; error?: string }> {
  if (!verifyUnsubscribeToken(userId, token)) return { ok: false, error: 'Invalid or expired link.' }

  const supabase = createServiceRoleClient()
  const { error } = await supabase.from('profiles').update({ marketing_opt_out: true }).eq('id', userId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
```

- [ ] **Step 6: Add the unsubscribe page**

Runs the unsubscribe on load (no confirmation click needed — standard one-click pattern) since the recipient is arriving from an emailed link, not browsing the site.

```tsx
// app/unsubscribe/[userId]/page.tsx
import { unsubscribeFromMarketing } from '@/lib/actions/unsubscribe'

export default async function UnsubscribePage({ params, searchParams }: { params: { userId: string }; searchParams: { t?: string } }) {
  const result = await unsubscribeFromMarketing(params.userId, searchParams.t ?? '')

  return (
    <div className="flex items-center justify-center px-4 py-16" style={{ minHeight: 'calc(100vh - 68px)' }}>
      <div className="bg-white rounded-[28px] p-8 w-full max-w-[440px] border-2 border-gray-100 shadow-[0_8px_0_#e5e7eb] text-center">
        {result.ok ? (
          <>
            <h1 className="font-display text-[22px] text-bk-orange mb-2">You're unsubscribed</h1>
            <p className="text-[14px] font-bold" style={{ color: '#aaa' }}>
              You won't get announcement emails from Little Book Exchange anymore.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display text-[22px] text-bk-orange mb-2">Link expired</h1>
            <p className="text-[14px] font-bold" style={{ color: '#aaa' }}>
              This unsubscribe link is invalid or has expired.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Commit**

```bash
git add lib/email/unsubscribeToken.ts lib/email/unsubscribeToken.test.ts lib/actions/unsubscribe.ts app/unsubscribe
git commit -m "feat: add one-click unsubscribe flow for broadcast emails"
```

---

### Task 6: Admin actions — email template CRUD

**Files:**
- Create: `lib/actions/emailAdmin.ts`

**Interfaces:**
- Consumes: `requireAdmin` from `lib/actions/libraryLocations.ts`, `createClient` from `lib/supabase/server.ts`.
- Produces: `EmailTemplateType`, `EmailTemplate`, `getEmailTemplates()`, `updateEmailTemplate(type, subject, body)`. Consumed by Task 9's UI.

Not unit-tested — matches this codebase's existing precedent for `requireAdmin`-gated actions (`adminUpdateUserCredits`, `editLibraryLocation`, `resolveLocationReport`, none of which have test files; see Global Constraints). Verified manually in Task 13.

- [ ] **Step 1: Implement the file**

```typescript
// lib/actions/emailAdmin.ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from './libraryLocations'

export type EmailTemplateType = 'welcome_confirmation' | 'password_reset'
export type EmailTemplate = { type: EmailTemplateType; subject: string; body: string }

export async function getEmailTemplates(): Promise<{ ok: boolean; templates?: EmailTemplate[]; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const { data, error } = await supabase.from('email_templates').select('type, subject, body').order('type')
  if (error) return { ok: false, error: error.message }
  return { ok: true, templates: data as EmailTemplate[] }
}

export async function updateEmailTemplate(type: EmailTemplateType, subject: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  if (!subject.trim() || !body.trim()) return { ok: false, error: 'Subject and body cannot be empty.' }

  const { error } = await supabase
    .from('email_templates')
    .update({ subject: subject.trim(), body, updated_at: new Date().toISOString(), updated_by: admin.userId })
    .eq('type', type)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/actions/emailAdmin.ts
git commit -m "feat: add admin actions for reading/editing email templates"
```

---

### Task 7: Admin actions — broadcast compose

**Files:**
- Modify: `lib/actions/emailAdmin.ts` (append)

**Interfaces:**
- Consumes: `sendEmail` (Task 2), `makeUnsubscribeToken` (Task 5), `requireAdmin`/`createClient` (as Task 6).
- Produces: `BroadcastTarget`, `resolveBroadcastRecipients(target)`, `sendBroadcastEmail(target, subject, body)`. Consumed by Task 10's UI.

- [ ] **Step 1: Append to `lib/actions/emailAdmin.ts`**

```typescript
// (append to lib/actions/emailAdmin.ts, keep existing imports and add:)
import { sendEmail } from '@/lib/email/resend'
import { makeUnsubscribeToken } from '@/lib/email/unsubscribeToken'

export type BroadcastTarget =
  | { kind: 'all' }
  | { kind: 'user'; userId: string }
  | { kind: 'filtered'; city?: string; state?: string }

type Recipient = { id: string; email: string }

async function fetchRecipients(supabase: ReturnType<typeof createClient>, target: BroadcastTarget): Promise<Recipient[]> {
  if (target.kind === 'user') {
    const { data } = await supabase.from('profiles').select('id, email').eq('id', target.userId).single()
    return data?.email ? [{ id: data.id, email: data.email }] : []
  }

  let query = supabase.from('profiles').select('id, email').eq('marketing_opt_out', false).not('email', 'is', null)
  if (target.kind === 'filtered') {
    if (target.city) query = query.eq('city', target.city)
    if (target.state) query = query.eq('state', target.state)
  }
  const { data } = await query
  return (data ?? []).filter((r): r is Recipient => !!r.email)
}

export async function resolveBroadcastRecipients(target: BroadcastTarget): Promise<{ ok: boolean; recipients?: Recipient[]; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const recipients = await fetchRecipients(supabase, target)
  return { ok: true, recipients }
}

export async function sendBroadcastEmail(target: BroadcastTarget, subject: string, body: string): Promise<{ ok: boolean; sent: number; failed: number; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, sent: 0, failed: 0, error: admin.error }

  if (!subject.trim() || !body.trim()) return { ok: false, sent: 0, failed: 0, error: 'Subject and body cannot be empty.' }

  const recipients = await fetchRecipients(supabase, target)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

  let sent = 0, failed = 0
  for (const recipient of recipients) {
    const unsubLink = `${siteUrl}/unsubscribe/${recipient.id}?t=${makeUnsubscribeToken(recipient.id)}`
    const text = `${body}\n\n---\nDon't want these emails? Unsubscribe: ${unsubLink}`
    const result = await sendEmail({ to: recipient.email, subject, text })

    await supabase.from('email_log').insert({
      kind: 'broadcast',
      recipient_user_id: recipient.id,
      recipient_email: recipient.email,
      subject,
      status: result.ok ? 'sent' : 'failed',
      error: result.ok ? null : result.error,
    })

    if (result.ok) sent++; else failed++
  }

  return { ok: true, sent, failed }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/actions/emailAdmin.ts
git commit -m "feat: add admin broadcast-email action with recipient targeting and opt-out"
```

---

### Task 8: Admin actions — per-user resend

**Files:**
- Modify: `lib/actions/emailAdmin.ts` (append)

**Interfaces:**
- Produces: `resendConfirmationEmail(userId)`, `resendPasswordResetEmail(userId)`. Consumed by Task 11's UI.

- [ ] **Step 1: Append to `lib/actions/emailAdmin.ts`**

```typescript
// (append to lib/actions/emailAdmin.ts)

async function lookupUserEmail(supabase: ReturnType<typeof createClient>, userId: string): Promise<string | null> {
  const { data } = await supabase.from('profiles').select('email').eq('id', userId).single()
  return data?.email ?? null
}

export async function resendConfirmationEmail(userId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const email = await lookupUserEmail(supabase, userId)
  if (!email) return { ok: false, error: 'No email on file for that user.' }

  const { error } = await supabase.auth.resend({ type: 'signup', email })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function resendPasswordResetEmail(userId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const email = await lookupUserEmail(supabase, userId)
  if (!email) return { ok: false, error: 'No email on file for that user.' }

  const { error } = await supabase.auth.resetPasswordForEmail(email)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/actions/emailAdmin.ts
git commit -m "feat: add admin per-user resend actions for confirmation and password reset"
```

---

### Task 9: Admin UI — Templates editor

**Files:**
- Create: `app/admin/EmailTemplatesEditor.tsx`

**Interfaces:**
- Consumes: `getEmailTemplates`, `updateEmailTemplate`, `EmailTemplate`, `EmailTemplateType` from Task 6.
- Produces: `<EmailTemplatesEditor />`, mounted by Task 12's container.

- [ ] **Step 1: Implement the component**

```tsx
// app/admin/EmailTemplatesEditor.tsx
'use client'
import { useState, useEffect } from 'react'
import { getEmailTemplates, updateEmailTemplate, type EmailTemplate, type EmailTemplateType } from '@/lib/actions/emailAdmin'

const LABELS: Record<EmailTemplateType, string> = {
  welcome_confirmation: 'Welcome / Confirm Email',
  password_reset: 'Password Reset',
}

export default function EmailTemplatesEditor() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [drafts, setDrafts] = useState<Record<string, { subject: string; body: string }>>({})
  const [savingType, setSavingType] = useState<EmailTemplateType | null>(null)
  const [savedType, setSavedType] = useState<EmailTemplateType | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getEmailTemplates().then(res => {
      if (res.ok && res.templates) {
        setTemplates(res.templates)
        const d: Record<string, { subject: string; body: string }> = {}
        for (const t of res.templates) d[t.type] = { subject: t.subject, body: t.body }
        setDrafts(d)
      } else {
        setError(res.error ?? 'Failed to load templates.')
      }
    })
  }, [])

  async function save(type: EmailTemplateType) {
    setSavingType(type)
    setSavedType(null)
    setError(null)
    const draft = drafts[type]
    const result = await updateEmailTemplate(type, draft.subject, draft.body)
    setSavingType(null)
    if (result.ok) setSavedType(type)
    else setError(result.error ?? 'Failed to save.')
  }

  return (
    <div className="space-y-6">
      <h2 className="font-display text-[22px] text-[#1e293b]">Email Templates</h2>
      <p className="text-[13px] font-semibold text-[#64748b]">
        Edit the wording sent automatically. Use <code className="bg-[#f1f5f9] px-1 rounded">{'{{username}}'}</code> and <code className="bg-[#f1f5f9] px-1 rounded">{'{{link}}'}</code> — they're filled in automatically for each user.
      </p>

      {error && (
        <div className="bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-red-700 font-bold text-sm">{error}</div>
      )}

      {templates.map(t => (
        <div key={t.type} className="bg-white rounded-2xl p-5 border border-[#f1f5f9] shadow-sm space-y-3">
          <h3 className="font-black text-[15px] text-[#1e293b]">{LABELS[t.type]}</h3>
          <div>
            <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Subject</label>
            <input
              value={drafts[t.type]?.subject ?? ''}
              onChange={e => setDrafts(d => ({ ...d, [t.type]: { ...d[t.type], subject: e.target.value } }))}
              className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange"
            />
          </div>
          <div>
            <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Body</label>
            <textarea
              value={drafts[t.type]?.body ?? ''}
              onChange={e => setDrafts(d => ({ ...d, [t.type]: { ...d[t.type], body: e.target.value } }))}
              rows={6}
              className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-semibold text-[13px] focus:outline-none focus:border-bk-orange resize-y"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => save(t.type)}
              disabled={savingType === t.type}
              className="bg-bk-orange text-white rounded-xl px-4 py-2 font-extrabold text-[13px] shadow-[0_3px_0_#c2410c] disabled:opacity-60"
            >
              {savingType === t.type ? 'Saving…' : 'Save'}
            </button>
            {savedType === t.type && <span className="text-[12px] font-bold text-[#059669]">✓ Saved</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/admin/EmailTemplatesEditor.tsx
git commit -m "feat: add admin UI for editing email template wording"
```

---

### Task 10: Admin UI — Compose (broadcast)

**Files:**
- Create: `app/admin/EmailComposeTab.tsx`

**Interfaces:**
- Consumes: `resolveBroadcastRecipients`, `sendBroadcastEmail`, `BroadcastTarget` from Task 7.
- Produces: `<EmailComposeTab users={...} />`, mounted by Task 12's container. `users` reuses the same `User[]` list `AdminClient.tsx` already fetches (id, username, email, city, state) — no new fetch.

- [ ] **Step 1: Implement the component**

```tsx
// app/admin/EmailComposeTab.tsx
'use client'
import { useState, useEffect, useMemo } from 'react'
import { resolveBroadcastRecipients, sendBroadcastEmail, type BroadcastTarget } from '@/lib/actions/emailAdmin'

type ComposeUser = { id: string; username: string; email: string; city: string; state: string }

export default function EmailComposeTab({ users }: { users: ComposeUser[] }) {
  const [targetKind, setTargetKind] = useState<'all' | 'user' | 'filtered'>('all')
  const [userSearch, setUserSearch] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
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
    if (!subject.trim() || !body.trim()) { setError('Subject and body are required.'); return }

    const res = await resolveBroadcastRecipients(target)
    if (!res.ok) { setError(res.error ?? 'Failed to look up recipients.'); return }
    setRecipientCount(res.recipients?.length ?? 0)
    setConfirming(true)
  }

  async function confirmSend() {
    const target = currentTarget()
    if (!target) return
    setSending(true)
    const res = await sendBroadcastEmail(target, subject, body)
    setSending(false)
    setConfirming(false)
    if (res.ok) {
      setResult({ sent: res.sent, failed: res.failed })
      setSubject('')
      setBody('')
    } else {
      setError(res.error ?? 'Failed to send.')
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="font-display text-[22px] text-[#1e293b]">Compose Email</h2>

      <div className="bg-white rounded-2xl p-5 border border-[#f1f5f9] shadow-sm space-y-4">
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

        <div>
          <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Subject</label>
          <input value={subject} onChange={e => setSubject(e.target.value)}
            className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
        </div>
        <div>
          <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Body</label>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={6}
            className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-semibold text-[13px] focus:outline-none focus:border-bk-orange resize-y" />
        </div>

        {error && <div className="bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-red-700 font-bold text-sm">{error}</div>}
        {result && (
          <div className="bg-teal-50 border-2 border-teal-200 rounded-xl px-4 py-3 text-teal-700 font-bold text-sm">
            Sent to {result.sent}{result.failed > 0 ? `, failed for ${result.failed}` : ''}.
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
              This will email <span className="font-black text-bk-orange">{recipientCount}</span> {recipientCount === 1 ? 'person' : 'people'}. Send?
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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/admin/EmailComposeTab.tsx
git commit -m "feat: add admin UI for composing broadcast emails"
```

---

### Task 11: Admin UI — Resend tool

**Files:**
- Create: `app/admin/EmailResendTool.tsx`

**Interfaces:**
- Consumes: `resendConfirmationEmail`, `resendPasswordResetEmail` from Task 8.
- Produces: `<EmailResendTool users={...} />`, mounted by Task 12's container.

- [ ] **Step 1: Implement the component**

```tsx
// app/admin/EmailResendTool.tsx
'use client'
import { useState, useMemo } from 'react'
import { resendConfirmationEmail, resendPasswordResetEmail } from '@/lib/actions/emailAdmin'

type ResendUser = { id: string; username: string; email: string }

export default function EmailResendTool({ users }: { users: ResendUser[] }) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ResendUser | null>(null)
  const [busy, setBusy] = useState<'confirmation' | 'reset' | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const matches = useMemo(
    () => users.filter(u => u.username.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())).slice(0, 8),
    [users, search]
  )

  async function resend(kind: 'confirmation' | 'reset') {
    if (!selected) return
    setBusy(kind)
    setMessage(null)
    const result = kind === 'confirmation' ? await resendConfirmationEmail(selected.id) : await resendPasswordResetEmail(selected.id)
    setBusy(null)
    setMessage({ ok: result.ok, text: result.ok ? 'Sent!' : (result.error ?? 'Failed to send.') })
  }

  return (
    <div className="space-y-5">
      <h2 className="font-display text-[22px] text-[#1e293b]">Resend an Email</h2>
      <div className="bg-white rounded-2xl p-5 border border-[#f1f5f9] shadow-sm space-y-4">
        <input
          value={search} onChange={e => { setSearch(e.target.value); setSelected(null); setMessage(null) }}
          placeholder="Search by username or email…"
          className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2 font-bold text-[13px] focus:outline-none focus:border-bk-orange"
        />
        {search && !selected && (
          <div className="border border-[#f1f5f9] rounded-xl overflow-hidden">
            {matches.map(u => (
              <button key={u.id} onClick={() => { setSelected(u); setSearch(`${u.username} (${u.email})`) }}
                className="w-full text-left px-3 py-2 text-[13px] font-semibold hover:bg-[#f8fafc] border-b border-[#f8fafc] last:border-0">
                {u.username} <span className="text-[#94a3b8]">— {u.email}</span>
              </button>
            ))}
            {matches.length === 0 && <div className="px-3 py-2 text-[12px] text-[#94a3b8] font-semibold">No matches</div>}
          </div>
        )}

        {selected && (
          <div className="flex gap-3">
            <button onClick={() => resend('confirmation')} disabled={busy !== null}
              className="bg-bk-orange text-white rounded-xl px-4 py-2 font-extrabold text-[13px] shadow-[0_3px_0_#c2410c] disabled:opacity-60">
              {busy === 'confirmation' ? 'Sending…' : 'Resend Confirmation Email'}
            </button>
            <button onClick={() => resend('reset')} disabled={busy !== null}
              className="bg-[#1e293b] text-white rounded-xl px-4 py-2 font-extrabold text-[13px] shadow-[0_3px_0_#0f172a] disabled:opacity-60">
              {busy === 'reset' ? 'Sending…' : 'Resend Password Reset'}
            </button>
          </div>
        )}

        {message && (
          <div className={`rounded-xl px-4 py-3 font-bold text-sm border-2 ${message.ok ? 'bg-teal-50 border-teal-200 text-teal-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {message.text}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/admin/EmailResendTool.tsx
git commit -m "feat: add admin UI for resending a user's confirmation or reset email"
```

---

### Task 12: Wire the Emails tab into the admin panel

**Files:**
- Create: `app/admin/EmailsAdminTab.tsx`
- Modify: `app/admin/AdminClient.tsx`

**Interfaces:**
- Consumes: `EmailTemplatesEditor` (Task 9), `EmailComposeTab` (Task 10), `EmailResendTool` (Task 11).
- Produces: the `emails` tab inside `AdminClient`, reachable from the sidebar/mobile nav.

- [ ] **Step 1: Create the container component**

```tsx
// app/admin/EmailsAdminTab.tsx
'use client'
import { useState } from 'react'
import EmailTemplatesEditor from './EmailTemplatesEditor'
import EmailComposeTab from './EmailComposeTab'
import EmailResendTool from './EmailResendTool'

type EmailUser = { id: string; username: string; email: string; city: string; state: string }
type SubTab = 'templates' | 'compose' | 'resend'

export default function EmailsAdminTab({ users }: { users: EmailUser[] }) {
  const [subTab, setSubTab] = useState<SubTab>('compose')

  const SUB_TABS: { id: SubTab; label: string }[] = [
    { id: 'compose', label: 'Compose' },
    { id: 'templates', label: 'Templates' },
    { id: 'resend', label: 'Resend' },
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

      {subTab === 'compose' && <EmailComposeTab users={users} />}
      {subTab === 'templates' && <EmailTemplatesEditor />}
      {subTab === 'resend' && <EmailResendTool users={users} />}
    </div>
  )
}
```

- [ ] **Step 2: Add the tab to `AdminClient.tsx`**

```tsx
// app/admin/AdminClient.tsx
// Add the import near the other tab component import:
import LocationsAdminTab from './LocationsAdminTab'
import EmailsAdminTab from './EmailsAdminTab'
```

Extend the `Tab` type:
```tsx
type Tab = 'dashboard' | 'users' | 'locations' | 'reviews' | 'emails'
```

Add to `TABS`:
```tsx
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id:'dashboard', label:'Dashboard',  icon:'📊' },
  { id:'users',     label:'Users',      icon:'👥' },
  { id:'locations', label:'Locations',  icon:'📍' },
  { id:'reviews',   label:'Reviews',    icon:'⭐' },
  { id:'emails',    label:'Emails',     icon:'✉️' },
]
```

Render it in the main content area, next to the other tabs:
```tsx
          {tab === 'locations' && <LocationsAdminTab onPendingCountChange={handleTabPendingCountChange} />}
          {tab === 'reviews'   && <ReviewsTab reviews={reviews} setReviews={setReviews} />}
          {tab === 'emails'    && <EmailsAdminTab users={users} />}
```

(`users` is already fetched with `id, username, email, city, state` — see the existing `useEffect` populating it — so no new data fetching is needed.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/admin/EmailsAdminTab.tsx app/admin/AdminClient.tsx
git commit -m "feat: wire the Emails tab into the admin panel"
```

---

### Task 13: Configuration, live wiring, and end-to-end verification

This task has no new application code — it's the runbook that makes everything built above actually work, plus the real click-through verification. Follow it as a checklist; each step is something Sean does (with guidance) since it involves real accounts/dashboards, not code changes.

- [ ] **Step 1: Create a Resend account and get an API key**

Go to `resend.com`, sign up, then find **API Keys** in the left sidebar and create one. Copy it — this is `RESEND_API_KEY`.

- [ ] **Step 2: Get the Supabase service role key**

In the Supabase dashboard for this project: **Settings → API**. Under "Project API keys," copy the key labeled **`service_role`** (not the `anon` one already in use). This is `SUPABASE_SERVICE_ROLE_KEY`. Keep it private — it bypasses all the database's normal access rules.

- [ ] **Step 3: Generate an unsubscribe secret**

Run locally: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — copy the output. This is `UNSUBSCRIBE_SECRET`.

- [ ] **Step 4: Add the new env vars locally**

Add to `.env.local`:
```
RESEND_API_KEY=<from step 1>
SUPABASE_SERVICE_ROLE_KEY=<from step 2>
UNSUBSCRIBE_SECRET=<from step 3>
SUPABASE_EMAIL_HOOK_SECRET=placeholder-until-step-6
```

- [ ] **Step 5: Deploy so the hook endpoint is live**

Push this branch / merge to `master` so `little-book-exchange.vercel.app/api/auth/email-hook` actually exists on the internet — Supabase needs to be able to reach it. Add the same four env vars to Vercel (Project → Settings → Environment Variables, for Production and Preview).

- [ ] **Step 6: Register the Send Email Hook in Supabase**

In the Supabase dashboard: **Authentication → Hooks**. Add a "Send Email" hook, type **HTTPS**, URL `https://little-book-exchange.vercel.app/api/auth/email-hook`. Supabase will show a generated signing secret when you save it — copy that value and set it as `SUPABASE_EMAIL_HOOK_SECRET` in both `.env.local` and Vercel's env vars (replacing the placeholder from Step 4), then redeploy so Vercel picks up the real value.

- [ ] **Step 7: Verify a real signup confirmation email**

Sign up a new test account on the live site. Expected: an email arrives (check spam too) from Resend's address, using the "Welcome / Confirm Email" template's wording, with a working confirmation link. Clicking it should land on `/auth/signin?info=confirmed` showing the "Email confirmed!" banner.

- [ ] **Step 8: Verify a real password reset**

From `/auth/signin`, click "Forgot password?", enter that test account's email. Expected: an email arrives using the "Password Reset" template's wording. Clicking its link should land on `/auth/reset-password`; setting a new password should redirect to `/auth/signin?info=password_reset`, and signing in with the new password should work.

- [ ] **Step 9: Verify the admin Emails tab**

Sign in as an admin (`profiles.is_admin = true`), go to `/admin → Emails`. Expected:
- **Templates**: edit the Welcome/Confirm subject, save, confirm the ✓ Saved indicator appears, then confirm the change actually took effect by re-running Step 7 or checking `select subject from email_templates where type = 'welcome_confirmation'` in the SQL Editor.
- **Compose**: send a test broadcast to "One User" targeting the test account from Step 7. Expected: the confirmation dialog shows "1 person," the email arrives with the unsubscribe line at the bottom, and clicking that link shows the "You're unsubscribed" page.
- **Resend**: pick the test account, click "Resend Confirmation Email." Expected: another confirmation email arrives.

- [ ] **Step 10: Confirm nothing regressed**

Run: `npm run test:run -- --exclude ".claude/**"`
Expected: full existing suite still passes (per the known pitfall in the project notes, exclude any stray `.claude/worktrees/*` directories from the run).
