# Admin Panel Access Control

**Date:** 2026-07-11
**Status:** Approved

## Overview

The admin panel (`/admin`) is currently gated only by a shared passcode (`123890`, hardcoded in `AdminClient.tsx`, checked client-side and remembered via `localStorage`). Anyone who knows the passcode — admin or not — can open the panel, regardless of which account (if any) they're signed in as. The panel's own `profiles.is_admin` column (added in the previous feature) currently only controls whether specific *actions inside* the panel are allowed (editing/deleting a location, resolving a report) — it plays no role in whether someone can get into the panel at all.

Separately, `components/Nav.tsx` shows a "🔐 Admin Panel" link in every signed-in user's avatar dropdown menu, regardless of admin status — so any account can discover the panel exists and navigate straight to it.

This feature replaces the passcode with real authorization: only a signed-in account with `profiles.is_admin = true` can reach `/admin` at all. Everyone else — signed out, signed in as a regular user, or in demo mode — gets a plain 404 if they try the URL directly, and never sees the nav link in the first place.

---

## `app/admin/page.tsx`

Becomes an async server component that checks admin status before rendering anything:

```tsx
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminClient from './AdminClient'

export const metadata: Metadata = {
  title: 'Admin Panel — LittleBookExchange',
}

async function checkIsAdmin(): Promise<boolean> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    return profile?.is_admin === true
  } catch {
    return false
  }
}

export default async function AdminPage() {
  const isAdmin = await checkIsAdmin()
  if (!isAdmin) notFound()
  return <AdminClient />
}
```

- Demo-mode visitors (the `lbe_demo_user` cookie fallback) are excluded automatically, with no special-case check needed: demo mode never creates a real Supabase session, so `supabase.auth.getUser()` returns no user for them, and `checkIsAdmin()` returns `false` the same way it would for any signed-out visitor.
- `notFound()` renders Next's standard 404 page — no "access denied" or "sign in required" messaging that would confirm a hidden route exists at this path.
- Wrapped in `try/catch` (matching the defensive pattern used elsewhere in this codebase, e.g. `app/layout.tsx`'s own user-fetching try/catch) so a Supabase hiccup fails closed (`isAdmin = false`, i.e. `notFound()`) rather than crashing or accidentally granting access.

---

## `components/Nav.tsx`

Add a new optional prop, `isAdmin`, and use it to gate the existing admin link — nothing else in this file changes:

```tsx
export default function Nav({ userName: serverUserName, isAdmin }: { userName?: string | null; isAdmin?: boolean }) {
```

```tsx
                  <div className="px-4 py-3 font-black text-[13px] border-b-2 border-gray-100" style={{ color: '#aaa' }}>{userName}</div>
                  {isAdmin && (
                    <Link href="/admin" className="flex items-center gap-2.5 px-4 py-3 font-bold text-[14px] text-[#2d2d2d] hover:bg-[#fff7ed] hover:text-bk-orange transition-colors">🔐 Admin Panel</Link>
                  )}
                  <div style={{ borderTop: '2px solid #f3f4f6' }}>
```

The mobile menu doesn't show an Admin Panel link today (desktop-only, pre-existing) — that stays as-is; see Out of Scope.

---

## `app/layout.tsx`

The existing user-fetching block already queries `profiles` for `username` when there's a real (non-demo) signed-in user. Add `is_admin` to that same query and thread it through as a new `isAdmin` value, defaulting to `false` for demo users and on any failure:

```tsx
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let userName: string | null = null
  let isAdmin = false

  const demoCookie = cookies().get('lbe_demo_user')?.value
  if (demoCookie) {
    userName = demoCookie
  } else {
    try {
      const { createClient } = await import('@/lib/supabase/server')
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: p } = await supabase.from('profiles').select('username, is_admin').eq('id', user.id).single()
        userName = p?.username ?? user.email ?? 'Me'
        isAdmin = p?.is_admin === true
      }
    } catch {}
  }

  return (
    <html lang="en">
      <body className="bg-cream min-h-screen flex flex-col">
        <ScrollToTop />
        <Nav userName={userName} isAdmin={isAdmin} />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
```

---

## `app/admin/AdminClient.tsx`

`page.tsx` now guarantees this component only ever renders for a real, signed-in admin — so all of the passcode machinery is removed rather than replaced:

- Delete `const ADMIN_PASSCODE = '123890'`.
- Delete the entire `LoginGate` function.
- Delete the `authed` state (`useState<'loading' | 'yes' | 'no'>`) and the `useEffect` that reads `localStorage.getItem('lbe_admin_auth')`.
- The two existing data-fetching `useEffect`s (profiles list, pending-report count) drop their `if (authed !== 'yes') return` guard and empty their dependency array (`[]`) — they now simply run once on mount, since mounting this component already implies the visitor is an authorized admin.
- Delete `handleAuth`.
- Delete `handleSignOut`, and replace the sidebar's "🚪 Sign Out" button with a real sign-out link, matching the same `/auth/signout` link `Nav.tsx` already uses elsewhere in the app:
  ```tsx
  <a href="/auth/signout" className="text-[12px] font-bold text-white/40 hover:text-white/70 transition-colors">
    🚪 Sign Out
  </a>
  ```
- Delete the two early-return lines (`if (authed === 'loading') return <LoginGate .../>` and `if (authed === 'no') return <LoginGate .../>`) — the component now renders its content unconditionally.

Nothing else in this file changes: the `Dashboard`, `UsersTab`, `LocationsAdminTab`, `ReviewsTab` tabs and all of their own logic are untouched.

---

## Out of Scope

- Adding an Admin Panel link to the mobile nav menu — it doesn't exist there today (desktop-only), and this feature doesn't need to add it; a non-admin already can't see or reach it on either surface, which is all this feature requires.
- Any UI for granting/revoking `is_admin` beyond what already exists (the Users tab's admin-toggle button, and the direct-SQL bootstrap path) — unchanged by this feature.
- Rate-limiting or logging of unauthorized `/admin` access attempts.
- Changing how `is_admin` itself is granted or the self-escalation guard trigger — both already shipped in the previous feature and are unaffected here.

---

## Files Changed

| File | Change |
|---|---|
| `app/admin/page.tsx` | Becomes an async server component: checks the signed-in user's `profiles.is_admin`, calls `notFound()` if not a real admin, otherwise renders `AdminClient` |
| `components/Nav.tsx` | New `isAdmin` prop; the existing "🔐 Admin Panel" link only renders when `isAdmin` is true |
| `app/layout.tsx` | Fetches `is_admin` alongside `username`; passes `isAdmin` to `Nav` (`false` for demo users and on any failure) |
| `app/admin/AdminClient.tsx` | Removes the passcode/`LoginGate`/`authed`-state machinery entirely; data-fetching effects run unconditionally on mount; sign-out becomes a real `/auth/signout` link |
