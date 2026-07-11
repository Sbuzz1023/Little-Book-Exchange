# Gate Heart/Save Buttons Behind Login

**Date:** 2026-07-10
**Status:** Approved

## Overview

`HeartButton` (listing cards, `/listings`) and `SaveButton` (listing detail, `/listings/[id]`) currently toggle local UI state for anyone, logged in or not. Logged-out visitors should be redirected to sign in instead of being able to click the heart/save.

No persistence exists today for hearts/saves (no DB table, no server write) — this change only gates the click. Adding real persisted saves is a separate future feature.

---

## Determining Login State (server-side)

Same rule the app already uses in `app/layout.tsx` for `Nav`: a visitor is logged in if either is true:
- the `lbe_demo_user` cookie is set, or
- `supabase.auth.getUser()` returns a user

### `app/listings/page.tsx`

Currently fetches listings only, no user check. Add a login check alongside the existing query and pass the result to every `HeartButton` on the page.

### `app/listings/[id]/page.tsx`

Already fetches `user` via `supabase.auth.getUser()` (used for `isOwner`). Add the demo-cookie check and OR it with `!!user` to get `isLoggedIn`, then pass to `SaveButton`. No extra Supabase call needed.

---

## Component Changes

### `components/HeartButton.tsx`

Add required prop `isLoggedIn: boolean`. On click:
- `isLoggedIn === true` → unchanged (toggle local `saved` state).
- `isLoggedIn === false` → `e.preventDefault()` / `e.stopPropagation()` (already present, keeps the card `Link` from navigating), then `window.location.href = '/auth/signin?redirect=' + window.location.pathname`. Do not toggle state.

### `components/SaveButton.tsx`

Same `isLoggedIn: boolean` prop and same click behavior as above (this button isn't wrapped in a `Link`, so no preventDefault/stopPropagation needed beyond what's already there).

---

## Out of Scope

- No new database table or server persistence for hearts/saves.
- No change to the demo-mode vs. real-Supabase auth detection logic used elsewhere (server actions in `listings/[id]/page.tsx` keep their own `isDemo` checks as-is).

---

## Files Changed

| File | Change |
|---|---|
| `components/HeartButton.tsx` | Add `isLoggedIn` prop; redirect to sign-in on click when logged out |
| `components/SaveButton.tsx` | Add `isLoggedIn` prop; redirect to sign-in on click when logged out |
| `app/listings/page.tsx` | Compute `isLoggedIn` (demo cookie or Supabase user), pass to each `HeartButton` |
| `app/listings/[id]/page.tsx` | Compute `isLoggedIn` from existing `user` + demo cookie, pass to `SaveButton` |
