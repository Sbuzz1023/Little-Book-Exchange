# Address Privacy Toggles & Pickup Description

**Date:** 2026-07-06  
**Status:** Approved

## Overview

Sellers can control which private contact details get revealed to a buyer when they approve a purchase. City and state remain public on all listings. Street address, unit number, and pickup spot description are private by default — revealed only after seller approval, and only if the seller has toggled sharing on.

---

## Data Changes

### `profiles` table — new columns

| Column | Type | Default | Description |
|---|---|---|---|
| `address` | text | `''` | Street address (e.g. "123 Main St") |
| `address_unit` | text | `''` | Apt / unit number (e.g. "Apt 2B"), optional |
| `share_address` | boolean | `true` | Whether address is sent to buyer on confirmation |
| `pickup_description` | text | `''` | Default pickup spot (e.g. "front porch") |
| `share_pickup` | boolean | `true` | Whether pickup description is sent to buyer on confirmation |

### `listings` table — new column

| Column | Type | Default | Description |
|---|---|---|---|
| `pickup_description` | text | `null` | Per-listing pickup spot override; takes priority over profile default |

### Migration SQL

```sql
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address_unit text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS share_address boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pickup_description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS share_pickup boolean NOT NULL DEFAULT true;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS pickup_description text;
```

### Supabase trigger update

The `handle_new_user` trigger must be updated to read the new fields from `raw_user_meta_data` and insert them into `profiles`.

---

## Signup Form (`app/auth/signup/page.tsx`)

Add these fields in order, between State and Phone:

1. **Street Address** — text input, optional, name `address`
2. **Apt / Unit #** — text input, optional, name `address_unit`  
3. **Address share toggle** — ON by default  
   - Label: "Share address after approval"  
   - Helper text: "Your street address is only revealed to a buyer after you approve their purchase request."
4. **Pickup Spot** — text input, optional, name `pickup_description`, placeholder "e.g. front porch, behind the garden gnome"
5. **Pickup share toggle** — ON by default  
   - Label: "Share pickup spot after approval"  
   - Helper text: "Only revealed to a buyer after you approve their purchase."

Toggles use the same orange/cream pill button style as the existing `ContactToggle`. Each toggle emits a hidden input (name `share_address` / `share_pickup`, value `true`/`false`).

The `signUp` server action passes the four new fields in `options.data`.

---

## Profile Edit (`app/profile/ProfileCard.tsx` + `app/profile/actions.ts`)

Add the same four fields and two toggles to the Profile/Account edit form. The `updateProfile` server action is updated to persist `address`, `address_unit`, `share_address`, `pickup_description`, and `share_pickup`.

The `profile` prop type in `DashboardClient.tsx` is extended with the new fields so they can be passed down to `ProfileCard`.

---

## Post a Book (`app/post/PostForm.tsx` + `app/post/actions.ts`)

Add an optional **Pickup Spot** text input to the post form (placeholder "e.g. side gate — overrides your profile default"). Saves to `listings.pickup_description`.

---

## Confirmation Flow (`app/profile/actions.ts` — `confirmExchange`)

When the seller confirms, the action builds the contact message using only opted-in fields:

```
📍 Exchange confirmed! Here's how to connect:
👤 {username}
📌 {city}, {state}                         ← always included
🏠 {address} {address_unit}               ← only if share_address = true
📦 Pickup: {pickup_description}            ← only if share_pickup = true, uses listing override first then profile default
📞 {phone}                                 ← included if phone is non-empty (existing behaviour)
```

The seller profile query is updated to select the new fields:
```ts
.select('username, city, state, phone, address, address_unit, share_address, pickup_description, share_pickup')
```

The listing is also fetched to check `listings.pickup_description` for the per-listing override.

---

## Buyer Exchange Card (`app/profile/DashboardClient.tsx`)

The confirmed exchange card already shows city/state and phone. Update it to also show:
- Address line (`address` + `address_unit`) if `share_address` is true on the seller profile
- Pickup description (listing override → profile default) if `share_pickup` is true

The `Exchange` type's `seller` shape is extended with the new fields.

---

## New Reusable Component: `ShareToggle`

Extract a generic `ShareToggle` client component (replacing / alongside `ContactToggle`) with props:
- `name: string` — hidden input name
- `defaultValue?: boolean` — initial state (default `true`)
- `label: string` — button/toggle label
- `hint: string` — helper text shown below

Used in both signup and profile edit to avoid duplication.

---

## Files Changed

| File | Change |
|---|---|
| `supabase/schema.sql` | Add migration SQL for new columns |
| `app/auth/signup/page.tsx` | Add address fields + two ShareToggles |
| `app/auth/signup/ShareToggle.tsx` | New reusable toggle component |
| `app/profile/ProfileCard.tsx` | Add address fields + two ShareToggles |
| `app/profile/actions.ts` | Update `updateProfile` and `confirmExchange` |
| `app/post/PostForm.tsx` | Add per-listing pickup description field |
| `app/post/actions.ts` | Persist `pickup_description` on listing insert |
| `app/profile/DashboardClient.tsx` | Show address + pickup in buyer confirmed card; extend types |
