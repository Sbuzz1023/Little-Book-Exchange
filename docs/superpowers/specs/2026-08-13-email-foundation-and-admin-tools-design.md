# Email Foundation & Admin Email Tools — Design

**Date:** 2026-08-13
**Status:** Approved, pending spec self-review
**Author:** Claude (brainstormed with Sean)

## 1. Problem

Little Book Exchange has no working email-sending infrastructure:

- Signup confirmation currently relies on Supabase Auth's built-in default mailer, which is rate-limited (a handful of emails/hour) and not meant for production — deliverability is poor and it often lands in spam.
- Password reset is **not built at all**. The sign-in page has a "Forgot password?" link (`app/auth/signin/page.tsx`) pointing to `/auth/forgot-password`, which does not exist.
- There is no way to send a one-off announcement/broadcast email to users.
- There is no admin-facing way to control what any of these emails say — wording is either hardcoded or left at Supabase's defaults.

Separately, the app already has a complete **in-app** notification system (bell icon, unread badges, per-type on/off toggles in `ProfileCard.tsx`, backed by the `notifications` table and `notify_*` columns on `profiles`) for five event types: new message, purchase request, purchase decision, TBR match, pickup confirmation. That system is unaffected by this spec.

## 2. Goals

Build a real email foundation covering:

1. **Welcome/confirmation email** at signup (combined into one email).
2. **Password reset**, end to end — currently entirely missing.
3. **Admin-composed announcements** ("broadcast") to all users, one user, or a filtered group.
4. **Admin control over wording** for the welcome/confirmation and password-reset emails, editable from Little Book Exchange's own `/admin` panel (not Supabase's dashboard).
5. **Admin "resend" tool** — re-trigger a specific user's confirmation or password-reset email.

## 3. Explicit non-goals (deferred to a follow-up spec)

- **Push notifications** for the five existing event-alert types, and the redesigned "how do you want to be alerted" preference screen (choosing email and/or push per alert type). This is real, separate infrastructure (browser push subscriptions, VAPID keys, a service worker) and is the very next project after this one. It will reuse the Resend/template/logging foundation built here.
- **SMS/phone alerts.** Phone *verification* UI/server actions already exist (`components/PhoneVerify.tsx`, `lib/actions/verification.ts`) but depend on a texting provider being connected in Supabase, which isn't configured. Diagnosing/fixing that and adding SMS alerts is separate future work, not part of this spec.
- Changing the existing `notify_*` in-app toggle system — untouched by this spec.
- A custom domain. Email sends from a placeholder/onboarding address for now; swapping in a real domain later is a config change (add a few DNS records at the registrar, verify with the email provider, change one "from" setting) — not a rebuild.
- Per-recipient broadcast delivery drill-down UI. A simple aggregate result ("Sent to 39, failed for 3") is enough for now; per-recipient rows still exist in the log table for manual troubleshooting if ever needed.

## 4. Architecture

**Email provider:** [Resend](https://resend.com) — free tier (3,000 emails/month, 100/day) is far more than current volume needs. Sends use Resend's placeholder sending address until a real domain is added.

**Confirmation & password reset stay security-correct:** Supabase Auth continues to generate the actual secure, time-limited confirmation/reset tokens and links — nothing about that changes. What changes is *who sends the email carrying that link*. Supabase's [Send Email Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook) is configured to fire instead of Supabase's built-in mailer; a Supabase Edge Function receives the hook payload (user info, the token/redirect link, and which action it's for — signup or recovery), looks up the matching row in `email_templates`, fills in the placeholders, and sends via Resend's API. This requires:

- Deploying one Supabase Edge Function (new infra alongside the Next.js app — deployed via the Supabase CLI, not Vercel).
- Storing the Resend API key and the hook's signing secret as Edge Function secrets (not in the Next.js app's env).
- Registering the hook in the Supabase dashboard (one-time setup).

**Broadcast/admin-composed emails** are simpler: sent directly from a Next.js server action using the Resend API, no hook involved, since there's no Supabase Auth event to intercept.

## 5. Data model

```sql
create table email_templates (
  id uuid primary key default gen_random_uuid(),
  type text not null unique check (type in ('welcome_confirmation', 'password_reset')),
  subject text not null,
  body text not null, -- supports {{username}} and {{link}} placeholders
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

create table email_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('welcome_confirmation', 'password_reset', 'broadcast')),
  recipient_user_id uuid references profiles(id), -- one row per recipient per send (a broadcast to 42 people creates 42 rows); null only if the recipient somehow isn't a registered user
  recipient_email text not null,
  subject text not null,
  status text not null check (status in ('sent', 'failed')),
  error text,
  sent_at timestamptz not null default now()
);

alter table profiles add column if not exists marketing_opt_out boolean not null default false;
```

Row-level security: both tables are admin-only (no public policies) — reuse whatever pattern gates the existing `/admin` routes (`profiles.is_admin`).

## 6. Password reset flow (new)

1. `/auth/forgot-password` (new page) — user enters their email, submits. Calls `supabase.auth.resetPasswordForEmail(email)`. Always shows a generic "if that email exists, we've sent a reset link" success message (doesn't reveal whether the address is registered).
2. Supabase generates the reset token/link and fires the Send Email Hook. The Edge Function renders the `password_reset` template and sends via Resend, logging the result to `email_log`.
3. `/auth/reset-password` (new page) — where the emailed link lands. User sets a new password; calls `supabase.auth.updateUser({ password })`.
4. The existing dead "Forgot password?" link on `/auth/signin` now resolves correctly.

## 7. Signup / welcome-confirmation flow

Reuses the existing `resendEmailConfirmation` action's underlying mechanism (`supabase.auth.resend`), but the email it triggers is now rendered from the `welcome_confirmation` template and sent via the same hook + Resend path, instead of Supabase's default mailer. One combined email — welcomes the new user and asks them to confirm their address in the same message.

## 8. Admin "Emails" section (`/admin`)

New tab area alongside the existing Locations admin tab, with three sub-tabs:

**Templates** — a form per template (`Welcome/Confirmation`, `Password Reset`) with subject + body fields, a visible legend of available placeholders (`{{username}}`, `{{link}}`), and a preview showing rendered output with sample data before saving. Saving updates the matching `email_templates` row.

**Compose** — write a one-off email:
- Recipient: **All users** / **one user** (search by username or email) / **filtered group** (by city or state, pulling distinct values already present on `profiles`).
- Subject + body, written fresh each send (not saved as a reusable template).
- Recipients with `marketing_opt_out = true` are automatically excluded from All-users and filtered-group sends (not from direct one-user sends, which are closer to a direct/support message than marketing).
- Every broadcast email appends an unsubscribe link/line, pointing to a simple unauthenticated endpoint that sets `marketing_opt_out = true` for the linked user via a signed token (so a logged-out recipient can unsubscribe with one click, without needing to sign in).
- Before sending, shows a confirmation with the resolved recipient count ("This will email 42 people — send?").
- After sending, shows the aggregate result ("Sent to 39, failed for 3") and logs each attempt to `email_log`.

**Resend** — search for a user, then "Resend confirmation email" or "Resend password-reset email." Re-triggers the *real* flow (`supabase.auth.resend` / `supabase.auth.resetPasswordForEmail`) rather than replaying a stored copy, so it always reflects whatever the template currently says.

## 9. Error handling

- If Resend fails during signup or password reset (bad API key, provider outage, rate limit), the user sees a plain "we couldn't send that email — try again" message, never a raw error. The failure is logged to `email_log` with `status = 'failed'` and the error message, visible to admin.
- Broadcast sends that partially fail still report the aggregate outcome; failed rows remain in `email_log` for manual follow-up.
- The Edge Function itself should fail loudly (visible in Supabase's function logs) if Resend is completely unreachable, rather than silently swallowing errors — this is a security-relevant path (password reset) where silent failure would be worse than a visible one.

## 10. Testing & verification

- Unit tests for template placeholder-filling logic, recipient-filtering logic (city/state/opt-out), and the Edge Function's request handling — following the project's existing Vitest conventions.
- Before this is considered done, a real end-to-end check against a live Resend account: an actual signup, an actual password reset, and an actual broadcast, confirming emails are received (not just that the code runs without errors) — same bar as the Mapbox token and phone-verification work.

## 11. Rollout notes

- Ships without a custom domain; sends work immediately using Resend's default sending address.
- Adding a domain later: register it, add the DNS records Resend provides at the registrar, wait for verification, then update one "from address" setting. No code changes required beyond that setting.
- This spec's `email_log` and `email_templates` tables, along with the Resend integration, are the foundation the next (push notification) spec will build on — no rework anticipated when that spec adds email as a selectable channel for the five alert types.
