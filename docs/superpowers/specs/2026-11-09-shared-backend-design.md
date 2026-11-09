# Shared Backend (iPhone App — Project 1 of 6)

**Date:** 2026-11-09
**Status:** Draft — awaiting user review

## Overview

Little Book Exchange is getting a native iPhone app (React Native / Expo). The website's ~45 Next.js server actions only work inside the website, so an app can't call them. This project moves every member-facing rule into **Supabase itself** (database functions + row-level security), so the website and the future app follow exactly the same rules through the same Supabase project. A small number of Vercel endpoints handle jobs that need secret keys.

The site is still in testing with no real users, so the database can change freely; the website only has to keep working for testing throughout.

### The iPhone app programme (context)

| # | Project | Depends on |
|---|---|---|
| **1** | **Shared backend (this spec)** | — |
| 2 | App Store requirements — account deletion, report/block listings & users, privacy policy, terms | 1 |
| 3 | Buying credits — Stripe + Apple Pay, web and app | 1 |
| 4 | The iPhone app — Expo project, screens rebuilt natively in the folk-editorial style | 1 |
| 5 | Push notifications | 4 |
| 6 | Release — TestFlight, App Store listing, submission | 2–5 |

Decisions already made: native app via React Native/Expo (not a wrapped website); approach A for the backend (rules in the database, not a full Vercel API); admin tools stay website-only; iPhone first. Credits are a closed-loop swap token for physical books (earn 1 per book given, spend 1 per book received, buy extra at $5; non-refundable, no cash value), so Stripe rather than Apple in-app purchase — that's project 3.

### Goals

1. Every member action the app needs is callable from any Supabase client (no Next.js server required).
2. **Close the existing exchange-status hole** (below).
3. The website behaves the same for users after the switch.
4. Admin pages and the unsubscribe page are untouched.

### Non-goals

The app itself, payments, push notifications, App Store requirements (projects 2–6). Changing what any feature does — this is a move, not a redesign.

---

## The security problem being fixed

The policy `"Participants can update conversations"` (`schema.sql` ~line 319) lets a buyer or seller update **any column** of their own conversation via the Supabase REST API, bypassing the website. The trigger `complete_exchange_marks_listing_sold()` moves credits buyer → seller whenever `exchange_status` becomes `completed`. So a seller can PATCH their own conversation to `completed` and take the buyer's credits with no pickup. Either side can also rewrite confirmed pickup details or statuses.

Related, smaller gaps closed by the same work:

- `"Buyers can create conversations"` lets a buyer insert a conversation with any `exchange_status`.
- `"Participants can send messages"` lets either side insert messages of any `kind` — i.e. fake a system "confirmation" or "pickup" message.
- `lock_listing_for_request` is callable by any signed-in user on any active listing (known, noted in its comment).
- The `book-photos` insert policy allows uploads to any path, not just the user's own folder.
- `"Users can update own listings"` lets a seller change `status` freely, e.g. set a listing with an open request back to `active`.

Credits themselves are already well protected (`prevent_credit_self_grant`); the hole is the status that triggers the transfer.

---

## Architecture

**The database is the guard.** Three rules:

1. **Reads stay direct** — existing select policies, unchanged.
2. **Simple personal writes stay direct**, protected by RLS: each user touches only their own rows; guarded columns stay guarded.
3. **Anything involving another person, credits, or a multi-step change goes through a `security definer` database function**, and direct writes to those tables are revoked. Each function checks **who** (caller is the right buyer/seller/owner via `auth.uid()`), **when** (current status allows it, row locked `for update`), and **what** (inputs valid).

Functions follow the existing conventions in `schema.sql`: `language plpgsql security definer set search_path = public, pg_temp`, `grant execute ... to authenticated`, and authorization checked inside the function (it is the security boundary — TypeScript checks are UX only).

**Return values.** Functions return a small result the caller can act on — a `text` status code (e.g. `'ok'`, `'insufficient_credits'`, `'not_available'`, `'not_allowed'`, `'invalid_pickup'`) or the new row's id. They don't raise for expected outcomes, so the website and app can show a friendly message. Unauthorized callers get the same generic `'not_allowed'` regardless of why, matching `resolve_pickup`'s approach.

---

## Where every action goes

### Direct writes (RLS)

| Action | Today | Change |
|---|---|---|
| `updateProfile`, phone save in `verifyPhoneOtp` | direct | none — credits/verification columns already guarded |
| `saveListing`, `unsaveListing`, `removeSavedListing`, `saveListingAndGoToWallet` | direct | none |
| `addTbrEntry`, `removeTbrEntry` | direct | none |
| `submitReview` | direct | none — policy already limits to buyers of completed exchanges |
| `submitLocationReport` | direct | none |
| `markCreditsSeen` | direct | none |
| Listing photo upload | direct (storage) | insert policy restricted to the user's own folder (`(storage.foldername(name))[1] = auth.uid()::text`) — the path the site already uses |
| Chat message | direct | insert policy restricted to `kind = 'chat'`; other kinds only from functions |

### New database functions

| Function | Replaces | Key checks |
|---|---|---|
| `create_listing(p_listing jsonb, p_books jsonb) → uuid` | `createListing` | caller is signed in; same field validation as `parseListingForm`; photo URLs must be in `book-photos` under the caller's folder; listing + `listing_books` inserted together |
| `update_listing(p_listing_id, p_listing jsonb, p_books jsonb) → text` | `updateListing` | caller owns it; not while `pending`/`sold`; books replaced together |
| `set_listing_status(p_listing_id, p_status) → text` | `updateListingStatus` (status) | owner only; only `active` ↔ `paused` (the two the dashboard offers); never touches `pending`/`sold` |
| `delete_listing(p_listing_id) → text` | `updateListingStatus` (delete) | owner only; blocked while a request is open |
| `start_conversation(p_listing_id) → uuid` | listing page `startConversation` | returns existing conversation if any; can't message yourself |
| `request_book(p_listing_id) → text` | listing page `requestPurchase` | available credits (same rule as `lib/creditCheck.ts`) ≥ `book_count`; listing `active` → `pending`; finds/creates conversation; sets `requested`; posts the request message — all in one transaction, so no half-locked listings |
| `cancel_request(p_conversation_id) → text` | `cancelPurchase` | buyer only; status `requested`; reopens listing |
| `confirm_exchange(p_conversation_id, p_pickup jsonb) → text` | `confirmExchange` | seller only; status `requested`; pickup mode/date/times valid (same rules as today); stores pickup fields; marks the request notification read; listing `pending` → `sold` (as today); posts the confirmation message built from the same text as `buildConfirmationMessage` |
| `deny_request(p_conversation_id) → text` | `denyPurchase` | seller only; status `requested`; reopens listing; notifies buyer |
| `mark_picked_up(p_conversation_id) → text` | `markPickedUp` | participant only; status `confirmed`; sets caller's own `*_picked_up_at` once; posts the pickup message; then calls `resolve_pickup` |
| `file_dispute(p_conversation_id, p_reason) → uuid` | `fileDispute` (record part) | participant only; one open dispute per exchange |
| `hide_exchange(p_conversation_id) → text` | `hideExchangeHistory` | sets only the caller's own `buyer_hidden`/`seller_hidden` |
| `start_support_conversation() → uuid` | `startSupportConversation` | returns the caller's existing support conversation or creates one |
| `move_saved_to_tbr(p_saved_id) → text` | `moveSavedListingToTbr` | caller owns the saved row; insert TBR + delete saved together |

Message text that the website builds in TypeScript today (`buildConfirmationMessage`, `formatPickupAvailability`) moves into SQL so both clients produce identical messages. The TypeScript versions are deleted once nothing uses them.

`lock_listing_for_request` is folded into `request_book`; `execute` is revoked from `authenticated` once the site no longer calls it. `reopen_listing` and `resolve_pickup` stay (cron and admin use them).

### Vercel endpoints

| Endpoint | Why not the database | Behaviour |
|---|---|---|
| `POST /api/auth/username-signin` | must not expose emails | takes username + password, looks up the email with the service role, signs in, returns the session; same generic error for "no such user" and "wrong password" |
| `POST /api/disputes/notify` | needs the Resend key | caller sends their session token + dispute id; endpoint verifies the caller filed it, then emails admins (moved from `fileDispute`) |

Endpoints authenticate with the caller's Supabase access token (`Authorization: Bearer …`) so the app can call them the same way as the website.

### Handled by Supabase Auth directly (no change)

Sign up, email sign-in, password reset and set new password, resend confirmation email, phone OTP send/verify. Open Library search: the app calls Open Library directly (no secret); the website keeps `searchBooks` as it is.

### Unchanged, website-only

All of `lib/actions/admin.ts`, `emailAdmin.ts`, `libraryLocations.ts` admin functions, `resolveLocationReport`, `adminUpdateReview`/`adminDeleteReview`, `unsubscribe.ts`, the `resolve-pickups` cron.

---

## Lockdown (last step)

Once the website calls only the new functions:

- **`conversations`:** drop the participant insert and update policies (`"Buyers can create conversations"`, `"Participants can update conversations"`, `"Sellers can deny conversations"`). Admin policies stay. All participant changes go through functions.
- **`listings`, `listing_books`:** drop member insert/update/delete policies; all changes through `create_listing` / `update_listing` / `set_listing_status` / `delete_listing`. Existing triggers (`complete_exchange_marks_listing_sold`, `trg_award_bonus_on_listing`, TBR notifications) keep firing because the functions still do real inserts/updates.
- **`disputes`:** drop the participant insert policy; filing goes through `file_dispute`.
- **`messages`:** insert policy limited to `kind = 'chat'`.
- **`book-photos`:** insert limited to the user's own folder.
- Revoke `execute` on `lock_listing_for_request` from `authenticated`.

---

## Rollout order

Each step leaves the website fully working.

1. **Add the functions** (new SQL appended to `supabase/schema.sql`, run in the Supabase SQL editor). Nothing calls them yet.
2. **Switch the website over, one flow at a time:** post/edit listing → listing status/delete → message seller → request → cancel → confirm/deny → pickup → dispute (+ notify endpoint) → hide → support → saved-to-TBR. Each server action becomes a thin wrapper: call the function, map the result code to the same redirect/error the user sees today. Demo-mode branches stay as they are.
3. **Add `username-signin`** and switch the sign-in page to it for usernames.
4. **Lockdown** SQL, run last.

The user runs each SQL block in the Supabase SQL editor; each step's block is clearly labelled.

---

## Testing

**Database tests (new) — PGlite.** No Docker or local Supabase is available, so database tests run in Vitest against PGlite (Postgres compiled to WebAssembly, in-process, thrown away after each run). It never touches the real Supabase project.

- A small bootstrap creates the Supabase pieces the schema expects: `auth` schema with `auth.users`, `auth.uid()` / `auth.role()` reading a per-test setting, the `authenticated`/`anon` roles, and a minimal `storage` schema. Then it loads `supabase/schema.sql`.
- Helpers act as a given user (set the role to `authenticated` and the uid setting), so tests run with RLS in force just like real API calls.
- If parts of `schema.sql` can't load under PGlite (e.g. extensions it lacks), the bootstrap stubs them; if that proves impractical the fallback is a dedicated second Supabase project used only for tests — decided during the plan's first task, not mid-build.

Tests per function cover: happy path; wrong caller (`not_allowed`); wrong status; invalid input; and side effects (listing status, messages posted, notifications, credits). Security tests, run after lockdown SQL is loaded:

- seller cannot set `exchange_status = 'completed'` directly
- buyer cannot insert a conversation with a status
- nobody can insert a non-`chat` message directly
- requesting with too few available credits fails and leaves the listing `active`
- credits move exactly once per completed exchange, including double `mark_picked_up` calls
- a stranger cannot confirm, deny, cancel, pick up, hide or dispute someone else's exchange
- uploads outside your own photo folder are rejected (policy check)

**Website tests (existing Vitest).** Tests for `app/profile/actions.ts`, `markPickedUp`, `savedListings`, `DashboardClient` etc. are updated to expect RPC calls and result-code handling instead of direct table writes.

**Hands-on.** After each rollout step, walk the flow on the website with two test accounts (buyer and seller) against the real Supabase project.

---

## Risks

- **PGlite compatibility with `schema.sql`** — mitigated by stubbing, with the second-project fallback decided up front.
- **`schema.sql` is long and re-run in pieces** — new SQL uses `create or replace` / `drop policy if exists` so each block is safe to re-run.
- **Behaviour drift while moving logic to SQL** — each flow keeps the website's existing tests passing and is checked hands-on before the next.
