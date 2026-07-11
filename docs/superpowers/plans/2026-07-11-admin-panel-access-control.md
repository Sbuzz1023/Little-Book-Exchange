# Admin Panel Access Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin panel's shared-passcode gate with real authorization — only a signed-in account with `profiles.is_admin = true` can load `/admin` at all, and only such an account ever sees the "Admin Panel" link in the site nav.

**Architecture:** `app/admin/page.tsx` becomes an async server component that checks the current user's `profiles.is_admin` and calls Next's `notFound()` (a plain 404, no "access denied" messaging) for anyone else — signed out, a regular signed-in user, or a demo-mode session. `app/admin/AdminClient.tsx` drops its passcode/`localStorage` gate entirely, since reaching this component now already implies authorization. `app/layout.tsx` fetches `is_admin` alongside the username it already fetches for the nav, and passes it to `components/Nav.tsx`, which only renders the "🔐 Admin Panel" link when that flag is true.

**Tech Stack:** Next.js 14 App Router, React 18, Supabase (`@supabase/ssr`).

## Global Constraints

- Only a real, signed-in account with `profiles.is_admin = true` may successfully load `/admin`. Every other case — signed out, a regular signed-in non-admin, or a demo-mode session (`lbe_demo_user` cookie) — must get Next's standard `notFound()` 404, never a redirect, an "access denied" page, or any message that confirms a hidden route exists there.
- The nav's "🔐 Admin Panel" link must only render when the current user's `isAdmin` is `true` — never shown to anyone else, on any surface it currently appears on.
- The shared passcode (`ADMIN_PASSCODE`, `localStorage` key `lbe_admin_auth`) is removed entirely — it is not kept as an additional layer alongside the real check.
- Demo-mode sessions can never satisfy the admin check (they have no real Supabase user, so this falls out naturally rather than needing a special case).

---

## File Structure

- Modify `app/admin/page.tsx` — becomes an async server component: check `profiles.is_admin` for the current user, `notFound()` if not an admin, otherwise render `AdminClient`.
- Modify `app/admin/AdminClient.tsx` — remove the passcode/`LoginGate`/`authed`-state gate entirely; data-fetching effects run unconditionally on mount; sign-out becomes a real `/auth/signout` link.
- Modify `components/Nav.tsx` — new `isAdmin` prop; the existing "Admin Panel" link only renders when it's true.
- Modify `app/layout.tsx` — fetch `is_admin` alongside `username`; pass `isAdmin` to `Nav`.

---

### Task 1: `app/admin/page.tsx` becomes a real server-side gate

**Files:**
- Modify: `app/admin/page.tsx`

**Interfaces:**
- Consumes: nothing new (uses the existing `createClient` from `@/lib/supabase/server` and the existing `profiles.is_admin` column).
- Produces: nothing consumed by later tasks — this task is independent of Tasks 2-4.

- [ ] **Step 1: Replace the whole file**

Replace `app/admin/page.tsx` with:

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

- [ ] **Step 2: Commit**

```bash
git add app/admin/page.tsx
git commit -m "feat: gate /admin behind a real is_admin check, 404 otherwise"
```

(At this point `AdminClient.tsx` still has its own passcode gate too — that's fine, it's just redundant until Task 2 removes it. The app is not broken in between: a real admin still needs the passcode AND is_admin to get in; anyone without is_admin gets a 404 before ever seeing the passcode screen.)

---

### Task 2: Remove the passcode gate from `AdminClient.tsx`

**Files:**
- Modify: `app/admin/AdminClient.tsx`

**Interfaces:**
- Consumes: Task 1's `page.tsx`, which now guarantees this component only ever renders for a real admin.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Remove `ADMIN_PASSCODE`**

Change:

```ts
const RECENT_ACTIVITY = [
  { id:1, type:'signup',  text:'Raj P. joined',                          time:'2h ago' },
  { id:2, type:'post',    text:'Lily T. posted "Charlotte\'s Web"',       time:'3h ago' },
  { id:3, type:'trade',   text:'Sarah M. & Devon H. completed a trade',   time:'5h ago' },
  { id:4, type:'report',  text:'Location report: Capitol Hill LFL',        time:'6h ago' },
  { id:5, type:'post',    text:'Maria C. posted "Gone Girl"',              time:'8h ago' },
  { id:6, type:'review',  text:'Tom B. left a flagged review',             time:'10h ago' },
  { id:7, type:'trade',   text:'Priya N. & James K. completed a trade',   time:'12h ago' },
  { id:8, type:'signup',  text:'Devon H. joined',                          time:'1d ago' },
]

const ADMIN_PASSCODE = '123890'

// ─── Types ───────────────────────────────────────────────────────────────────
```

to:

```ts
const RECENT_ACTIVITY = [
  { id:1, type:'signup',  text:'Raj P. joined',                          time:'2h ago' },
  { id:2, type:'post',    text:'Lily T. posted "Charlotte\'s Web"',       time:'3h ago' },
  { id:3, type:'trade',   text:'Sarah M. & Devon H. completed a trade',   time:'5h ago' },
  { id:4, type:'report',  text:'Location report: Capitol Hill LFL',        time:'6h ago' },
  { id:5, type:'post',    text:'Maria C. posted "Gone Girl"',              time:'8h ago' },
  { id:6, type:'review',  text:'Tom B. left a flagged review',             time:'10h ago' },
  { id:7, type:'trade',   text:'Priya N. & James K. completed a trade',   time:'12h ago' },
  { id:8, type:'signup',  text:'Devon H. joined',                          time:'1d ago' },
]

// ─── Types ───────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Remove the entire `LoginGate` function**

Change:

```ts
// ─── Admin login ─────────────────────────────────────────────────────────────

function LoginGate({ onAuth }: { onAuth: () => void }) {
  const [err, setErr] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  function submit(e: React.FormEvent) {
    e.preventDefault()
    const val = inputRef.current?.value ?? ''
    if (val === ADMIN_PASSCODE) { onAuth() }
    else { setErr(true); if (inputRef.current) inputRef.current.value = '' }
  }
  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="bg-white rounded-3xl p-8 shadow-xl border border-[#f1f5f9] w-full max-w-[380px]">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🔐</div>
          <h1 className="font-display text-[26px] text-[#1e293b]">Admin Access</h1>
          <p className="text-[13px] font-semibold text-[#94a3b8] mt-1">Enter your admin passcode to continue</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <input
            ref={inputRef}
            type="text"
            autoComplete="off"
            onChange={() => setErr(false)}
            placeholder="Admin passcode"
            className="w-full border-2 border-[#e2e8f0] rounded-xl px-4 py-3 font-bold text-[15px] focus:outline-none focus:border-bk-orange text-center tracking-widest"
            autoFocus
          />
          {err && <p className="text-red-500 font-bold text-[13px] text-center">Incorrect passcode</p>}
          <button type="submit" className="w-full bg-bk-orange text-white font-extrabold text-[15px] rounded-xl py-3 shadow-[0_3px_0_#c2410c]">
            Enter Admin Panel
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── User Locations Chart ────────────────────────────────────────────────────
```

to:

```ts
// ─── User Locations Chart ────────────────────────────────────────────────────
```

- [ ] **Step 3: Remove `authed` state and its `useEffect`, and un-gate the two data-fetching effects**

Change:

```ts
export default function AdminClient() {
  const [authed, setAuthed] = useState<'loading' | 'yes' | 'no'>('loading')
  const [tab, setTab] = useState<Tab>('dashboard')
  const [users, setUsers] = useState<User[]>([])
  const [pendingLocationReports, setPendingLocationReports] = useState(0)
  const [reviews, setReviews] = useState(MOCK_REVIEWS)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const hasTabCount = useRef(false)

  useEffect(() => {
    try {
      const k = localStorage.getItem('lbe_admin_auth')
      setAuthed(k === 'lbe_admin_2024' ? 'yes' : 'no')
    } catch { setAuthed('no') }
  }, [])

  useEffect(() => {
    if (authed !== 'yes') return
    const supabase = createClient()
    supabase
      .from('profiles')
      .select('id, username, email, city, state, created_at, is_admin')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!data) return
        setUsers(data.map(p => ({
          id: p.id,
          username: p.username || p.email || 'Unknown',
          email: p.email || '',
          joined: p.created_at ? p.created_at.slice(0, 10) : '',
          booksPosted: 0,
          booksSold: 0,
          booksBought: 0,
          credits: 0,
          status: 'active',
          city: p.city || '',
          state: p.state || '',
          bio: '',
          reviews: 0,
          is_admin: p.is_admin || false,
        })))
      })
  }, [authed])

  useEffect(() => {
    if (authed !== 'yes') return
    const supabase = createClient()
    supabase
      .from('location_reports')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count }) => {
        if (count !== null && !hasTabCount.current) setPendingLocationReports(count)
      })
  }, [authed])
```

to:

```ts
export default function AdminClient() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [users, setUsers] = useState<User[]>([])
  const [pendingLocationReports, setPendingLocationReports] = useState(0)
  const [reviews, setReviews] = useState(MOCK_REVIEWS)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const hasTabCount = useRef(false)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('profiles')
      .select('id, username, email, city, state, created_at, is_admin')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!data) return
        setUsers(data.map(p => ({
          id: p.id,
          username: p.username || p.email || 'Unknown',
          email: p.email || '',
          joined: p.created_at ? p.created_at.slice(0, 10) : '',
          booksPosted: 0,
          booksSold: 0,
          booksBought: 0,
          credits: 0,
          status: 'active',
          city: p.city || '',
          state: p.state || '',
          bio: '',
          reviews: 0,
          is_admin: p.is_admin || false,
        })))
      })
  }, [])

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('location_reports')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count }) => {
        if (count !== null && !hasTabCount.current) setPendingLocationReports(count)
      })
  }, [])
```

- [ ] **Step 4: Remove `handleAuth`, `handleSignOut`, and the passcode early-returns**

Change:

```ts
  function handleAuth() {
    try { localStorage.setItem('lbe_admin_auth', 'lbe_admin_2024') } catch {}
    setAuthed('yes')
  }

  function handleSignOut() {
    try { localStorage.removeItem('lbe_admin_auth') } catch {}
    setAuthed('no')
  }

  if (authed === 'loading') return <LoginGate onAuth={handleAuth} />
  if (authed === 'no') return <LoginGate onAuth={handleAuth} />

  const flaggedReviews = reviews.filter(r => r.flagged).length
```

to:

```ts
  const flaggedReviews = reviews.filter(r => r.flagged).length
```

- [ ] **Step 5: Replace the fake sign-out button with a real one**

Change:

```tsx
        <div className="px-5 py-4 border-t border-white/10">
          <button onClick={handleSignOut} className="text-[12px] font-bold text-white/40 hover:text-white/70 transition-colors">
            🚪 Sign Out
          </button>
        </div>
```

to:

```tsx
        <div className="px-5 py-4 border-t border-white/10">
          <a href="/auth/signout" className="text-[12px] font-bold text-white/40 hover:text-white/70 transition-colors">
            🚪 Sign Out
          </a>
        </div>
```

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors in `app/admin/*`.

- [ ] **Step 7: Commit**

```bash
git add app/admin/AdminClient.tsx
git commit -m "feat: remove passcode gate from AdminClient, real sign-out link"
```

---

### Task 3: `components/Nav.tsx` gains an `isAdmin` prop

**Files:**
- Modify: `components/Nav.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Nav({ userName, isAdmin }: { userName?: string | null; isAdmin?: boolean })` — Task 4's `app/layout.tsx` passes `isAdmin`.

- [ ] **Step 1: Widen the component's props**

Change:

```tsx
export default function Nav({ userName: serverUserName }: { userName?: string | null }) {
```

to:

```tsx
export default function Nav({ userName: serverUserName, isAdmin }: { userName?: string | null; isAdmin?: boolean }) {
```

- [ ] **Step 2: Gate the Admin Panel link**

Change:

```tsx
                  <div className="px-4 py-3 font-black text-[13px] border-b-2 border-gray-100" style={{ color: '#aaa' }}>{userName}</div>
                  <Link href="/admin" className="flex items-center gap-2.5 px-4 py-3 font-bold text-[14px] text-[#2d2d2d] hover:bg-[#fff7ed] hover:text-bk-orange transition-colors">🔐 Admin Panel</Link>
                  <div style={{ borderTop: '2px solid #f3f4f6' }}>
```

to:

```tsx
                  <div className="px-4 py-3 font-black text-[13px] border-b-2 border-gray-100" style={{ color: '#aaa' }}>{userName}</div>
                  {isAdmin && (
                    <Link href="/admin" className="flex items-center gap-2.5 px-4 py-3 font-bold text-[14px] text-[#2d2d2d] hover:bg-[#fff7ed] hover:text-bk-orange transition-colors">🔐 Admin Panel</Link>
                  )}
                  <div style={{ borderTop: '2px solid #f3f4f6' }}>
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors in `components/Nav.tsx`.

- [ ] **Step 4: Commit**

```bash
git add components/Nav.tsx
git commit -m "feat: only show Admin Panel nav link to real admins"
```

(`Nav` now accepts `isAdmin` but nothing passes it yet — it's optional and `undefined` is falsy, so the link simply stays hidden for everyone, including real admins, until Task 4 wires the real value. This is a temporary UX regression for admins, not a security issue — it fails toward hiding the link, never toward showing it to the wrong person.)

---

### Task 4: `app/layout.tsx` fetches and passes `isAdmin`

**Files:**
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: `Nav`'s new `isAdmin` prop from Task 3.
- Produces: nothing consumed by later tasks — final task in this plan.

- [ ] **Step 1: Replace the whole file**

Replace `app/layout.tsx` with:

```tsx
import type { Metadata, Viewport } from 'next'
import './globals.css'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import ScrollToTop from '@/components/ScrollToTop'
import { cookies } from 'next/headers'

export const metadata: Metadata = {
  title: 'LittleBookExchange — Local Used Books',
  description: 'Buy, sell, or give away used books with your neighbors.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let userName: string | null = null
  let isAdmin = false

  // Check demo cookie first — getUser() returns null silently with placeholder URL
  // so we can't rely on the catch block to read it
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

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors anywhere in the project attributable to this change.

- [ ] **Step 3: Verify the app builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx
git commit -m "feat: fetch is_admin for the nav's Admin Panel link"
```

---

## Full Test Suite Check

- [ ] Run: `npm run test:run`
- [ ] Expected: all existing tests still pass (this feature adds no new test files — `page.tsx`/`layout.tsx`/`Nav.tsx` auth-gating logic has no test coverage anywhere else in this codebase either, e.g. `app/locations/page.tsx`'s `getIsLoggedIn()`, consistent with the established convention).

## Manual Browser Verification

1. Sign in as a regular (non-admin) account. Confirm the avatar dropdown menu no longer shows "🔐 Admin Panel".
2. While still signed in as that non-admin account, navigate directly to `/admin`. Confirm you get a plain 404 page — no "access denied," no redirect to sign-in, nothing that hints a hidden route exists there.
3. Sign out entirely and navigate to `/admin`. Confirm the same plain 404.
4. Use the demo sign-in flow (`lbe_demo_user` cookie) and navigate to `/admin`. Confirm the same plain 404, and confirm the avatar dropdown doesn't show the Admin Panel link either.
5. In Supabase, confirm your own account has `is_admin = true` (set in the previous feature's bootstrap step). Sign in as that account. Confirm the avatar dropdown now shows "🔐 Admin Panel", and clicking it (or navigating to `/admin` directly) loads the panel normally.
6. From inside the panel, click "🚪 Sign Out" in the sidebar. Confirm it actually signs you out (matches the same behavior as the "Sign Out" link in the main site nav) and redirects home, rather than just returning you to a passcode screen.
7. Confirm all four admin tabs (Dashboard, Users, Locations, Reviews) still load and work normally once inside — this change only affects getting into the panel, not anything within it.
