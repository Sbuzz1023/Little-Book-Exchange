# Capital-letter avatar initials — design

**Date:** 2026-08-10
**Status:** Approved, ready for planning

## Problem

The nav bar avatar currently shows the first two characters of the signed-in
user's username (`components/Nav.tsx`'s `initials()`), split on word
separators if present, otherwise just the first two characters — always
uppercased for display. Sean wants the avatar to instead reflect the
capitalization the user actually chose in their username, e.g. `SeanB` →
`SB`.

### Root cause discovered during investigation

Usernames are currently force-lowercased before being stored, both at
signup (`app/auth/signup/page.tsx`) and profile edit
(`app/profile/actions.ts`) — both call `.toLowerCase()` before writing to
`profiles.username`. That's why no capital letters ever survive to be read
by the avatar logic today. Implementing this feature requires preserving
the casing a user types at signup or profile edit, not just changing the
avatar's string logic.

Preserving case on write has a knock-on effect: `profiles.username` has a
plain case-sensitive `unique` constraint today
(`supabase/schema.sql:8`), and sign-in already lowercases the typed
identifier before querying (`app/auth/signin/page.tsx:30`) — which only
works because storage is always lowercase. Once storage preserves case, we
need real case-insensitive matching, or sign-in breaks and two users could
register `SeanB` and `seanb` as if they were different people.

## Decisions

- **Casing is preserved everywhere**, not just for the avatar. Whatever a
  user types at signup or profile edit (`SeanB`) is what's stored and
  displayed throughout the app — profile page, nav, listings, seller
  pages, etc.
- **Username uniqueness becomes case-insensitive.** `SeanB` and `seanb`
  are the same username for registration purposes; whoever claims it
  first gets it, in whatever casing they typed.
- **Sign-in stays case-insensitive** (already true today) — typing any
  casing of a username at sign-in matches the account regardless of the
  casing it was registered with.
- Only signup and profile-edit set/change the stored casing. Signing in
  never changes what's stored.

## Data model change

Convert `profiles.username` from `text` to Postgres's built-in `citext`
type (case-insensitive text):

```sql
create extension if not exists citext;
alter table profiles alter column username type citext;
```

`citext` makes equality comparisons (`.eq('username', x)`) and the
existing `unique` constraint case-insensitive automatically, while still
storing and returning the exact casing that was written — no application
query code needs to change to get case-insensitive lookup/uniqueness.

This is safe to run against existing data: every username stored today is
already all-lowercase (a side effect of the old `.toLowerCase()` calls),
so there are no case collisions to resolve during the migration.

## Code changes

- **`app/auth/signup/page.tsx`** — remove `.toLowerCase()` from the
  username before insert. Keep the existing `.replace(/\s+/g, '')`
  (whitespace stripping) unchanged.
- **`app/profile/actions.ts`** — same: remove `.toLowerCase()`, keep
  whitespace stripping, on the `updateProfile` username field.
- **`app/auth/signin/page.tsx`** — remove the now-redundant
  `.toLowerCase()` on the typed identifier before the username lookup
  (`citext` handles case-insensitivity at the database level; leaving the
  call would be harmless but is no longer doing anything, so drop it for
  clarity).
- **`components/Nav.tsx`** — replace `initials()` with the new algorithm
  below.

### Avatar initials algorithm

Input: the stored username (as-typed casing). Output: a 1- or
2-character string for the avatar.

1. Scan the username left-to-right and collect every capital letter
   (`A`–`Z`) found, in order of appearance, with position.
2. **2 or more capitals found:** return the first two, in order,
   concatenated. (They do not need to be at word boundaries — this is a
   literal "first two capital letters found," not "initials of each
   word.")
3. **Exactly 1 capital found:**
   - If that capital is the first character of the username, return just
     that one character (do not duplicate it).
   - Otherwise, return the first character of the username, followed by
     the one capital letter found (2 characters).
4. **0 capitals found:** return just the first character of the username
   — uppercased if it's a letter, unchanged if it's a digit (or other
   character).

| Username | Capitals found | Avatar |
|---|---|---|
| `SeanB` | `S`@0, `B`@4 (2+) | `SB` |
| `sarahREADS` | `R`,`E`,`A`,`D`,`S` (2+) | `RE` |
| `3sEan` | `E`@2 only, not first char | `3E` |
| `Sean` | `S`@0 only, is first char | `S` |
| `seanbuczynski` | none | `S` |
| `3sean` | none | `3` |

### Existing users

Anyone who signed up before this change has an all-lowercase stored
username (that's all the old code ever wrote). Nothing breaks for them —
their avatar simply falls back to rule 4 (single first character) until
they re-save their username with capitals via profile edit. No backfill
or forced migration of existing usernames is needed.

## Testing

- Unit tests for the new `initials()` function covering every row in the
  table above, plus guards for an empty/whitespace-only string.
- Update existing tests that currently assert lowercased usernames
  (`components/Nav.test.tsx`, `app/profile/actions.test.ts`, and any
  signup tests) to reflect preserved casing instead.
- Manual/live verification: sign up with a mixed-case username, confirm
  the avatar renders per the table above; confirm signing in with a
  different casing of the same username still works; confirm attempting
  to register a case-variant of an existing username (e.g. `seanb` when
  `SeanB` is taken) is rejected as already taken.

## Out of scope

- No change to how usernames are validated (character set, length,
  etc.) beyond casing — untouched.
- No backfill of existing lowercase usernames to add capitals; users who
  want capitalized avatars re-save their username via profile edit.
- No change to the case-sensitivity of anything other than
  `profiles.username` (e.g. email lookups are untouched).
