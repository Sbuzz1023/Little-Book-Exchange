# Profile Card Reorganization + Editable Username + Inline Phone Verification

## Context

The `/profile` page's Profile card (`app/profile/ProfileCard.tsx`) renders account
info two ways:

- **View mode** — a flat 2-column grid, fields in database-column order: Email,
  Username, City, State, Phone, Member Since, Address, Zip, Pickup Spot. Related
  fields aren't grouped — Address/Zip are separated from City/State by Phone and
  Member Since landing in between.
- **Edit mode** — already grouped into labeled sections (📍 Address, 📦 Pickup Spot,
  🔔 Notifications), but Username and Email aren't editable at all (not present in
  the edit form), and Phone is a single plain input with no link to the app's
  existing phone-verification mechanism.

Separately, `app/profile/DashboardClient.tsx`'s Wallet tab ("🎯 Earn Your First
Credit" checklist) already contains a complete phone OTP verification flow (send
code → confirm code) tied to `sendPhoneOtp`/`verifyPhoneOtp` server actions
(`lib/actions/verification.ts`) and the `profile.phone_verified` column. That flow
is scoped entirely to the Wallet tab today and has no connection to the Profile
card's Phone field.

## Goals

1. Reorganize the Profile card (both view and edit mode) so related fields are
   grouped together and appear in a consistent order top-to-bottom: **Username →
   Email → Phone → Address → Pickup**.
2. Make Username editable, safely handling the case where the chosen name
   collides with another user's (enforced today only by a DB `unique` constraint
   with no application-level handling).
3. Bring phone verification into the Profile card: an unverified phone stays
   editable with a "Verify" control next to it; a verified phone becomes
   locked/read-only with a "✅ Verified" badge and no Verify control.
4. Extract the existing send-code/confirm-code UI (currently duplicated only in
   the Wallet tab) into one shared component used by both the Profile card and
   the Wallet tab, so the OTP flow has a single implementation.

## Non-goals

- Email stays **read-only** in this pass. `profiles.email` is a mirror of
  `auth.users.email`, kept in sync by a DB trigger tied to Supabase's real
  email-confirmation flow (`email_confirmed_at`). A plain editable text input
  would only change the display copy, not the actual login email, and would
  desync it from `email_verified`. Real email-change (send confirmation link to
  new address, update `auth.users` via `supabase.auth.updateUser`) is a
  meaningfully different, larger feature — left for a future spec if wanted.
- No way to change a phone number after it's verified. Once locked, it stays
  locked in this pass. A future "re-verify a new number" flow is out of scope.
- No changes to the Notifications section (already correctly grouped) or to
  anything in the Address/Pickup sections beyond moving them as a unit.
- No changes to the Wallet tab's other checklist items (email verification,
  books posted) — only its phone-verification block changes, to use the new
  shared component instead of its own inline copy.

## Design

### 1. Field order & grouping (`ProfileCard.tsx`)

Both view and edit mode present, top to bottom:

1. **Username** (editable)
2. **Email** (read-only — shown as plain text/value in both modes, never an
   `<input>`)
3. **Phone** (editable pre-verification; see §3)
4. **📍 Address** section (unchanged fields: Address, Apt/Unit, City, State, Zip,
   Share toggle) — moved to directly follow Phone, so all address-related data
   is contiguous
5. **📦 Pickup Spot** section (unchanged)
6. **🔔 Notifications** section (unchanged, edit mode only, as today)

View mode gets the same section-header treatment edit mode already uses (dashed
divider + icon label) for Address and Pickup, so the two modes read as the same
screen. Member Since moves up to sit near Username/Email/Phone as basic account
info (it has no natural section of its own and isn't part of what was reported
as "scattered" — it just needs to stop sitting next to Address/Zip).

Sections/fields that are empty continue to be hidden in view mode, matching
current behavior (e.g. no Address section header at all if the user never
entered an address).

### 2. Editable Username

- New edit-mode input, name="username", pre-filled with `profile.username`.
- `updateProfile` (`app/profile/actions.ts`) adds `username` to its `.update()`
  call, and checks the Supabase response for an error. Postgres unique-violation
  on the `profiles.username` constraint surfaces as error code `23505`. On that
  specific error, redirect back to `/profile?error=username_taken` instead of
  `?success=1`; any other unexpected error redirects with `?error=save_failed`
  (generic fallback — do not leave the user on a silent failure that still says
  "Profile updated!").
- `page.tsx` already declares `searchParams.error` in its type but never reads
  or forwards it — wire it through to `DashboardClient` → `ProfileCard` as a new
  `error` prop, mapped to display text:
  - `username_taken` → "That username is already taken — try another."
  - `save_failed` → "Something went wrong saving your changes. Please try again."
- Displayed in `ProfileCard` the same way the existing green success banner is
  today, as a red equivalent, so the pattern is consistent.
- No client-side uniqueness pre-check (e.g. as-you-type availability) — out of
  scope; the save-time check is sufficient for this pass.

### 3. Inline phone verification

**New shared component**, `components/PhoneVerify.tsx`:

- Props: current phone number, `phoneVerified: boolean`, and the two server
  actions (`sendPhoneOtp`, `verifyPhoneOtp`).
- Encapsulates the exact state machine that exists today in
  `DashboardClient.tsx` (`phoneStep`, `phoneNumber`, `phoneCode`, `phoneError`)
  and its send-code/confirm-code UI — moved, not reimplemented.
- On successful `verifyPhoneOtp`, calls an `onVerified` callback (both call
  sites already call `router.refresh()` today to pick up the new
  `phone_verified` value from the server; that stays the caller's
  responsibility).

**In `ProfileCard.tsx` edit mode:**

- Phone row renders the existing plain `<input name="phone">` when
  `!phone_verified`, with `<PhoneVerify>` alongside it (its own "Verify" button
  triggers the inline send/confirm UI, separate from the surrounding
  `updateAction` form — matches how it already works in the Wallet tab, which
  runs its OTP actions independently of the main profile-save form).
- When `phone_verified` is true: the input becomes `readOnly` (not `disabled` —
  `readOnly` keeps the field's value in the submitted form data so the
  surrounding "Save Changes" submit continues to work unchanged; `disabled`
  inputs are excluded from form submission and would require an `actions.ts`
  change to avoid the field being blanked out), visually styled as locked
  (muted background/border), with a "✅ Verified" badge replacing the Verify
  button.

**View mode:** Phone shown as plain text as today; append "✅ Verified" next to
the value when `phone_verified` is true. No verify control in view mode (that
only appears in edit mode, next to the editable input).

**`DashboardClient.tsx` Wallet tab:** its phone-verification checklist item
swaps to render `<PhoneVerify>` instead of its current ~60-line inline
implementation. The surrounding checklist row (checkbox label, "✅"/"☐" state)
is unchanged. `phoneStep`/`phoneNumber`/`phoneCode`/`phoneError` state and the
inline JSX for the send/confirm UI are deleted from `DashboardClient.tsx` (now
owned by `PhoneVerify`).

**Prop threading:** `phone_verified`, `sendPhoneOtp`, and `verifyPhoneOtp` are
already fetched/passed into `DashboardClient` — they additionally need to be
passed down into `ProfileCard`, which doesn't receive them today.

### 4. Testing

- New `app/profile/ProfileCard.test.tsx` (no test file exists for this
  component today):
  - View mode: fields render in the new grouped order; Address section is
    absent when no address fields are set; Member Since formats correctly.
  - Edit mode: Username input present and submits; Email renders as text, not
    an input; Phone input is present and editable when unverified, `readOnly`
    and shows "✅ Verified" with no Verify button when verified.
  - Error display: given an `error` prop of `username_taken`, the "That
    username is already taken" message renders (green success banner's red
    counterpart).
- New `components/PhoneVerify.test.tsx`: send-code → confirm-code happy path,
  invalid-code error path, calls `onVerified` on success — covers what's
  currently only exercised (if at all) inside `DashboardClient.test.tsx`.
- Update/check `DashboardClient.test.tsx` for any existing assertions that
  reach into the Wallet tab's now-removed inline phone UI (e.g. by test id or
  button text) — repoint them at `<PhoneVerify>`'s rendered output so the same
  behavior is still covered through the Wallet tab.
- `updateProfile` (`app/profile/actions.ts`) currently has no test file
  either — add `app/profile/actions.test.tsx` (or extend an existing action
  test if one is found during planning) covering: successful username update,
  and the `23505` unique-violation path redirecting to `?error=username_taken`.

## Scope / files touched

- `app/profile/ProfileCard.tsx` — reorganized layout, Username field, Phone
  lock/verify integration, error banner.
- `app/profile/actions.ts` — `updateProfile` handles `username` +
  unique-violation error path.
- `app/profile/page.tsx` — forward `searchParams.error` down.
- `app/profile/DashboardClient.tsx` — pass new props to `ProfileCard`; Wallet
  tab's phone block switches to `<PhoneVerify>`; remove now-dead phone-OTP
  state/JSX.
- `components/PhoneVerify.tsx` — new shared component.
- New/updated test files as listed above.

No database schema changes — `username`, `phone_verified`, `email`,
`email_verified` already exist on `profiles`.
