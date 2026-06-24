# Little Book Exchange — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local peer-to-peer used book marketplace where neighbors can list, buy, and give away books with in-app messaging and no payment processing.

**Architecture:** Next.js 14 App Router with Supabase for auth, PostgreSQL database, file storage, and realtime messaging. All pages except auth are server components; only the message thread uses a client component for realtime updates.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, Supabase (@supabase/ssr), Vitest, Google Fonts (Pacifico + Nunito), Vercel (deploy)

---

## File Structure

```
little-book-exchange/
├── app/
│   ├── layout.tsx                  # Root layout: fonts, nav, footer
│   ├── page.tsx                    # Homepage
│   ├── globals.css
│   ├── auth/
│   │   ├── signup/page.tsx
│   │   ├── signin/page.tsx
│   │   └── signout/route.ts
│   ├── listings/
│   │   ├── page.tsx                # Browse listings
│   │   └── [id]/page.tsx           # Book detail
│   ├── post/page.tsx               # Post a listing (auth required)
│   ├── messages/
│   │   ├── page.tsx                # Inbox (auth required)
│   │   └── [id]/page.tsx           # Thread (auth required)
│   └── profile/page.tsx            # Profile + my listings (auth required)
├── components/
│   ├── Nav.tsx
│   ├── Footer.tsx
│   ├── BookCard.tsx
│   ├── ScallopDivider.tsx
│   ├── KidDrawingBackground.tsx
│   └── MessageThread.tsx           # 'use client' – realtime
├── lib/
│   ├── types.ts
│   ├── utils.ts
│   └── supabase/
│       ├── client.ts               # Browser Supabase client
│       └── server.ts               # Server Supabase client
├── supabase/
│   └── migrations/001_initial.sql
├── middleware.ts
├── tailwind.config.ts
└── .env.local
```

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `tailwind.config.ts`, `app/globals.css`, `.env.local`, `.gitignore`

- [ ] **Step 1: Scaffold Next.js app**

```bash
cd "C:\Users\seanb\Desktop"
npx create-next-app@14 "Little Book Exchange" --typescript --tailwind --app --no-src-dir --import-alias "@/*"
cd "Little Book Exchange"
```

- [ ] **Step 2: Install dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 3: Configure Tailwind with brand colors and fonts**

Replace `tailwind.config.ts` with:

```ts
import type { Config } from 'tailwindcss'
import { fontFamily } from 'tailwindcss/defaultTheme'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#fffbf0',
        'bk-orange': '#f97316',
        'bk-orange-dark': '#c2410c',
        'bk-teal': '#0d9488',
        'bk-teal-dark': '#0f766e',
        'bk-yellow': '#fbbf24',
      },
      fontFamily: {
        sans: ['Nunito', ...fontFamily.sans],
        display: ['Pacifico', 'cursive'],
      },
    },
  },
  plugins: [],
}
export default config
```

- [ ] **Step 4: Update globals.css**

Replace `app/globals.css` with:

```css
@import url('https://fonts.googleapis.com/css2?family=Pacifico&family=Nunito:wght@400;600;700;800;900&display=swap');
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  background-color: #fffbf0;
}
```

- [ ] **Step 5: Create .env.local**

```bash
# Create the file with placeholder values — fill in after Supabase project is created
cat > .env.local << 'EOF'
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
EOF
```

- [ ] **Step 6: Configure Vitest**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: { '@': new URL('./', import.meta.url).pathname },
  },
})
```

Create `vitest.setup.ts`:

```ts
import '@testing-library/jest-dom'
```

Add to `package.json` scripts:

```json
"test": "vitest",
"test:run": "vitest run"
```

- [ ] **Step 7: Create .gitignore additions**

```bash
echo ".env.local" >> .gitignore
echo ".env" >> .gitignore
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js project with Tailwind and Supabase deps"
```

---

### Task 2: Supabase Project Setup

**Files:**
- Create: `supabase/migrations/001_initial.sql`

- [ ] **Step 1: Create Supabase project**

Go to https://supabase.com → New Project. Copy the **Project URL** and **anon public key** into `.env.local`.

- [ ] **Step 2: Write the SQL migration**

Create `supabase/migrations/001_initial.sql`:

```sql
-- profiles (extends auth.users)
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  name text not null,
  city text not null,
  created_at timestamptz default now()
);
alter table profiles enable row level security;
create policy "profiles public read" on profiles for select using (true);
create policy "profiles owner insert" on profiles for insert with check (auth.uid() = id);
create policy "profiles owner update" on profiles for update using (auth.uid() = id);

-- listings
create type listing_condition as enum ('good', 'fair', 'well-loved');
create type listing_status as enum ('active', 'sold', 'given');

create table listings (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  title text not null,
  author text not null,
  condition listing_condition not null,
  price numeric,
  description text,
  photo_url text,
  city text not null,
  status listing_status default 'active' not null,
  created_at timestamptz default now()
);
alter table listings enable row level security;
create policy "listings public read" on listings for select using (true);
create policy "listings owner insert" on listings for insert with check (auth.uid() = user_id);
create policy "listings owner update" on listings for update using (auth.uid() = user_id);
create policy "listings owner delete" on listings for delete using (auth.uid() = user_id);

-- conversations
create table conversations (
  id uuid default gen_random_uuid() primary key,
  listing_id uuid references listings(id) on delete cascade not null,
  buyer_id uuid references profiles(id) on delete cascade not null,
  seller_id uuid references profiles(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(listing_id, buyer_id)
);
alter table conversations enable row level security;
create policy "conversations participant read" on conversations for select
  using (auth.uid() = buyer_id or auth.uid() = seller_id);
create policy "conversations buyer insert" on conversations for insert
  with check (auth.uid() = buyer_id);

-- messages
create table messages (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references conversations(id) on delete cascade not null,
  sender_id uuid references profiles(id) on delete cascade not null,
  body text not null,
  created_at timestamptz default now()
);
alter table messages enable row level security;
create policy "messages participant read" on messages for select using (
  exists (
    select 1 from conversations c
    where c.id = messages.conversation_id
    and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
  )
);
create policy "messages participant insert" on messages for insert with check (
  auth.uid() = sender_id and
  exists (
    select 1 from conversations c
    where c.id = messages.conversation_id
    and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
  )
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, city)
  values (
    new.id,
    new.raw_user_meta_data->>'name',
    new.raw_user_meta_data->>'city'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Storage bucket for book photos
insert into storage.buckets (id, name, public)
  values ('book-photos', 'book-photos', true)
  on conflict do nothing;

create policy "book photos public read" on storage.objects
  for select using (bucket_id = 'book-photos');
create policy "authenticated upload" on storage.objects
  for insert with check (bucket_id = 'book-photos' and auth.role() = 'authenticated');
create policy "owner delete" on storage.objects
  for delete using (bucket_id = 'book-photos' and auth.uid()::text = owner);
```

- [ ] **Step 3: Run migration in Supabase**

In Supabase dashboard → SQL Editor → paste contents of `001_initial.sql` → Run.

- [ ] **Step 4: Enable Realtime for messages table**

Supabase dashboard → Database → Replication → enable `messages` table.

- [ ] **Step 5: Commit**

```bash
git add supabase/
git commit -m "feat: add database schema, RLS policies, and storage bucket"
```

---

### Task 3: Types, Utils, and Supabase Clients

**Files:**
- Create: `lib/types.ts`, `lib/utils.ts`, `lib/supabase/client.ts`, `lib/supabase/server.ts`, `middleware.ts`
- Test: `lib/utils.test.ts`

- [ ] **Step 1: Write failing tests for utils**

Create `lib/utils.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatPrice, formatCondition, getConditionBadgeClass } from './utils'

describe('formatPrice', () => {
  it('returns Free when price is null', () => {
    expect(formatPrice(null)).toBe('Free')
  })
  it('returns Free when price is 0', () => {
    expect(formatPrice(0)).toBe('Free')
  })
  it('formats a price with dollar sign and 2 decimals', () => {
    expect(formatPrice(3)).toBe('$3.00')
    expect(formatPrice(12.5)).toBe('$12.50')
  })
})

describe('formatCondition', () => {
  it('capitalizes good', () => expect(formatCondition('good')).toBe('Good'))
  it('capitalizes fair', () => expect(formatCondition('fair')).toBe('Fair'))
  it('formats well-loved', () => expect(formatCondition('well-loved')).toBe('Well-Loved'))
})

describe('getConditionBadgeClass', () => {
  it('returns yellow classes for good', () => {
    expect(getConditionBadgeClass('good')).toContain('yellow')
  })
  it('returns orange classes for fair', () => {
    expect(getConditionBadgeClass('fair')).toContain('orange')
  })
  it('returns red classes for well-loved', () => {
    expect(getConditionBadgeClass('well-loved')).toContain('red')
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm run test:run
```

Expected: FAIL — `utils` not found.

- [ ] **Step 3: Create `lib/types.ts`**

```ts
export type Profile = {
  id: string
  name: string
  city: string
  created_at: string
}

export type ListingCondition = 'good' | 'fair' | 'well-loved'
export type ListingStatus = 'active' | 'sold' | 'given'

export type Listing = {
  id: string
  user_id: string
  title: string
  author: string
  condition: ListingCondition
  price: number | null
  description: string | null
  photo_url: string | null
  city: string
  status: ListingStatus
  created_at: string
  profiles?: Profile
}

export type Conversation = {
  id: string
  listing_id: string
  buyer_id: string
  seller_id: string
  created_at: string
  listings?: Listing
  buyer?: Profile
  seller?: Profile
  messages?: Message[]
}

export type Message = {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  created_at: string
  profiles?: Profile
}
```

- [ ] **Step 4: Create `lib/utils.ts`**

```ts
export function formatPrice(price: number | null): string {
  if (!price) return 'Free'
  return `$${price.toFixed(2)}`
}

export function formatCondition(condition: string): string {
  const map: Record<string, string> = {
    good: 'Good',
    fair: 'Fair',
    'well-loved': 'Well-Loved',
  }
  return map[condition] ?? condition
}

export function getConditionBadgeClass(condition: string): string {
  const map: Record<string, string> = {
    good: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    fair: 'bg-orange-100 text-orange-800 border-orange-300',
    'well-loved': 'bg-red-100 text-red-800 border-red-300',
  }
  return map[condition] ?? 'bg-gray-100 text-gray-700'
}

export function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
npm run test:run
```

Expected: PASS (3 test suites, 8 tests).

- [ ] **Step 6: Create `lib/supabase/client.ts`**

```ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 7: Create `lib/supabase/server.ts`**

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export function createClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}
```

- [ ] **Step 8: Create `middleware.ts`**

```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const protectedPaths = ['/post', '/messages', '/profile']
  const isProtected = protectedPaths.some(p => request.nextUrl.pathname.startsWith(p))

  if (isProtected && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/signin'
    url.searchParams.set('redirect', request.nextUrl.pathname)
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 9: Commit**

```bash
git add lib/ middleware.ts
git commit -m "feat: add types, utils, Supabase clients, and auth middleware"
```

---

### Task 4: Shared UI Components

**Files:**
- Create: `components/ScallopDivider.tsx`, `components/KidDrawingBackground.tsx`, `components/Nav.tsx`, `components/Footer.tsx`
- Test: `components/ScallopDivider.test.tsx`, `components/BookCard.test.tsx`

- [ ] **Step 1: Create `components/ScallopDivider.tsx`**

```tsx
type Props = {
  color: string        // e.g. '#f97316'
  bgColor?: string     // color behind the scallop
  direction?: 'down' | 'up'
}

export default function ScallopDivider({ color, bgColor = 'transparent', direction = 'down' }: Props) {
  const encodedColor = encodeURIComponent(color)
  const path = direction === 'down'
    ? `M0,22 Q15,0 30,22 Q45,0 60,22 Q75,0 90,22 Q105,0 120,22 L120,22 L0,22Z`
    : `M0,0 Q15,22 30,0 Q45,22 60,0 Q75,22 90,0 Q105,22 120,0 L120,22 L0,22Z`

  const svgUrl = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 22'%3E%3Cpath d='${path}' fill='${encodedColor}'/%3E%3C/svg%3E")`

  return (
    <div
      style={{
        height: 22,
        backgroundImage: svgUrl,
        backgroundRepeat: 'repeat-x',
        backgroundSize: '120px 22px',
        backgroundColor: bgColor,
      }}
    />
  )
}
```

- [ ] **Step 2: Write test for ScallopDivider**

Create `components/ScallopDivider.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ScallopDivider from './ScallopDivider'

describe('ScallopDivider', () => {
  it('renders a div with the given color in the background-image', () => {
    const { container } = render(<ScallopDivider color="#f97316" />)
    const div = container.firstChild as HTMLElement
    expect(div.style.backgroundImage).toContain('f97316')
  })

  it('has height of 22px', () => {
    const { container } = render(<ScallopDivider color="#f97316" />)
    const div = container.firstChild as HTMLElement
    expect(div.style.height).toBe('22px')
  })
})
```

- [ ] **Step 3: Run tests**

```bash
npm run test:run
```

Expected: PASS.

- [ ] **Step 4: Create `components/KidDrawingBackground.tsx`**

```tsx
export default function KidDrawingBackground() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 1400 560"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Sun top-left */}
      <g opacity="0.22" transform="translate(60,30)">
        <circle cx="50" cy="50" r="35" fill="#fbbf24"/>
        {[0,45,90,135,180,225,270,315].map((deg, i) => {
          const r = (deg * Math.PI) / 180
          return <line key={i} x1={50+35*Math.sin(r)} y1={50-35*Math.cos(r)} x2={50+48*Math.sin(r)} y2={50-48*Math.cos(r)} stroke="#fbbf24" strokeWidth="5" strokeLinecap="round"/>
        })}
        <circle cx="50" cy="50" r="28" fill="#fde68a"/>
        <circle cx="40" cy="44" r="4" fill="#f97316"/>
        <circle cx="60" cy="44" r="4" fill="#f97316"/>
        <path d="M40 58 Q50 68 60 58" stroke="#f97316" strokeWidth="3" fill="none" strokeLinecap="round"/>
      </g>

      {/* Stick figure family */}
      <g opacity="0.18" transform="translate(170,210)">
        {/* Dad */}
        <circle cx="30" cy="14" r="12" fill="none" stroke="#f97316" strokeWidth="3"/>
        <circle cx="26" cy="12" r="2" fill="#f97316"/><circle cx="34" cy="12" r="2" fill="#f97316"/>
        <path d="M26 18 Q30 22 34 18" stroke="#f97316" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <line x1="30" y1="26" x2="30" y2="65" stroke="#f97316" strokeWidth="3.5" strokeLinecap="round"/>
        <line x1="30" y1="38" x2="5" y2="55" stroke="#f97316" strokeWidth="3" strokeLinecap="round"/>
        <line x1="30" y1="38" x2="65" y2="42" stroke="#f97316" strokeWidth="3" strokeLinecap="round"/>
        <line x1="30" y1="65" x2="15" y2="95" stroke="#f97316" strokeWidth="3.5" strokeLinecap="round"/>
        <line x1="30" y1="65" x2="45" y2="95" stroke="#f97316" strokeWidth="3.5" strokeLinecap="round"/>
        <rect x="18" y="2" width="24" height="8" fill="#f97316" rx="3"/>
        {/* Mom */}
        <circle cx="80" cy="18" r="11" fill="none" stroke="#0d9488" strokeWidth="3"/>
        <circle cx="76" cy="16" r="2" fill="#0d9488"/><circle cx="84" cy="16" r="2" fill="#0d9488"/>
        <path d="M76 22 Q80 26 84 22" stroke="#0d9488" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <path d="M80 29 L60 90 L100 90 Z" fill="none" stroke="#0d9488" strokeWidth="3" strokeLinejoin="round"/>
        <line x1="80" y1="42" x2="55" y2="55" stroke="#0d9488" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="80" y1="42" x2="105" y2="50" stroke="#0d9488" strokeWidth="2.5" strokeLinecap="round"/>
        {/* Kid */}
        <circle cx="52" cy="42" r="9" fill="none" stroke="#fbbf24" strokeWidth="2.5"/>
        <circle cx="49" cy="40" r="1.5" fill="#fbbf24"/><circle cx="55" cy="40" r="1.5" fill="#fbbf24"/>
        <path d="M49 46 Q52 49 55 46" stroke="#fbbf24" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <line x1="52" y1="51" x2="52" y2="75" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="52" y1="58" x2="40" y2="68" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round"/>
        <line x1="52" y1="58" x2="64" y2="65" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round"/>
        <line x1="52" y1="75" x2="44" y2="92" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="52" y1="75" x2="60" y2="92" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round"/>
      </g>

      {/* House left */}
      <g opacity="0.2" transform="translate(30,190)">
        <polygon points="10,60 70,10 130,60" fill="#f97316"/>
        <rect x="85" y="15" width="16" height="28" fill="#fca5a5" rx="3"/>
        <circle cx="93" cy="8" r="6" fill="#e5e7eb"/>
        <rect x="20" y="58" width="100" height="70" fill="#fff7ed" stroke="#f97316" strokeWidth="3" rx="4"/>
        <rect x="55" y="90" width="30" height="38" fill="#0d9488" rx="4"/>
        <circle cx="80" cy="110" r="3" fill="#fbbf24"/>
        <rect x="28" y="70" width="22" height="20" fill="#bfdbfe" rx="3" stroke="#3b82f6" strokeWidth="2"/>
        <rect x="90" y="70" width="22" height="20" fill="#bfdbfe" rx="3" stroke="#3b82f6" strokeWidth="2"/>
        <path d="M0,128 Q70,118 140,128" stroke="#16a34a" strokeWidth="4" fill="none" strokeLinecap="round"/>
      </g>

      {/* Rainbow center-top */}
      <g opacity="0.18" transform="translate(340,20)">
        {['#f97316','#fbbf24','#4ade80','#3b82f6','#a78bfa'].map((color, i) => (
          <path key={i} d={`M${10+i*10} 90 Q80 ${10+i*12} ${150-i*10} 90`} stroke={color} strokeWidth={9-i} fill="none" strokeLinecap="round"/>
        ))}
        <ellipse cx="10" cy="90" rx="16" ry="10" fill="#e5e7eb"/>
        <ellipse cx="150" cy="90" rx="16" ry="10" fill="#e5e7eb"/>
      </g>

      {/* Flowers bottom-left */}
      <g opacity="0.2" transform="translate(30,400)">
        {[20, 55, 90].map((x, i) => {
          const colors = ['#fca5a5','#a5f3fc','#fde68a']
          const centers = ['#fbbf24','#f97316','#0d9488']
          return (
            <g key={x}>
              <line x1={x} y1="80" x2={x} y2="42" stroke="#16a34a" strokeWidth="4" strokeLinecap="round"/>
              <circle cx={x} cy="30" r="12" fill={colors[i]}/>
              {[0,90,180,270].map((deg, j) => {
                const r = (deg * Math.PI) / 180
                return <circle key={j} cx={x+12*Math.sin(r)} cy={30-12*Math.cos(r)} r="6" fill={colors[i]}/>
              })}
              <circle cx={x} cy="30" r="7" fill={centers[i]}/>
            </g>
          )
        })}
        <path d="M0,80 Q60,68 120,80" stroke="#16a34a" strokeWidth="4" fill="none" strokeLinecap="round"/>
      </g>

      {/* House right */}
      <g opacity="0.18" transform="translate(1200,200)">
        <polygon points="10,55 75,5 140,55" fill="#0d9488"/>
        <rect x="85" y="8" width="14" height="30" fill="#fca5a5" rx="2"/>
        <rect x="20" y="53" width="110" height="75" fill="#fffbf0" stroke="#0d9488" strokeWidth="3" rx="3"/>
        <rect x="55" y="88" width="28" height="40" fill="#f97316" rx="4"/>
        <rect x="26" y="64" width="22" height="20" fill="#bfdbfe" rx="3" stroke="#3b82f6" strokeWidth="2"/>
        <rect x="95" y="64" width="22" height="20" fill="#bfdbfe" rx="3" stroke="#3b82f6" strokeWidth="2"/>
        <path d="M0,128 Q75,118 148,128" stroke="#16a34a" strokeWidth="4" fill="none" strokeLinecap="round"/>
      </g>

      {/* Cat bottom-right */}
      <g opacity="0.18" transform="translate(1290,380)">
        <ellipse cx="45" cy="65" rx="38" ry="30" fill="#a78bfa"/>
        <circle cx="45" cy="28" r="24" fill="#a78bfa"/>
        <polygon points="24,12 18,0 34,8" fill="#a78bfa"/>
        <polygon points="27,10 22,3 31,8" fill="#fca5a5"/>
        <polygon points="66,12 72,0 56,8" fill="#a78bfa"/>
        <polygon points="63,10 68,3 59,8" fill="#fca5a5"/>
        <ellipse cx="36" cy="25" rx="5" ry="6" fill="#1a1a1a"/>
        <ellipse cx="54" cy="25" rx="5" ry="6" fill="#1a1a1a"/>
        <circle cx="37" cy="23" r="2" fill="#fff"/><circle cx="55" cy="23" r="2" fill="#fff"/>
        <polygon points="45,33 42,37 48,37" fill="#fca5a5"/>
        <line x1="20" y1="34" x2="38" y2="36" stroke="#1a1a1a" strokeWidth="1.5"/>
        <line x1="20" y1="38" x2="38" y2="38" stroke="#1a1a1a" strokeWidth="1.5"/>
        <line x1="52" y1="36" x2="70" y2="34" stroke="#1a1a1a" strokeWidth="1.5"/>
        <line x1="52" y1="38" x2="70" y2="38" stroke="#1a1a1a" strokeWidth="1.5"/>
        <path d="M83 70 Q110 50 105 30 Q100 15 88 20" stroke="#a78bfa" strokeWidth="6" fill="none" strokeLinecap="round"/>
      </g>

      {/* Flowers bottom-right */}
      <g opacity="0.18" transform="translate(1100,395)">
        {[20,55].map((x, i) => {
          const colors = ['#fb7185','#a5f3fc']
          const centers = ['#fbbf24','#f97316']
          return (
            <g key={x}>
              <line x1={x} y1="80" x2={x} y2="42" stroke="#16a34a" strokeWidth="4" strokeLinecap="round"/>
              <circle cx={x} cy="30" r="12" fill={colors[i]}/>
              {[0,90,180,270].map((deg, j) => {
                const r = (deg * Math.PI) / 180
                return <circle key={j} cx={x+12*Math.sin(r)} cy={30-12*Math.cos(r)} r="6" fill={colors[i]}/>
              })}
              <circle cx={x} cy="30" r="7" fill={centers[i]}/>
            </g>
          )
        })}
        <path d="M0,80 Q55,68 110,80" stroke="#16a34a" strokeWidth="4" fill="none" strokeLinecap="round"/>
      </g>

      {/* Stars */}
      {[[500,50],[580,90],[900,60],[450,480],[980,470]].map(([x,y],i) => (
        <text key={i} x={x} y={y} fontSize="22" fill="#fbbf24" opacity="0.18">★</text>
      ))}

      {/* Butterfly top-right */}
      <g opacity="0.2" transform="translate(1230,80)">
        <ellipse cx="30" cy="20" rx="28" ry="18" fill="#fca5a5" transform="rotate(-30 30 20)"/>
        <ellipse cx="30" cy="35" rx="22" ry="15" fill="#fca5a5" transform="rotate(20 30 35)"/>
        <ellipse cx="30" cy="20" rx="28" ry="18" fill="#a5f3fc" transform="rotate(210 30 20)"/>
        <ellipse cx="30" cy="35" rx="22" ry="15" fill="#a5f3fc" transform="rotate(160 30 35)"/>
        <ellipse cx="30" cy="27" rx="4" ry="14" fill="#1a1a1a"/>
        <path d="M28 14 Q20 4 14 2" stroke="#1a1a1a" strokeWidth="1.5" fill="none"/>
        <path d="M32 14 Q40 4 46 2" stroke="#1a1a1a" strokeWidth="1.5" fill="none"/>
        <circle cx="14" cy="2" r="3" fill="#f97316"/>
        <circle cx="46" cy="2" r="3" fill="#f97316"/>
      </g>

      {/* Dotted frame */}
      <rect x="10" y="10" width="1380" height="540" rx="12" fill="none" stroke="#f97316" strokeWidth="3" strokeDasharray="14,10" opacity="0.1"/>
    </svg>
  )
}
```

- [ ] **Step 5: Create `components/Nav.tsx`**

```tsx
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function Nav() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <nav className="relative bg-white z-10 flex items-center justify-between px-8 h-16 border-b-4 border-bk-orange">
      <Link href="/" className="font-display text-2xl text-bk-orange flex items-center gap-2">
        <span className="bg-bk-orange rounded-full w-9 h-9 flex items-center justify-center text-lg">🏡</span>
        LittleBookExchange
      </Link>
      <div className="flex items-center gap-6">
        <Link href="/listings" className="font-bold text-gray-700 hover:text-bk-orange transition-colors">Browse</Link>
        <Link href="/post" className="font-bold text-gray-700 hover:text-bk-orange transition-colors">Post a Book</Link>
        {user ? (
          <>
            <Link href="/messages" className="font-bold text-gray-700 hover:text-bk-orange transition-colors">Messages</Link>
            <Link href="/profile" className="font-bold text-gray-700 hover:text-bk-orange transition-colors">Profile</Link>
            <form action="/auth/signout" method="post">
              <button className="font-bold text-gray-500 hover:text-bk-orange transition-colors">Sign Out</button>
            </form>
          </>
        ) : (
          <>
            <Link href="/auth/signin" className="font-bold text-gray-700 hover:text-bk-orange transition-colors">Sign In</Link>
            <Link href="/auth/signup" className="bg-bk-orange text-white px-5 py-2 rounded-full font-extrabold hover:bg-bk-orange-dark transition-colors">Join Free</Link>
          </>
        )}
      </div>
    </nav>
  )
}
```

- [ ] **Step 6: Create `components/Footer.tsx`**

```tsx
export default function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-400 text-center py-7 text-sm font-bold">
      <span className="font-display text-bk-orange text-base">LittleBookExchange</span>
      {' · '}Books finding new homes in your neighborhood{' · '}© {new Date().getFullYear()}
    </footer>
  )
}
```

- [ ] **Step 7: Update `app/layout.tsx`**

```tsx
import type { Metadata } from 'next'
import './globals.css'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'LittleBookExchange — Local Used Books',
  description: 'Buy, sell, or give away used books with your neighbors.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-cream min-h-screen flex flex-col">
        <Nav />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
```

- [ ] **Step 8: Commit**

```bash
git add components/ app/layout.tsx app/globals.css
git commit -m "feat: add shared components — Nav, Footer, ScallopDivider, KidDrawingBackground"
```

---

### Task 5: BookCard Component

**Files:**
- Create: `components/BookCard.tsx`
- Test: `components/BookCard.test.tsx`

- [ ] **Step 1: Write failing test**

Create `components/BookCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import BookCard from './BookCard'
import type { Listing } from '@/lib/types'

const listing: Listing = {
  id: '1',
  user_id: 'u1',
  title: 'The Great Gatsby',
  author: 'F. Scott Fitzgerald',
  condition: 'good',
  price: null,
  description: null,
  photo_url: null,
  city: 'Chicago, IL',
  status: 'active',
  created_at: new Date().toISOString(),
}

describe('BookCard', () => {
  it('renders title and author', () => {
    render(<BookCard listing={listing} />)
    expect(screen.getByText('The Great Gatsby')).toBeInTheDocument()
    expect(screen.getByText('F. Scott Fitzgerald')).toBeInTheDocument()
  })

  it('shows FREE when price is null', () => {
    render(<BookCard listing={listing} />)
    expect(screen.getByText('FREE')).toBeInTheDocument()
  })

  it('shows price when set', () => {
    render(<BookCard listing={{ ...listing, price: 3.5 }} />)
    expect(screen.getByText('$3.50')).toBeInTheDocument()
  })

  it('shows city', () => {
    render(<BookCard listing={listing} />)
    expect(screen.getByText('Chicago, IL')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test — expect failure**

```bash
npm run test:run
```

Expected: FAIL — `BookCard` not found.

- [ ] **Step 3: Create `components/BookCard.tsx`**

```tsx
import Link from 'next/link'
import Image from 'next/image'
import type { Listing } from '@/lib/types'
import { formatPrice, formatCondition, getConditionBadgeClass } from '@/lib/utils'

const COVER_GRADIENTS = [
  'from-yellow-200 to-red-200',
  'from-teal-200 to-blue-200',
  'from-pink-200 to-rose-200',
  'from-purple-200 to-blue-200',
  'from-green-200 to-yellow-200',
  'from-orange-200 to-pink-200',
]

function coverGradient(id: string) {
  const sum = id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return COVER_GRADIENTS[sum % COVER_GRADIENTS.length]
}

export default function BookCard({ listing }: { listing: Listing }) {
  const isFree = !listing.price
  return (
    <Link href={`/listings/${listing.id}`} className="block group">
      <div className="bg-white rounded-2xl overflow-hidden border-2 border-gray-100 shadow-[0_5px_0_#e5e7eb] hover:-translate-y-1 transition-transform">
        {/* Cover */}
        <div className={`relative h-40 bg-gradient-to-br ${coverGradient(listing.id)} flex items-center justify-center text-5xl`}>
          {listing.photo_url ? (
            <Image src={listing.photo_url} alt={listing.title} fill className="object-cover"/>
          ) : (
            <span>📚</span>
          )}
          <span className={`absolute top-2 right-2 px-3 py-1 rounded-full text-xs font-black ${isFree ? 'bg-bk-teal text-white' : 'bg-bk-orange text-white'}`}>
            {isFree ? 'FREE' : formatPrice(listing.price)}
          </span>
        </div>
        {/* Info */}
        <div className="p-4">
          <p className="font-black text-sm truncate">{listing.title}</p>
          <p className="text-xs text-gray-400 font-semibold mb-3">{listing.author}</p>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-bold px-2 py-1 rounded-lg border ${getConditionBadgeClass(listing.condition)}`}>
              {formatCondition(listing.condition)}
            </span>
            <span className="text-xs text-gray-300 font-bold">{listing.city}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test:run
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/BookCard.tsx components/BookCard.test.tsx
git commit -m "feat: add BookCard component"
```

---

### Task 6: Homepage

**Files:**
- Create: `app/page.tsx`

- [ ] **Step 1: Create `app/page.tsx`**

```tsx
import { createClient } from '@/lib/supabase/server'
import BookCard from '@/components/BookCard'
import ScallopDivider from '@/components/ScallopDivider'
import KidDrawingBackground from '@/components/KidDrawingBackground'
import Link from 'next/link'
import type { Listing } from '@/lib/types'

export default async function HomePage({
  searchParams,
}: {
  searchParams: { city?: string; type?: string }
}) {
  const supabase = createClient()
  const city = searchParams.city ?? ''
  const type = searchParams.type ?? 'all'

  let query = supabase
    .from('listings')
    .select('*, profiles(name, city)')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(12)

  if (city) query = query.ilike('city', `%${city}%`)
  if (type === 'free') query = query.is('price', null)
  if (type === 'sale') query = query.not('price', 'is', null)

  const { data: listings } = await query

  return (
    <>
      {/* Hero */}
      <section className="relative bg-cream overflow-hidden min-h-[500px] flex items-center justify-center text-center px-8 py-20">
        <KidDrawingBackground />
        <div className="relative z-10">
          <h1 className="font-display text-5xl leading-tight text-gray-900 mb-4 max-w-2xl mx-auto">
            Books finding new homes with{' '}
            <span className="text-bk-orange">your neighbors.</span>
          </h1>
          <p className="text-lg text-gray-500 font-semibold max-w-md mx-auto mb-8 leading-relaxed">
            A neighborhood book exchange — online. Buy, sell, or give away used books right in your community.
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Link href="/listings" className="bg-bk-orange text-white px-8 py-3 rounded-full font-extrabold text-base shadow-[0_5px_0_#c2410c] hover:shadow-[0_3px_0_#c2410c] hover:translate-y-0.5 transition-all">
              🏙️ Browse Books Near Me
            </Link>
            <Link href="/post" className="bg-bk-teal text-white px-8 py-3 rounded-full font-extrabold text-base shadow-[0_5px_0_#0f766e] hover:shadow-[0_3px_0_#0f766e] hover:translate-y-0.5 transition-all">
              📚 Post a Book
            </Link>
          </div>
        </div>
      </section>

      {/* Search Band */}
      <ScallopDivider color="#f97316" bgColor="#fffbf0" direction="down"/>
      <div className="bg-bk-orange py-4 px-8">
        <form className="bg-white rounded-2xl p-5 max-w-2xl mx-auto flex gap-3 items-center shadow-[0_6px_0_rgba(0,0,0,0.12)]">
          <span className="text-xl">📍</span>
          <input
            name="city"
            defaultValue={city}
            placeholder="Enter your city..."
            className="flex-1 border-2 border-orange-200 rounded-xl px-4 py-2.5 font-bold text-sm bg-cream focus:outline-none focus:border-bk-orange"
          />
          <select
            name="type"
            defaultValue={type}
            className="border-2 border-orange-200 rounded-xl px-3 py-2.5 font-bold text-sm bg-cream focus:outline-none"
          >
            <option value="all">All Books</option>
            <option value="sale">For Sale</option>
            <option value="free">Free Only</option>
          </select>
          <button type="submit" className="bg-bk-orange text-white px-6 py-2.5 rounded-xl font-extrabold text-sm shadow-[0_3px_0_#c2410c] hover:shadow-[0_1px_0_#c2410c] hover:translate-y-0.5 transition-all">
            Find Books
          </button>
        </form>
      </div>
      <ScallopDivider color="#f97316" bgColor="#fffbf0" direction="up"/>

      {/* Listings Grid */}
      <section className="max-w-6xl mx-auto px-8 py-10">
        <div className="flex items-center gap-4 mb-4 flex-wrap">
          {['all','sale','free'].map(t => (
            <Link
              key={t}
              href={`/?city=${city}&type=${t}`}
              className={`px-5 py-2 rounded-full text-sm font-extrabold border-2 transition-colors ${
                type === t ? 'bg-bk-orange text-white border-bk-orange' : 'bg-white text-gray-500 border-gray-200 hover:border-bk-orange'
              }`}
            >
              {t === 'all' ? 'All Books' : t === 'sale' ? '📗 For Sale' : '🎁 Free'}
            </Link>
          ))}
        </div>

        {listings && listings.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {(listings as Listing[]).map(l => <BookCard key={l.id} listing={l}/>)}
          </div>
        ) : (
          <div className="text-center py-20 text-gray-400 font-bold">
            <div className="text-5xl mb-4">📭</div>
            <p>No books found{city ? ` in ${city}` : ''}. Be the first to post one!</p>
          </div>
        )}
      </section>

      {/* How It Works */}
      <ScallopDivider color="#0d9488" bgColor="#fffbf0" direction="down"/>
      <section className="bg-emerald-50 py-14 px-8 text-center">
        <h2 className="font-display text-3xl mb-2">How it works 🏡</h2>
        <p className="text-gray-500 font-semibold mb-10">As simple as a little free library — just online.</p>
        <div className="flex gap-5 justify-center flex-wrap max-w-3xl mx-auto">
          {[
            { n:1, icon:'🏙️', title:'Set your city', desc:'Create a free account and set your city to see books near you.' },
            { n:2, icon:'📚', title:'Browse or post', desc:'Browse for free. Post books to sell or give away to neighbors.' },
            { n:3, icon:'💬', title:'Message a neighbor', desc:'Message the seller through the site to arrange a local meetup.' },
            { n:4, icon:'🤝', title:'Meet & exchange', desc:'Meet locally and pay however works best for both of you.' },
          ].map(s => (
            <div key={s.n} className="bg-white rounded-2xl p-6 flex-1 min-w-[160px] max-w-[200px] border-2 border-emerald-100 shadow-[0_5px_0_#a7f3d0] text-center">
              <div className="w-10 h-10 bg-bk-orange text-white font-display text-lg rounded-full flex items-center justify-center mx-auto mb-3 shadow-[0_3px_0_#c2410c]">{s.n}</div>
              <div className="text-3xl mb-2">{s.icon}</div>
              <h3 className="font-black text-sm mb-1">{s.title}</h3>
              <p className="text-xs text-gray-500 leading-relaxed font-semibold">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>
      <ScallopDivider color="#0d9488" bgColor="#fffbf0" direction="up"/>

      {/* CTA */}
      <section className="bg-bk-orange py-12 px-8 text-center">
        <div className="text-3xl mb-4">🌸 🌻 🌈 ☀️ 🌼 🌿 🌷</div>
        <h2 className="font-display text-2xl text-white mb-3">Your neighborhood deserves a little free library.</h2>
        <p className="text-orange-100 font-bold mb-6">Join your neighbors and start sharing books today — free to browse, free to join.</p>
        <Link href="/auth/signup" className="bg-bk-teal text-white px-8 py-3 rounded-full font-extrabold shadow-[0_4px_0_#0f766e] hover:shadow-[0_2px_0_#0f766e] hover:translate-y-0.5 transition-all inline-block">
          Join Your Community →
        </Link>
      </section>
    </>
  )
}
```

- [ ] **Step 2: Start dev server and verify**

```bash
npm run dev
```

Open http://localhost:3000. Expected: homepage renders with hero, kid-drawing background, search bar, empty listings grid, how-it-works, and CTA.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: homepage with hero, search, listings grid, how-it-works"
```

---

### Task 7: Browse Listings Page

**Files:**
- Create: `app/listings/page.tsx`

- [ ] **Step 1: Create `app/listings/page.tsx`**

```tsx
import { createClient } from '@/lib/supabase/server'
import BookCard from '@/components/BookCard'
import Link from 'next/link'
import type { Listing } from '@/lib/types'

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: { city?: string; type?: string; q?: string }
}) {
  const supabase = createClient()
  const city = searchParams.city ?? ''
  const type = searchParams.type ?? 'all'
  const q = searchParams.q ?? ''

  let query = supabase
    .from('listings')
    .select('*, profiles(name, city)')
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  if (city) query = query.ilike('city', `%${city}%`)
  if (type === 'free') query = query.is('price', null)
  if (type === 'sale') query = query.not('price', 'is', null)
  if (q) query = query.or(`title.ilike.%${q}%,author.ilike.%${q}%`)

  const { data: listings } = await query

  return (
    <div className="max-w-6xl mx-auto px-8 py-10">
      <h1 className="font-display text-3xl mb-2">Browse Books 📚</h1>
      <p className="text-gray-400 font-semibold mb-6">{listings?.length ?? 0} books available</p>

      {/* Search + Filters */}
      <form className="flex gap-3 flex-wrap mb-6">
        <input name="city" defaultValue={city} placeholder="City..." className="border-2 border-orange-200 rounded-xl px-4 py-2 font-bold text-sm bg-white focus:outline-none focus:border-bk-orange"/>
        <input name="q" defaultValue={q} placeholder="Search title or author..." className="flex-1 min-w-[200px] border-2 border-orange-200 rounded-xl px-4 py-2 font-bold text-sm bg-white focus:outline-none focus:border-bk-orange"/>
        <select name="type" defaultValue={type} className="border-2 border-orange-200 rounded-xl px-3 py-2 font-bold text-sm bg-white focus:outline-none">
          <option value="all">All</option>
          <option value="sale">For Sale</option>
          <option value="free">Free Only</option>
        </select>
        <button type="submit" className="bg-bk-orange text-white px-6 py-2 rounded-xl font-extrabold text-sm shadow-[0_3px_0_#c2410c]">Search</button>
      </form>

      {listings && listings.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
          {(listings as Listing[]).map(l => <BookCard key={l.id} listing={l}/>)}
        </div>
      ) : (
        <div className="text-center py-24 text-gray-400 font-bold">
          <div className="text-5xl mb-4">📭</div>
          <p className="mb-4">No books found. Try a different city or search term.</p>
          <Link href="/post" className="bg-bk-orange text-white px-6 py-2.5 rounded-full font-extrabold text-sm">Post the first one →</Link>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify in browser**

Open http://localhost:3000/listings. Expected: browse page with search/filter form and empty state.

- [ ] **Step 3: Commit**

```bash
git add app/listings/page.tsx
git commit -m "feat: browse listings page with city/type/keyword search"
```

---

### Task 8: Book Detail Page

**Files:**
- Create: `app/listings/[id]/page.tsx`

- [ ] **Step 1: Create `app/listings/[id]/page.tsx`**

```tsx
import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { formatPrice, formatCondition, getConditionBadgeClass } from '@/lib/utils'

export default async function ListingDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()

  const { data: listing } = await supabase
    .from('listings')
    .select('*, profiles(id, name, city)')
    .eq('id', params.id)
    .single()

  if (!listing) notFound()

  const { data: { user } } = await supabase.auth.getUser()

  async function startConversation() {
    'use server'
    if (!user) redirect(`/auth/signin?redirect=/listings/${params.id}`)

    const supabaseSrv = createClient()
    // Find or create conversation
    const { data: existing } = await supabaseSrv
      .from('conversations')
      .select('id')
      .eq('listing_id', listing.id)
      .eq('buyer_id', user.id)
      .single()

    if (existing) {
      redirect(`/messages/${existing.id}`)
    }

    const { data: convo } = await supabaseSrv
      .from('conversations')
      .insert({ listing_id: listing.id, buyer_id: user.id, seller_id: listing.profiles.id })
      .select('id')
      .single()

    redirect(`/messages/${convo!.id}`)
  }

  const isFree = !listing.price
  const isOwner = user?.id === listing.user_id

  return (
    <div className="max-w-3xl mx-auto px-8 py-12">
      <Link href="/listings" className="text-bk-orange font-bold text-sm mb-6 inline-block hover:underline">← Back to listings</Link>

      <div className="bg-white rounded-3xl overflow-hidden border-2 border-gray-100 shadow-[0_8px_0_#e5e7eb]">
        {/* Cover */}
        <div className="relative h-64 bg-gradient-to-br from-yellow-200 to-orange-200 flex items-center justify-center text-8xl">
          {listing.photo_url ? (
            <Image src={listing.photo_url} alt={listing.title} fill className="object-cover"/>
          ) : (
            <span>📚</span>
          )}
          <span className={`absolute top-4 right-4 px-4 py-1.5 rounded-full text-sm font-black ${isFree ? 'bg-bk-teal text-white' : 'bg-bk-orange text-white'}`}>
            {isFree ? 'FREE' : formatPrice(listing.price)}
          </span>
        </div>

        <div className="p-8">
          <h1 className="font-display text-3xl mb-1">{listing.title}</h1>
          <p className="text-gray-500 font-bold text-lg mb-4">by {listing.author}</p>

          <div className="flex gap-3 mb-6 flex-wrap">
            <span className={`text-sm font-bold px-3 py-1.5 rounded-xl border ${getConditionBadgeClass(listing.condition)}`}>
              {formatCondition(listing.condition)}
            </span>
            <span className="text-sm font-bold px-3 py-1.5 rounded-xl bg-gray-100 text-gray-600">
              📍 {listing.city}
            </span>
          </div>

          {listing.description && (
            <p className="text-gray-600 font-semibold leading-relaxed mb-6">{listing.description}</p>
          )}

          <div className="border-t-2 border-dashed border-gray-100 pt-6 flex items-center justify-between">
            <p className="text-gray-500 font-semibold">Listed by <span className="font-black text-gray-700">{listing.profiles?.name}</span></p>
            {isOwner ? (
              <Link href="/profile" className="bg-gray-100 text-gray-600 px-6 py-2.5 rounded-full font-extrabold text-sm">Manage Listing</Link>
            ) : (
              <form action={startConversation}>
                <button type="submit" className="bg-bk-orange text-white px-8 py-2.5 rounded-full font-extrabold shadow-[0_4px_0_#c2410c] hover:shadow-[0_2px_0_#c2410c] hover:translate-y-0.5 transition-all">
                  💬 Message Seller
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify in browser**

With the dev server running and a listing in the database, open http://localhost:3000/listings/[id]. Expected: full listing detail with photo/cover, price badge, condition, seller name, and message button.

- [ ] **Step 3: Commit**

```bash
git add app/listings/
git commit -m "feat: book detail page with message seller action"
```

---

### Task 9: Auth — Sign Up & Sign In

**Files:**
- Create: `app/auth/signup/page.tsx`, `app/auth/signin/page.tsx`, `app/auth/signout/route.ts`

- [ ] **Step 1: Create `app/auth/signup/page.tsx`**

```tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default function SignUpPage() {
  async function signUp(formData: FormData) {
    'use server'
    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email: formData.get('email') as string,
      password: formData.get('password') as string,
      options: {
        data: {
          name: formData.get('name') as string,
          city: formData.get('city') as string,
        },
      },
    })
    if (error) redirect(`/auth/signup?error=${encodeURIComponent(error.message)}`)
    redirect('/')
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-8">
      <div className="bg-white rounded-3xl p-10 w-full max-w-md border-2 border-gray-100 shadow-[0_8px_0_#e5e7eb]">
        <h1 className="font-display text-3xl text-bk-orange mb-2 text-center">Join the Exchange</h1>
        <p className="text-gray-400 font-semibold text-center mb-8">Free to join. Free to browse.</p>
        <form action={signUp} className="space-y-4">
          <input name="name" placeholder="Your name" required className="w-full border-2 border-orange-200 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-bk-orange"/>
          <input name="city" placeholder="Your city (e.g. Chicago, IL)" required className="w-full border-2 border-orange-200 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-bk-orange"/>
          <input name="email" type="email" placeholder="Email address" required className="w-full border-2 border-orange-200 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-bk-orange"/>
          <input name="password" type="password" placeholder="Password (min 6 chars)" minLength={6} required className="w-full border-2 border-orange-200 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-bk-orange"/>
          <button type="submit" className="w-full bg-bk-orange text-white py-3 rounded-xl font-extrabold shadow-[0_4px_0_#c2410c] hover:shadow-[0_2px_0_#c2410c] hover:translate-y-0.5 transition-all">
            Create My Account →
          </button>
        </form>
        <p className="text-center text-gray-400 font-semibold mt-6 text-sm">
          Already have an account?{' '}
          <Link href="/auth/signin" className="text-bk-orange font-bold hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `app/auth/signin/page.tsx`**

```tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default function SignInPage({ searchParams }: { searchParams: { redirect?: string; error?: string } }) {
  async function signIn(formData: FormData) {
    'use server'
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: formData.get('email') as string,
      password: formData.get('password') as string,
    })
    if (error) redirect(`/auth/signin?error=${encodeURIComponent(error.message)}`)
    redirect(searchParams.redirect ?? '/')
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-8">
      <div className="bg-white rounded-3xl p-10 w-full max-w-md border-2 border-gray-100 shadow-[0_8px_0_#e5e7eb]">
        <h1 className="font-display text-3xl text-bk-orange mb-2 text-center">Welcome Back</h1>
        <p className="text-gray-400 font-semibold text-center mb-8">Sign in to post books and message neighbors.</p>
        {searchParams.error && (
          <div className="bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-red-700 font-bold text-sm mb-4">
            {decodeURIComponent(searchParams.error)}
          </div>
        )}
        <form action={signIn} className="space-y-4">
          <input name="email" type="email" placeholder="Email address" required className="w-full border-2 border-orange-200 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-bk-orange"/>
          <input name="password" type="password" placeholder="Password" required className="w-full border-2 border-orange-200 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-bk-orange"/>
          <button type="submit" className="w-full bg-bk-orange text-white py-3 rounded-xl font-extrabold shadow-[0_4px_0_#c2410c] hover:shadow-[0_2px_0_#c2410c] hover:translate-y-0.5 transition-all">
            Sign In →
          </button>
        </form>
        <p className="text-center text-gray-400 font-semibold mt-6 text-sm">
          No account?{' '}
          <Link href="/auth/signup" className="text-bk-orange font-bold hover:underline">Join free</Link>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `app/auth/signout/route.ts`**

```ts
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST() {
  const supabase = createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/', process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'))
}
```

- [ ] **Step 4: Manual test — sign up**

Open http://localhost:3000/auth/signup. Fill in name, city, email, and password. Submit. Expected: redirect to homepage; Nav shows Messages/Profile/Sign Out.

- [ ] **Step 5: Manual test — sign out and sign in**

Click Sign Out. Expected: redirect to homepage showing Sign In/Join Free. Go to /auth/signin, enter credentials. Expected: redirect to homepage signed in.

- [ ] **Step 6: Commit**

```bash
git add app/auth/
git commit -m "feat: auth — sign up, sign in, sign out with Supabase"
```

---

### Task 10: Post a Listing

**Files:**
- Create: `app/post/page.tsx`

- [ ] **Step 1: Create `app/post/page.tsx`**

```tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function PostPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin?redirect=/post')

  const { data: profile } = await supabase.from('profiles').select('city').eq('id', user.id).single()

  async function createListing(formData: FormData) {
    'use server'
    const supabaseSrv = createClient()
    const { data: { user: u } } = await supabaseSrv.auth.getUser()
    if (!u) redirect('/auth/signin')

    const { data: prof } = await supabaseSrv.from('profiles').select('city').eq('id', u.id).single()

    let photo_url: string | null = null
    const file = formData.get('photo') as File
    if (file && file.size > 0) {
      const ext = file.name.split('.').pop()
      const path = `${u.id}/${Date.now()}.${ext}`
      const { data: upload } = await supabaseSrv.storage.from('book-photos').upload(path, file)
      if (upload) {
        const { data: { publicUrl } } = supabaseSrv.storage.from('book-photos').getPublicUrl(path)
        photo_url = publicUrl
      }
    }

    const priceRaw = formData.get('price') as string
    const price = priceRaw && priceRaw.trim() !== '' ? parseFloat(priceRaw) : null

    const { data: listing, error } = await supabaseSrv.from('listings').insert({
      user_id: u.id,
      title: formData.get('title') as string,
      author: formData.get('author') as string,
      condition: formData.get('condition') as string,
      price,
      description: formData.get('description') as string || null,
      photo_url,
      city: prof?.city ?? '',
    }).select('id').single()

    if (error || !listing) redirect('/post?error=Failed to post listing')
    redirect(`/listings/${listing.id}`)
  }

  return (
    <div className="max-w-xl mx-auto px-8 py-12">
      <h1 className="font-display text-3xl text-bk-orange mb-2">Post a Book</h1>
      <p className="text-gray-400 font-semibold mb-8">Share a book with your neighbors in <strong className="text-gray-600">{profile?.city}</strong>.</p>

      <form action={createListing} className="bg-white rounded-3xl p-8 border-2 border-gray-100 shadow-[0_8px_0_#e5e7eb] space-y-5" encType="multipart/form-data">
        <div>
          <label className="block text-sm font-extrabold text-gray-700 mb-1.5">Book Title *</label>
          <input name="title" required placeholder="e.g. The Great Gatsby" className="w-full border-2 border-orange-200 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-bk-orange"/>
        </div>
        <div>
          <label className="block text-sm font-extrabold text-gray-700 mb-1.5">Author *</label>
          <input name="author" required placeholder="e.g. F. Scott Fitzgerald" className="w-full border-2 border-orange-200 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-bk-orange"/>
        </div>
        <div>
          <label className="block text-sm font-extrabold text-gray-700 mb-1.5">Condition *</label>
          <select name="condition" required className="w-full border-2 border-orange-200 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-bk-orange bg-white">
            <option value="good">Good</option>
            <option value="fair">Fair</option>
            <option value="well-loved">Well-Loved</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-extrabold text-gray-700 mb-1.5">Price (leave blank = Free)</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-gray-400">$</span>
            <input name="price" type="number" min="0" step="0.50" placeholder="0.00" className="w-full border-2 border-orange-200 rounded-xl pl-8 pr-4 py-3 font-bold focus:outline-none focus:border-bk-orange"/>
          </div>
        </div>
        <div>
          <label className="block text-sm font-extrabold text-gray-700 mb-1.5">Description (optional)</label>
          <textarea name="description" rows={3} placeholder="Any notes about the book..." className="w-full border-2 border-orange-200 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-bk-orange resize-none"/>
        </div>
        <div>
          <label className="block text-sm font-extrabold text-gray-700 mb-1.5">Photo (optional)</label>
          <input name="photo" type="file" accept="image/*" className="w-full border-2 border-orange-200 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-bk-orange file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-bk-orange file:text-white file:font-bold file:text-sm"/>
        </div>
        <button type="submit" className="w-full bg-bk-orange text-white py-3.5 rounded-xl font-extrabold shadow-[0_4px_0_#c2410c] hover:shadow-[0_2px_0_#c2410c] hover:translate-y-0.5 transition-all">
          Post My Book →
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Manual test**

Sign in, go to http://localhost:3000/post. Fill in title, author, condition. Submit. Expected: redirect to the new listing's detail page.

- [ ] **Step 3: Verify listing appears on browse page**

Go to http://localhost:3000/listings. Expected: new listing card visible.

- [ ] **Step 4: Commit**

```bash
git add app/post/
git commit -m "feat: post a listing with photo upload to Supabase storage"
```

---

### Task 11: Messages — Inbox

**Files:**
- Create: `app/messages/page.tsx`

- [ ] **Step 1: Create `app/messages/page.tsx`**

```tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { timeAgo } from '@/lib/utils'
import type { Conversation } from '@/lib/types'

export default async function MessagesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin?redirect=/messages')

  const { data: conversations } = await supabase
    .from('conversations')
    .select(`
      *,
      listings(id, title, author, photo_url, price),
      buyer:profiles!conversations_buyer_id_fkey(id, name),
      seller:profiles!conversations_seller_id_fkey(id, name),
      messages(body, created_at, sender_id)
    `)
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
    .order('created_at', { ascending: false })

  return (
    <div className="max-w-2xl mx-auto px-8 py-10">
      <h1 className="font-display text-3xl text-bk-orange mb-6">Messages 💬</h1>

      {conversations && conversations.length > 0 ? (
        <div className="space-y-3">
          {(conversations as Conversation[]).map(convo => {
            const other = convo.buyer_id === user.id ? convo.seller : convo.buyer
            const lastMsg = convo.messages?.sort((a, b) =>
              new Date(b.created_at!).getTime() - new Date(a.created_at!).getTime()
            )[0]
            return (
              <Link
                key={convo.id}
                href={`/messages/${convo.id}`}
                className="block bg-white rounded-2xl p-5 border-2 border-gray-100 shadow-[0_4px_0_#e5e7eb] hover:-translate-y-0.5 transition-transform"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-gray-800 truncate">{convo.listings?.title}</p>
                    <p className="text-xs text-gray-400 font-semibold mb-1">with {(other as any)?.name}</p>
                    {lastMsg && (
                      <p className="text-sm text-gray-500 font-semibold truncate">{lastMsg.body}</p>
                    )}
                  </div>
                  {lastMsg && (
                    <span className="text-xs text-gray-300 font-bold whitespace-nowrap">{timeAgo(lastMsg.created_at)}</span>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      ) : (
        <div className="text-center py-20 text-gray-400 font-bold">
          <div className="text-5xl mb-4">💬</div>
          <p className="mb-4">No messages yet.</p>
          <Link href="/listings" className="text-bk-orange font-extrabold hover:underline">Browse books to get started →</Link>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Manual test**

Sign in as a user who has conversations. Go to http://localhost:3000/messages. Expected: conversation list with listing title, other user's name, and last message preview.

- [ ] **Step 3: Commit**

```bash
git add app/messages/page.tsx
git commit -m "feat: messages inbox listing conversations"
```

---

### Task 12: Messages — Realtime Thread

**Files:**
- Create: `app/messages/[id]/page.tsx`, `components/MessageThread.tsx`

- [ ] **Step 1: Create `components/MessageThread.tsx` (client component for realtime)**

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Message } from '@/lib/types'

type Props = {
  conversationId: string
  initialMessages: Message[]
  currentUserId: string
  otherName: string
}

export default function MessageThread({ conversationId, initialMessages, currentUserId, otherName }: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  useEffect(() => {
    const channel = supabase
      .channel(`conv-${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        payload => {
          setMessages(prev => [...prev, payload.new as Message])
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [conversationId, supabase])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || sending) return
    setSending(true)
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: currentUserId,
      body: body.trim(),
    })
    setBody('')
    setSending(false)
  }

  return (
    <div className="flex flex-col h-[60vh]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 px-2 space-y-3">
        {messages.map(msg => {
          const isMe = msg.sender_id === currentUserId
          return (
            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[70%] px-4 py-2.5 rounded-2xl font-semibold text-sm ${
                isMe ? 'bg-bk-orange text-white rounded-br-sm' : 'bg-gray-100 text-gray-800 rounded-bl-sm'
              }`}>
                {msg.body}
              </div>
            </div>
          )
        })}
        {messages.length === 0 && (
          <p className="text-center text-gray-400 font-semibold text-sm py-8">
            Say hi to {otherName}! 👋
          </p>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} className="flex gap-3 pt-4 border-t-2 border-gray-100">
        <input
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 border-2 border-orange-200 rounded-xl px-4 py-2.5 font-bold text-sm focus:outline-none focus:border-bk-orange"
        />
        <button
          type="submit"
          disabled={sending || !body.trim()}
          className="bg-bk-orange text-white px-6 py-2.5 rounded-xl font-extrabold text-sm shadow-[0_3px_0_#c2410c] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Create `app/messages/[id]/page.tsx`**

```tsx
import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import MessageThread from '@/components/MessageThread'
import { formatPrice } from '@/lib/utils'

export default async function ConversationPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const { data: convo } = await supabase
    .from('conversations')
    .select(`
      *,
      listings(id, title, author, price, photo_url),
      buyer:profiles!conversations_buyer_id_fkey(id, name),
      seller:profiles!conversations_seller_id_fkey(id, name),
      messages(*, profiles(name))
    `)
    .eq('id', params.id)
    .single()

  if (!convo) notFound()

  const isParticipant = convo.buyer_id === user.id || convo.seller_id === user.id
  if (!isParticipant) redirect('/messages')

  const other = convo.buyer_id === user.id ? convo.seller : convo.buyer
  const messages = (convo.messages ?? []).sort(
    (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )

  return (
    <div className="max-w-2xl mx-auto px-8 py-10">
      <Link href="/messages" className="text-bk-orange font-bold text-sm mb-6 inline-block hover:underline">← Back to Messages</Link>

      {/* Listing summary */}
      <div className="bg-white rounded-2xl p-4 border-2 border-gray-100 shadow-[0_4px_0_#e5e7eb] mb-6 flex items-center gap-4">
        <div className="w-12 h-12 bg-gradient-to-br from-yellow-200 to-orange-200 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">📚</div>
        <div className="flex-1 min-w-0">
          <p className="font-black text-sm truncate">{convo.listings?.title}</p>
          <p className="text-xs text-gray-400 font-semibold">{convo.listings?.author}</p>
        </div>
        <span className="font-black text-bk-orange text-sm">{formatPrice(convo.listings?.price)}</span>
        <Link href={`/listings/${convo.listing_id}`} className="text-xs text-gray-400 font-bold hover:text-bk-orange ml-2">View →</Link>
      </div>

      {/* Thread header */}
      <div className="bg-white rounded-3xl p-6 border-2 border-gray-100 shadow-[0_6px_0_#e5e7eb]">
        <p className="font-extrabold text-gray-700 mb-4">Conversation with {(other as any)?.name}</p>
        <MessageThread
          conversationId={convo.id}
          initialMessages={messages}
          currentUserId={user.id}
          otherName={(other as any)?.name ?? 'neighbor'}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Manual test — send messages**

As buyer: open listing → Message Seller. Expected: redirect to conversation thread. Type and send a message. Expected: message appears.

Open a second browser window signed in as the seller. Go to /messages. Expected: conversation visible. Open it. Expected: buyer's message visible. Reply. Expected: both sides update in realtime without page refresh.

- [ ] **Step 4: Commit**

```bash
git add app/messages/ components/MessageThread.tsx
git commit -m "feat: realtime message thread with Supabase subscriptions"
```

---

### Task 13: Profile & My Listings

**Files:**
- Create: `app/profile/page.tsx`

- [ ] **Step 1: Create `app/profile/page.tsx`**

```tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { formatPrice, formatCondition } from '@/lib/utils'

export default async function ProfilePage({ searchParams }: { searchParams: { msg?: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin?redirect=/profile')

  const [{ data: profile }, { data: listings }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('listings').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
  ])

  async function updateProfile(formData: FormData) {
    'use server'
    const supabaseSrv = createClient()
    const { data: { user: u } } = await supabaseSrv.auth.getUser()
    if (!u) redirect('/auth/signin')
    await supabaseSrv.from('profiles').update({
      name: formData.get('name') as string,
      city: formData.get('city') as string,
    }).eq('id', u.id)
    redirect('/profile?msg=Profile+updated')
  }

  async function updateListingStatus(formData: FormData) {
    'use server'
    const supabaseSrv = createClient()
    const { data: { user: u } } = await supabaseSrv.auth.getUser()
    if (!u) redirect('/auth/signin')
    const id = formData.get('id') as string
    const status = formData.get('status') as string
    if (status === 'delete') {
      await supabaseSrv.from('listings').delete().eq('id', id).eq('user_id', u.id)
    } else {
      await supabaseSrv.from('listings').update({ status }).eq('id', id).eq('user_id', u.id)
    }
    redirect('/profile')
  }

  return (
    <div className="max-w-2xl mx-auto px-8 py-10 space-y-10">
      {searchParams.msg && (
        <div className="bg-emerald-50 border-2 border-emerald-200 rounded-xl px-4 py-3 text-emerald-700 font-bold text-sm">
          {decodeURIComponent(searchParams.msg)}
        </div>
      )}

      {/* Profile form */}
      <div className="bg-white rounded-3xl p-8 border-2 border-gray-100 shadow-[0_6px_0_#e5e7eb]">
        <h1 className="font-display text-2xl text-bk-orange mb-6">Your Profile</h1>
        <form action={updateProfile} className="space-y-4">
          <div>
            <label className="block text-sm font-extrabold text-gray-700 mb-1.5">Name</label>
            <input name="name" defaultValue={profile?.name} required className="w-full border-2 border-orange-200 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-bk-orange"/>
          </div>
          <div>
            <label className="block text-sm font-extrabold text-gray-700 mb-1.5">City</label>
            <input name="city" defaultValue={profile?.city} required className="w-full border-2 border-orange-200 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-bk-orange"/>
          </div>
          <button type="submit" className="bg-bk-orange text-white px-6 py-2.5 rounded-xl font-extrabold shadow-[0_3px_0_#c2410c] hover:shadow-[0_1px_0_#c2410c] hover:translate-y-0.5 transition-all">
            Save Changes
          </button>
        </form>
      </div>

      {/* My Listings */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-2xl text-bk-orange">My Listings</h2>
          <Link href="/post" className="bg-bk-teal text-white px-5 py-2 rounded-full font-extrabold text-sm shadow-[0_3px_0_#0f766e]">+ Post a Book</Link>
        </div>

        {listings && listings.length > 0 ? (
          <div className="space-y-3">
            {listings.map(listing => (
              <div key={listing.id} className="bg-white rounded-2xl p-5 border-2 border-gray-100 shadow-[0_4px_0_#e5e7eb] flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <Link href={`/listings/${listing.id}`} className="font-black text-gray-800 hover:text-bk-orange truncate block">{listing.title}</Link>
                  <p className="text-xs text-gray-400 font-semibold">{listing.author} · {formatPrice(listing.price)} · {formatCondition(listing.condition)}</p>
                </div>
                <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                  listing.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                  listing.status === 'sold' ? 'bg-blue-100 text-blue-700' :
                  'bg-purple-100 text-purple-700'
                }`}>
                  {listing.status.charAt(0).toUpperCase() + listing.status.slice(1)}
                </span>
                <form action={updateListingStatus} className="flex gap-2">
                  <input type="hidden" name="id" value={listing.id}/>
                  {listing.status === 'active' && (
                    <>
                      <button name="status" value="sold" className="text-xs font-bold text-blue-500 hover:underline">Mark Sold</button>
                      <button name="status" value="given" className="text-xs font-bold text-purple-500 hover:underline">Mark Given</button>
                    </>
                  )}
                  <button name="status" value="delete" className="text-xs font-bold text-red-400 hover:underline">Delete</button>
                </form>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-400 font-bold bg-white rounded-2xl border-2 border-dashed border-gray-200">
            <div className="text-4xl mb-3">📚</div>
            <p className="mb-4">You haven't listed any books yet.</p>
            <Link href="/post" className="text-bk-orange font-extrabold hover:underline">Post your first book →</Link>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Manual test — update profile**

Sign in → go to /profile. Change city → Save. Expected: success message, city updated. Check a listing detail — city should reflect update for new listings.

- [ ] **Step 3: Manual test — manage listings**

From /profile My Listings, click "Mark Sold" on a listing. Expected: status badge changes to Sold. Click Delete on another listing. Expected: listing removed from the list.

- [ ] **Step 4: Commit**

```bash
git add app/profile/
git commit -m "feat: profile page with edit and listing status management"
```

---

### Task 14: Final Wiring + Deployment

**Files:**
- Update: `next.config.js`, `.env.local`

- [ ] **Step 1: Configure Next.js for Supabase image domain**

Update `next.config.js`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
}
module.exports = nextConfig
```

- [ ] **Step 2: Add site URL env var**

Add to `.env.local`:

```
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

- [ ] **Step 3: Full manual smoke test**

Run through this checklist:

1. Browse listings at `/` — search by city, filter by Free ✓
2. Click a listing — detail page loads ✓
3. Sign up as new user — redirects home ✓
4. Post a book — listing appears on browse page ✓
5. Sign out, sign back in ✓
6. As a different user, click a listing → Message Seller ✓
7. Conversation appears in /messages ✓
8. Open thread — send message — appears instantly (realtime) ✓
9. Open /profile — update city — success message ✓
10. Mark a listing as sold — badge updates ✓

- [ ] **Step 4: Deploy to Vercel**

```bash
npm install -g vercel
vercel
```

Follow prompts. When asked for environment variables, add:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL` (your Vercel URL)

Update signout route — replace `http://localhost:3000` with `process.env.NEXT_PUBLIC_SITE_URL`.

- [ ] **Step 5: Final commit**

```bash
git add next.config.js
git commit -m "feat: configure image domains and prepare for deployment"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Homepage with hero, city search, listings grid, how-it-works, CTA — Task 6
- ✅ Browse listings with filters — Task 7
- ✅ Book detail with Message Seller — Task 8
- ✅ Sign up / sign in / sign out — Task 9
- ✅ Post a listing with photo upload — Task 10
- ✅ Messages inbox — Task 11
- ✅ Realtime message thread — Task 12
- ✅ Profile + my listings management — Task 13
- ✅ Auth redirect middleware — Task 3
- ✅ Database schema + RLS — Task 2
- ✅ Kid-drawing theme, Pacifico font, scallop borders — Tasks 4-6
- ✅ Browse without account, post with account — middleware + pages
- ✅ City scoped to user profile — Post page pulls from profile

**No placeholders found.**

**Type consistency confirmed:** `Listing`, `Conversation`, `Message` types defined in Task 3 and used consistently in all later tasks.
