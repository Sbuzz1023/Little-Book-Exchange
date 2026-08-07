# Server/DB-Side State Validation — Design

**Date:** 2026-08-06
**Status:** Approved

## Problem

The state-normalization work (see `2026-08-06-state-normalization-design.md`)
replaced the free-text state `<input>` with a `<StateSelect>` dropdown on
signup, profile edit, and the TBR wishlist form. That guarantees a valid
2-letter code from every normal user interaction — but it's a client-side
control only. The three server actions that persist `state`
(`app/auth/signup/page.tsx`'s `signUp`, `app/profile/actions.ts`'s
`updateProfile`, `lib/actions/tbrEntries.ts`'s `addTbrEntry`) all take
`formData.get('state')` and write it through unvalidated. A request crafted
directly against a server action (bypassing the dropdown entirely) can still
write anything into the column, silently reintroducing the exact class of
bug the dropdown was built to prevent — including breaking the
`notify_tbr_matches()` exact-match comparison again.

This was flagged as a deferred finding (#2) in that feature's final code
review and ticketed for this follow-up.

## Goal

A value that isn't one of the 51 valid state codes can never end up stored
in `profiles.state` or `tbr_entries.state` again — regardless of which
code path writes it, today or in the future.

## Design

### 1. Shared validator

Add to `lib/usStates.ts`:

```ts
export function isValidStateCode(code: string): boolean {
  return US_STATES.some(s => s.code === code)
}
```

Same file the dropdown already reads from — no second source of truth.

### 2. App-layer guard (all three write paths)

In `signUp`, `updateProfile`, and `addTbrEntry`, run the incoming `state`
value through `isValidStateCode` before it's written. If it fails, coerce to
`''` — identical to "no state entered," which all three paths, and
`notify_tbr_matches()`, already treat as a valid, meaningful value ("match
any state" / "no location filter").

No new error UI. This path is unreachable through normal use (the dropdown
can't produce an invalid value), so there's nothing to show a real user —
this is purely a backstop for a hand-crafted request.

### 3. DB-layer constraint (the permanent backstop)

Add a `CHECK` constraint to both `profiles.state` and `tbr_entries.state`:

```sql
alter table profiles add constraint profiles_state_format
  check (state = '' or state ~ '^[A-Z]{2}$');

alter table tbr_entries add constraint tbr_entries_state_format
  check (state = '' or state ~ '^[A-Z]{2}$');
```

A *format* check (two uppercase letters), not an exact match against all 51
codes — cheap to maintain forever, and it's exactly the failure mode being
guarded against (multi-word text, lowercase, full names).

**Validated up front, not added `NOT VALID`.** An earlier draft of this
migration added the constraints `NOT VALID`, on the mistaken assumption that
this exempts pre-existing non-conforming rows from the constraint
permanently. It doesn't: `NOT VALID` only skips the one-time verification
scan at creation — every subsequent `INSERT` and `UPDATE` is still checked
per-row, including updates that don't touch `state`. Since the
state-normalization backfill intentionally left a handful of old,
unrecognized rows as free text (real typos it couldn't confidently map),
shipping the constraint `NOT VALID` would have made every one of those rows
un-updatable forever after — silently breaking, among other things, email/
phone verification (`sync_verification_status()`, which has no exception
handler and runs inside GoTrue's own transaction) and exchange completion
(`complete_exchange_marks_listing_sold()`) for those specific users. The
actual migration instead measures which rows don't conform, blanks them
(`''` already means "no state" everywhere the app reads it, so this loses
nothing the app itself wouldn't already discard on that user's next profile
save), and only then adds the constraints — validated, with no follow-up
step required.

The app layer prevents a normal user from ever triggering this constraint
through the UI. But RLS does not restrict which columns a signed-in user's
own browser session may write directly (bypassing the app entirely, e.g. via
the browser console) — so until this constraint is on the database, it is the
only control on that direct-write path, not merely insurance against a
hypothetical future regression. Nothing in the UI needs to catch or display a
constraint violation, since the app layer's own coercion means a normal user
session can never trigger one.

## Testing

- `lib/usStates.test.ts` — add cases for `isValidStateCode`: valid code
  (e.g. `'CA'`) → true; empty string → false (empty is handled as its own
  case by callers, not by this function); lowercase, full name, garbage →
  false. This function carries all the actual logic being added, and it's a
  pure function — full coverage lives here.
- The three call sites (`updateProfile`, `addTbrEntry`, `signUp`) each add a
  one-line coercion built on the already-tested `isValidStateCode` — no new
  test files for them. No test in this repo mocks the Supabase server
  client for a `'use server'` action; the established convention (see
  `lib/actions/validateLocationInput.ts` + its test) is pure, tested logic
  behind a thin, untested action wrapper. `updateProfile` and `addTbrEntry`
  already have no test files today; `signUp` didn't get one in the prior
  state-normalization plan either. Verify these three by reading the diff
  and running the full suite, consistent with how those files were already
  handled.
- No automated test for the DB constraint (same reasoning as the backfill
  migration) — manual verification: after applying it, attempt a raw update
  with a bad value via the Supabase SQL Editor and confirm it's rejected.

## Out of scope

- Retroactively validating (`VALIDATE CONSTRAINT`) once old stragglers are
  cleaned up — a manual step for later, not part of this change.
- Building any UI to catch or display a DB constraint violation — the app
  layer is expected to prevent this from ever reaching the DB.
- Extending the constraint to exact-match all 51 codes instead of the
  format regex — the format check is the right cost/benefit tradeoff here;
  revisit only if a real gap in the format check is found in practice.
