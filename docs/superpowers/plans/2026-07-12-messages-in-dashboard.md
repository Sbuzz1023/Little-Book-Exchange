# Messages in Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Messaging moves from the standalone `/messages` + `/messages/[id]` routes into a 7th "Messages" tab on the Dashboard (`/profile`), selected the same client-side way as the other six tabs — no navigation. The nav bar's "Messages" link and the old routes are removed.

**Architecture:** `app/profile/page.tsx` already fetches every conversation the user is party to (as `exchanges`, avoiding joins for RLS safety). It gains a messages fetch attached per-conversation, plus `tab`/`conversation` search-param handling for deep links. A new `app/profile/MessagesTab.tsx` client component (ported from the old `ConversationSidebar`/`[id]/page.tsx`/`page.tsx`) renders a fixed-height two-pane (conversation list + thread) panel, driven by state lifted into `DashboardClient.tsx` instead of by the URL. The listing page's "Message Seller" action, which used to `redirect()` to `/messages/[id]`, now redirects to `/profile?tab=messages&conversation=[id]`.

**Tech Stack:** Next.js 14 App Router, React 18, Supabase (`@supabase/ssr`, realtime `postgres_changes`), Vitest + `@testing-library/react` + jsdom for component tests.

## Global Constraints

- Demo-mode detection stays exactly as-is: `!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http') || !!cookies().get('lbe_demo_user')`. It's already computed once in `app/profile/page.tsx` (as `demo`) — pass it down as the new `isDemo` prop rather than recomputing it.
- No unread-message badges/counts on the Messages tab icon — out of scope per spec.
- No change to the realtime subscription mechanism (`postgres_changes` on `messages`, scoped by `conversation_id`) — ported as-is from the deleted `[id]/page.tsx`.
- Reuse the existing `?redirect=` query-param convention already used by `/auth/signin`; introduce `?tab=` and `?conversation=` the same way.
- Follow existing test conventions: colocated `*.test.tsx`, `describe`/`it`/`expect`/`vi` from `vitest`, `render`/`fireEvent`/`waitFor` from `@testing-library/react`, module mocking via `vi.mock` (see `components/HeartButton.test.tsx`).
- `Element.prototype.scrollIntoView` is not implemented in jsdom — guard the call with `?.()` so tests don't crash (the old `[id]/page.tsx` didn't need this because it was never unit tested).

---

## File Structure

- Create `app/profile/MessagesTab.tsx` — two-pane (conversation list + thread) messages UI, self-contained, driven entirely by props.
- Create `app/profile/MessagesTab.test.tsx` — unit tests for list rendering, selection, empty state, and demo-mode send.
- Modify `app/profile/DashboardClient.tsx` — add the `'messages'` tab (type, `TABS` entry, 4/7-col grid), lift `selectedConversationId` state, change the Exchanges tab's Message button to switch tabs instead of navigating, render `MessagesTab`.
- Modify `app/profile/page.tsx` — fetch + attach `messages` per conversation onto `exchanges`; read `tab`/`conversation` search params; pass `isDemo` and `initialConversationId` to `DashboardClient`.
- Modify `app/listings/[id]/page.tsx` — `startConversation`'s 4 redirect targets point to `/profile?tab=messages&conversation=...` instead of `/messages/...`.
- Modify `components/Nav.tsx` — remove desktop + mobile "Messages" links.
- Modify `middleware.ts` — remove `/messages` from `protectedPaths`.
- Delete `app/messages/` entirely: `page.tsx`, `layout.tsx`, `MessagesShell.tsx`, `ConversationSidebar.tsx`, `LockScroll.tsx`, `[id]/page.tsx`.

---

### Task 1: Build `MessagesTab` component

**Files:**
- Create: `app/profile/MessagesTab.tsx`
- Test: `app/profile/MessagesTab.test.tsx`

**Interfaces:**
- Consumes: nothing from other tasks (self-contained).
- Produces:
  ```ts
  export type MessageRow = { id: string; body: string; sender_id: string; created_at: string }
  export type MessagesTabExchange = {
    id: string
    listing_id: string
    buyer_id: string
    seller_id: string
    listings: { title: string; author: string; photo_url?: string | null }
    buyer: { username?: string | null; name?: string | null }
    seller: { username?: string | null; name?: string | null }
    messages: MessageRow[]
  }
  export default function MessagesTab(props: {
    exchanges: MessagesTabExchange[]
    userId: string
    isDemo: boolean
    selectedId: string | null
    onSelectId: (id: string | null) => void
  }): JSX.Element
  ```
  Task 2 imports `MessagesTab` and passes `exchanges` (a superset shape with extra fields — TypeScript structural typing allows this), `userId`, `isDemo`, `selectedId`, `onSelectId`.

- [ ] **Step 1: Write the failing tests**

Create `app/profile/MessagesTab.test.tsx`:

```tsx
import { render, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import MessagesTab, { type MessagesTabExchange } from './MessagesTab'
import { createClient } from '@/lib/supabase/client'

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}))

const exchanges: MessagesTabExchange[] = [
  {
    id: 'convo-1', listing_id: 'listing-1', buyer_id: 'them-1', seller_id: 'me',
    listings: { title: 'The Hobbit', author: 'J.R.R. Tolkien' },
    buyer: { name: 'Neighbor A' }, seller: { name: 'Me' },
    messages: [
      { id: 'm1', body: 'Is this still available?', sender_id: 'them-1', created_at: '2026-07-01T10:00:00.000Z' },
      { id: 'm2', body: 'Yes!', sender_id: 'me', created_at: '2026-07-01T10:05:00.000Z' },
    ],
  },
  {
    id: 'convo-2', listing_id: 'listing-2', buyer_id: 'me', seller_id: 'them-2',
    listings: { title: 'Sapiens', author: 'Yuval Noah Harari' },
    buyer: { name: 'Me' }, seller: { name: 'Neighbor B' },
    messages: [],
  },
]

function findButtonWithText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes(text))
}

describe('MessagesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the empty-thread placeholder when no conversation is selected', () => {
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={true} selectedId={null} onSelectId={vi.fn()} />
    )
    expect(container.textContent).toContain('Select a conversation to start chatting')
  })

  it('lists every conversation with the other party\'s name and listing title', () => {
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={true} selectedId={null} onSelectId={vi.fn()} />
    )
    expect(container.textContent).toContain('Neighbor A')
    expect(container.textContent).toContain('The Hobbit')
    expect(container.textContent).toContain('Neighbor B')
    expect(container.textContent).toContain('Sapiens')
  })

  it('shows the selected conversation\'s messages in the thread', () => {
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={true} selectedId="convo-1" onSelectId={vi.fn()} />
    )
    expect(container.textContent).toContain('Is this still available?')
    expect(container.textContent).toContain('Yes!')
  })

  it('calls onSelectId with the conversation id when a list row is clicked', () => {
    const onSelectId = vi.fn()
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={true} selectedId={null} onSelectId={onSelectId} />
    )
    fireEvent.click(findButtonWithText(container, 'Neighbor A')!)
    expect(onSelectId).toHaveBeenCalledWith('convo-1')
  })

  it('calls onSelectId(null) when the mobile back button is clicked', () => {
    const onSelectId = vi.fn()
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={true} selectedId="convo-1" onSelectId={onSelectId} />
    )
    const backButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === '‹')
    fireEvent.click(backButton!)
    expect(onSelectId).toHaveBeenCalledWith(null)
  })

  it('demo mode: sending a message appends it locally without calling Supabase', async () => {
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={true} selectedId="convo-1" onSelectId={vi.fn()} />
    )
    const input = container.querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'See you Saturday!' } })
    fireEvent.click(container.querySelector('button[type="submit"]')!)
    await waitFor(() => expect(container.textContent).toContain('See you Saturday!'))
    expect(createClient).not.toHaveBeenCalled()
  })

  it('non-demo mode: sending a message inserts a row via Supabase', async () => {
    const insert = vi.fn(() => Promise.resolve({ error: null }))
    vi.mocked(createClient).mockReturnValue({
      from: vi.fn(() => ({ insert })),
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
      removeChannel: vi.fn(),
    } as any)

    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={false} selectedId="convo-1" onSelectId={vi.fn()} />
    )
    const input = container.querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'See you Saturday!' } })
    fireEvent.click(container.querySelector('button[type="submit"]')!)
    await waitFor(() => expect(insert).toHaveBeenCalledWith({
      conversation_id: 'convo-1', sender_id: 'me', body: 'See you Saturday!',
    }))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- app/profile/MessagesTab.test.tsx`
Expected: FAIL — `./MessagesTab` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `app/profile/MessagesTab.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

export type MessageRow = { id: string; body: string; sender_id: string; created_at: string }

export type MessagesTabExchange = {
  id: string
  listing_id: string
  buyer_id: string
  seller_id: string
  listings: { title: string; author: string; photo_url?: string | null }
  buyer: { username?: string | null; name?: string | null }
  seller: { username?: string | null; name?: string | null }
  messages: MessageRow[]
}

const AVATAR_COLORS = ['#f97316', '#0d9488', '#8b5cf6', '#ec4899', '#3b82f6', '#10b981']

function avatarColor(str: string) {
  const sum = str.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return AVATAR_COLORS[sum % AVATAR_COLORS.length]
}

function initial(name: string) {
  return (name ?? '?')[0].toUpperCase()
}

function otherNameFor(convo: MessagesTabExchange, userId: string) {
  const other = convo.buyer_id === userId ? convo.seller : convo.buyer
  return other?.name || other?.username || 'Neighbor'
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(diff / 86400000)
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function formatTime(iso: string) {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diff < 172800000) return `Yesterday ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function MessagesTab({
  exchanges, userId, isDemo, selectedId, onSelectId,
}: {
  exchanges: MessagesTabExchange[]
  userId: string
  isDemo: boolean
  selectedId: string | null
  onSelectId: (id: string | null) => void
}) {
  const [localMessages, setLocalMessages] = useState<Record<string, MessageRow[]>>({})
  const [body, setBody] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const convo = exchanges.find(e => e.id === selectedId) ?? null
  const messages = convo ? (localMessages[convo.id] ?? convo.messages) : []

  useEffect(() => {
    if (!convo) return
    setLocalMessages(prev => (prev[convo.id] ? prev : { ...prev, [convo.id]: convo.messages }))

    if (isDemo) return
    let cleanup: (() => void) | undefined
    ;(async () => {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const channel = supabase
        .channel(`messages:${convo.id}`)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'messages',
          filter: `conversation_id=eq.${convo.id}`,
        }, (payload: any) => {
          setLocalMessages(prev => ({
            ...prev,
            [convo.id]: [...(prev[convo.id] ?? convo.messages), payload.new as MessageRow],
          }))
        })
        .subscribe()
      cleanup = () => supabase.removeChannel(channel)
    })()
    return () => cleanup?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convo?.id, isDemo])

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' })
  }, [messages.length])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || !convo) return
    const text = body.trim()
    setBody('')
    inputRef.current?.focus()

    if (isDemo) {
      setLocalMessages(prev => ({
        ...prev,
        [convo.id]: [...(prev[convo.id] ?? convo.messages), {
          id: `demo-${Date.now()}`, body: text, sender_id: userId, created_at: new Date().toISOString(),
        }],
      }))
      return
    }

    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      await supabase.from('messages').insert({ conversation_id: convo.id, sender_id: userId, body: text })
    } catch {}
  }

  const inThread = !!convo

  return (
    <div
      className="rounded-[20px] border-2 border-[#f3f4f6]"
      style={{ height: 560, display: 'flex', overflow: 'hidden', boxShadow: '0 6px 0 #e5e7eb' }}
    >
      {/* Conversation list */}
      <div
        className={`${inThread ? 'hidden md:flex' : 'flex'} md:w-[260px] md:shrink-0 w-full flex-col`}
        style={{ borderRight: '2px solid #f3f4f6', overflowY: 'auto', background: '#fff' }}
      >
        {exchanges.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-center px-6 py-10 font-bold" style={{ color: '#ccc' }}>
            <div>
              <div className="text-4xl mb-3">💬</div>
              <p className="text-[13px]">No conversations yet</p>
            </div>
          </div>
        ) : (
          exchanges.map(ex => {
            const otherName = otherNameFor(ex, userId)
            const msgs = localMessages[ex.id] ?? ex.messages
            const lastMsg = msgs[msgs.length - 1]
            const isActive = selectedId === ex.id
            const color = avatarColor(otherName)
            return (
              <button
                key={ex.id}
                type="button"
                onClick={() => onSelectId(ex.id)}
                className="flex items-center gap-3 text-left"
                style={{
                  padding: '14px 16px', border: 'none', width: '100%', fontFamily: 'inherit', cursor: 'pointer',
                  background: isActive ? '#fff7ed' : 'transparent',
                  borderLeft: isActive ? '3px solid #f97316' : '3px solid transparent',
                  borderBottom: '1px solid #f3f4f6',
                }}
              >
                <div style={{
                  width: 44, height: 44, borderRadius: '50%', background: color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  color: '#fff', fontWeight: 900, fontSize: 17,
                }}>
                  {initial(otherName)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, marginBottom: 2 }}>
                    <p style={{ fontSize: 14, fontWeight: 800, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {otherName}
                    </p>
                    {lastMsg && <span style={{ fontSize: 11, fontWeight: 700, color: '#bbb', flexShrink: 0 }}>{timeAgo(lastMsg.created_at)}</span>}
                  </div>
                  <p style={{ fontSize: 12, fontWeight: 700, color: isActive ? '#f97316' : '#aaa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 2 }}>
                    📚 {ex.listings?.title}
                  </p>
                  {lastMsg && (
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#bbb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {lastMsg.body}
                    </p>
                  )}
                </div>
              </button>
            )
          })
        )}
      </div>

      {/* Thread */}
      <div className={`${inThread ? 'flex' : 'hidden md:flex'} flex-1 flex-col`} style={{ background: '#fffbf0', overflow: 'hidden' }}>
        {!convo ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4" style={{ color: '#ccc' }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>💬</div>
            <p className="font-black text-[18px] mb-2" style={{ color: '#bbb' }}>Your messages</p>
            <p className="font-bold text-[14px]">Select a conversation to start chatting</p>
          </div>
        ) : (
          <>
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', background: '#fff', borderBottom: '2px solid #e5e7eb' }}>
              <button
                type="button"
                onClick={() => onSelectId(null)}
                className="md:hidden font-extrabold text-bk-orange text-[20px] leading-none shrink-0"
                style={{ background: 'none', border: 'none', cursor: 'pointer', marginRight: 4, padding: 0, fontFamily: 'inherit' }}
              >
                ‹
              </button>
              <div>
                <p style={{ fontWeight: 900, fontSize: 16, color: '#1a1a1a', lineHeight: 1.2 }}>{otherNameFor(convo, userId)}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#aaa' }}>📚 {convo.listings?.title}</span>
                  <Link href={`/listings/${convo.listing_id}`} style={{ fontSize: 11, fontWeight: 700, color: '#f97316', textDecoration: 'none' }}>
                    View →
                  </Link>
                </div>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {messages.length === 0 && (
                <div style={{ textAlign: 'center', paddingTop: 60, color: '#ccc', fontWeight: 700 }}>
                  <div style={{ fontSize: 36, marginBottom: 10 }}>👋</div>
                  <p>No messages yet. Say hello!</p>
                </div>
              )}
              {messages.map((m, idx) => {
                const isMine = m.sender_id === userId
                const prev = messages[idx - 1]
                const next = messages[idx + 1]
                const sameSenderAbove = prev?.sender_id === m.sender_id
                const sameSenderBelow = next?.sender_id === m.sender_id
                const showTime = !next || (new Date(next.created_at).getTime() - new Date(m.created_at).getTime() > 300000)
                const br = isMine
                  ? `18px 18px ${sameSenderBelow ? '4px' : '18px'} 18px`
                  : `18px 18px 18px ${sameSenderBelow ? '4px' : '18px'}`
                return (
                  <div key={m.id}>
                    {!sameSenderAbove && !isMine && (
                      <p style={{ fontSize: 11, fontWeight: 700, color: '#bbb', marginLeft: 4, marginBottom: 3, marginTop: idx === 0 ? 0 : 10 }}>
                        {otherNameFor(convo, userId)}
                      </p>
                    )}
                    {!sameSenderAbove && isMine && idx > 0 && <div style={{ marginTop: 10 }} />}
                    <div style={{ display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start', marginBottom: sameSenderBelow ? 2 : 0 }}>
                      <div style={{
                        maxWidth: '68%', padding: '10px 14px', borderRadius: br,
                        fontSize: 14, fontWeight: 600, lineHeight: 1.45, wordBreak: 'break-word',
                        ...(isMine ? { background: '#f97316', color: '#fff' } : { background: '#fff', color: '#1a1a1a', border: '1.5px solid #e5e7eb' }),
                      }}>
                        {m.body}
                      </div>
                    </div>
                    {showTime && (
                      <p style={{ fontSize: 11, fontWeight: 700, color: '#ccc', textAlign: isMine ? 'right' : 'left', marginTop: 4, marginBottom: 6 }}>
                        {formatTime(m.created_at)}
                      </p>
                    )}
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>

            <form onSubmit={send} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#fff', borderTop: '2px solid #e5e7eb' }}>
              <input
                ref={inputRef}
                value={body}
                onChange={e => setBody(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e as any) } }}
                placeholder="iMessage"
                style={{
                  flex: 1, background: '#f3f4f6', border: '1.5px solid #e5e7eb', borderRadius: 22,
                  padding: '10px 16px', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', outline: 'none', color: '#1a1a1a',
                }}
              />
              <button
                type="submit"
                disabled={!body.trim()}
                style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: body.trim() ? '#f97316' : '#e5e7eb', border: 'none',
                  cursor: body.trim() ? 'pointer' : 'default',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M14 8L2 2l3 6-3 6 12-6z" fill={body.trim() ? '#fff' : '#aaa'} />
                </svg>
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- app/profile/MessagesTab.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add app/profile/MessagesTab.tsx app/profile/MessagesTab.test.tsx
git commit -m "feat: add MessagesTab component"
```

---

### Task 2: Wire `MessagesTab` into `DashboardClient.tsx`

**Files:**
- Modify: `app/profile/DashboardClient.tsx`

**Interfaces:**
- Consumes: `MessagesTab` and `MessagesTabExchange` from Task 1.
- Produces: `DashboardClient` gains required props `isDemo: boolean` and optional `initialConversationId?: string | null`, consumed by Task 3 (`app/profile/page.tsx`).

- [ ] **Step 1: Add the import**

At the top of `app/profile/DashboardClient.tsx`, after `import ProfileCard from './ProfileCard'`, add:

```tsx
import MessagesTab from './MessagesTab'
```

- [ ] **Step 2: Add `'messages'` to the `Tab` type**

Find:

```tsx
type Tab = 'listings' | 'exchanges' | 'tbr' | 'saved' | 'wallet' | 'account'
```

Replace with:

```tsx
type Tab = 'listings' | 'exchanges' | 'tbr' | 'saved' | 'wallet' | 'account' | 'messages'
```

- [ ] **Step 3: Add `messages` to the `Exchange` type**

Find the end of the `Exchange` type (the `seller: { ... }` block closes right before `}`):

```tsx
  seller: {
    username?: string | null
    name?: string | null
    city?: string | null
    state?: string | null
    phone?: string | null
    address?: string | null
    address_unit?: string | null
    share_address?: boolean | null
    pickup_description?: string | null
    share_pickup?: boolean | null
  }
}
```

Replace with:

```tsx
  seller: {
    username?: string | null
    name?: string | null
    city?: string | null
    state?: string | null
    phone?: string | null
    address?: string | null
    address_unit?: string | null
    share_address?: boolean | null
    pickup_description?: string | null
    share_pickup?: boolean | null
  }
  messages: { id: string; body: string; sender_id: string; created_at: string }[]
}
```

- [ ] **Step 4: Add `isDemo` and `initialConversationId` to the `Props` type**

Find:

```tsx
  success?: boolean
  defaultTab?: Tab
  queryError?: string | null
  tbrError?: string | null
}
```

Replace with:

```tsx
  success?: boolean
  defaultTab?: Tab
  queryError?: string | null
  tbrError?: string | null
  isDemo: boolean
  initialConversationId?: string | null
}
```

- [ ] **Step 5: Add the 7th tab to `TABS`**

Find:

```tsx
  { id: 'account' as Tab,    icon: '👤', label: 'Profile',      desc: 'Your profile',       color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', shadow: '#93c5fd' },
]
```

Replace with:

```tsx
  { id: 'account' as Tab,    icon: '👤', label: 'Profile',      desc: 'Your profile',       color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', shadow: '#93c5fd' },
  { id: 'messages' as Tab,   icon: '💬', label: 'Messages',     desc: 'Chat with neighbors', color: '#0ea5e9', bg: '#f0f9ff', border: '#bae6fd', shadow: '#7dd3fc' },
]
```

- [ ] **Step 6: Destructure the new props and add lifted state**

Find:

```tsx
export default function DashboardClient({ profile, listings, exchanges, savedListings, tbrEntries, updateAction, updateListingStatus, notifyPickedUp, confirmExchange, cancelPurchase, removeSavedListing, addTbrEntry, removeTbrEntry, success, defaultTab, queryError, tbrError }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab ?? 'listings')
```

Replace with:

```tsx
export default function DashboardClient({ profile, listings, exchanges, savedListings, tbrEntries, updateAction, updateListingStatus, notifyPickedUp, confirmExchange, cancelPurchase, removeSavedListing, addTbrEntry, removeTbrEntry, success, defaultTab, queryError, tbrError, isDemo, initialConversationId }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab ?? 'listings')
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(initialConversationId ?? null)
```

- [ ] **Step 7: Update the tab grid columns**

Find:

```tsx
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
```

Replace with:

```tsx
      <div className="grid grid-cols-4 md:grid-cols-7 gap-3">
```

- [ ] **Step 8: Make the Exchanges tab's Message button switch tabs instead of navigating**

Find:

```tsx
                {/* Message button always visible */}
                <Link href={`/messages/${ex.id}`}
                  className="font-extrabold text-[11px] text-white whitespace-nowrap shrink-0"
                  style={{ background: '#0d9488', padding: '6px 12px', borderRadius: 999, boxShadow: '0 2px 0 #0f766e' }}>
                  💬 Message
                </Link>
```

Replace with:

```tsx
                {/* Message button always visible */}
                <button
                  type="button"
                  onClick={() => { setActiveTab('messages'); setSelectedConversationId(ex.id) }}
                  className="font-extrabold text-[11px] text-white whitespace-nowrap shrink-0"
                  style={{ background: '#0d9488', padding: '6px 12px', borderRadius: 999, boxShadow: '0 2px 0 #0f766e', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  💬 Message
                </button>
```

- [ ] **Step 9: Render `MessagesTab`**

Find the closing of the Account section:

```tsx
      {/* ── ACCOUNT ── */}
      {activeTab === 'account' && (
        <div className="flex flex-col" style={{ gap: 16 }}>
          <ProfileCard profile={profile} updateAction={updateAction} success={success} />
          <div style={{ borderTop: '2px dashed #e5e7eb', paddingTop: 16 }}>
            <form action="/auth/signout" method="post">
              <button className="font-bold text-sm hover:text-red-400 transition-colors"
                style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer' }}>
                Sign Out
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}
```

Replace with:

```tsx
      {/* ── ACCOUNT ── */}
      {activeTab === 'account' && (
        <div className="flex flex-col" style={{ gap: 16 }}>
          <ProfileCard profile={profile} updateAction={updateAction} success={success} />
          <div style={{ borderTop: '2px dashed #e5e7eb', paddingTop: 16 }}>
            <form action="/auth/signout" method="post">
              <button className="font-bold text-sm hover:text-red-400 transition-colors"
                style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer' }}>
                Sign Out
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── MESSAGES ── */}
      {activeTab === 'messages' && (
        <MessagesTab
          exchanges={exchanges}
          userId={profile?.id ?? ''}
          isDemo={isDemo}
          selectedId={selectedConversationId}
          onSelectId={setSelectedConversationId}
        />
      )}

    </div>
  )
}
```

- [ ] **Step 10: Commit**

Note: `npm run build` will fail at this point because `app/profile/page.tsx` doesn't pass the new required `isDemo` prop yet — that's expected and fixed in Task 3, so there's no build-verification step here.

```bash
git add app/profile/DashboardClient.tsx
git commit -m "feat: add Messages tab to DashboardClient"
```

---

### Task 3: Wire real data into `app/profile/page.tsx`

**Files:**
- Modify: `app/profile/page.tsx`

**Interfaces:**
- Consumes: `DashboardClient({ isDemo: boolean, initialConversationId?: string | null, ... })` from Task 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Accept the new search params**

Find:

```tsx
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: { success?: string; error?: string; demo_pending?: string; tbr_error?: string }
}) {
```

Replace with:

```tsx
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: { success?: string; error?: string; demo_pending?: string; tbr_error?: string; tab?: string; conversation?: string }
}) {
```

- [ ] **Step 2: Fetch and attach messages in the real-Supabase branch**

Find:

```tsx
      if (merged.length > 0) {
        // Fetch listings separately
        const listingIds = [...new Set(merged.map((r: any) => r.listing_id).filter(Boolean))]
        const { data: listingRows } = await supabase
          .from('listings').select('id, title, author, photo_url, city, state, pickup_description').in('id', listingIds)
        const lm: Record<string, any> = {}
        for (const l of listingRows ?? []) lm[l.id] = l

        // Fetch profiles separately
        const profileIds = [...new Set(merged.flatMap((r: any) => [r.buyer_id, r.seller_id]).filter(Boolean))]
        const { data: profileRows } = await supabase
          .from('profiles').select('id, username, city, state, phone, address, address_unit, share_address, pickup_description, share_pickup').in('id', profileIds)
        const pm: Record<string, any> = {}
        for (const p of profileRows ?? []) pm[p.id] = p

        exchanges = merged.map((row: any) => {
          const sellerData = pm[row.seller_id] ?? { username: null, city: null, state: null, phone: null }
          const isConfirmed = (row.exchange_status ?? 'none') === 'confirmed'
          return {
            ...row,
            exchange_status: row.exchange_status ?? 'none',
            listings: lm[row.listing_id] ?? { title: 'Unknown', author: '', photo_url: null, city: null, state: null },
            buyer:    pm[row.buyer_id]   ?? { username: null, city: null, state: null, phone: null },
            seller: {
              ...sellerData,
              address:            isConfirmed ? sellerData.address            : null,
              address_unit:       isConfirmed ? sellerData.address_unit       : null,
              pickup_description: isConfirmed ? sellerData.pickup_description : null,
            },
          }
        })
      } else {
```

Replace with:

```tsx
      if (merged.length > 0) {
        // Fetch listings separately
        const listingIds = [...new Set(merged.map((r: any) => r.listing_id).filter(Boolean))]
        const { data: listingRows } = await supabase
          .from('listings').select('id, title, author, photo_url, city, state, pickup_description').in('id', listingIds)
        const lm: Record<string, any> = {}
        for (const l of listingRows ?? []) lm[l.id] = l

        // Fetch profiles separately
        const profileIds = [...new Set(merged.flatMap((r: any) => [r.buyer_id, r.seller_id]).filter(Boolean))]
        const { data: profileRows } = await supabase
          .from('profiles').select('id, username, city, state, phone, address, address_unit, share_address, pickup_description, share_pickup').in('id', profileIds)
        const pm: Record<string, any> = {}
        for (const p of profileRows ?? []) pm[p.id] = p

        // Fetch messages separately (used by the Messages tab)
        const { data: messageRows } = await supabase
          .from('messages').select('id, conversation_id, body, sender_id, created_at')
          .in('conversation_id', merged.map((r: any) => r.id))
          .order('created_at', { ascending: true })
        const mm: Record<string, any[]> = {}
        for (const m of messageRows ?? []) (mm[m.conversation_id] ??= []).push(m)

        exchanges = merged.map((row: any) => {
          const sellerData = pm[row.seller_id] ?? { username: null, city: null, state: null, phone: null }
          const isConfirmed = (row.exchange_status ?? 'none') === 'confirmed'
          return {
            ...row,
            exchange_status: row.exchange_status ?? 'none',
            listings: lm[row.listing_id] ?? { title: 'Unknown', author: '', photo_url: null, city: null, state: null },
            buyer:    pm[row.buyer_id]   ?? { username: null, city: null, state: null, phone: null },
            seller: {
              ...sellerData,
              address:            isConfirmed ? sellerData.address            : null,
              address_unit:       isConfirmed ? sellerData.address_unit       : null,
              pickup_description: isConfirmed ? sellerData.pickup_description : null,
            },
            messages: mm[row.id] ?? [],
          }
        })
      } else {
```

- [ ] **Step 3: Pass the new props to `DashboardClient`**

Find:

```tsx
  return (
    <DashboardClient
      profile={profile}
      listings={listings}
      exchanges={exchanges}
      savedListings={savedListings}
      tbrEntries={tbrEntries}
      updateAction={updateProfile}
      updateListingStatus={updateListingStatus}
      notifyPickedUp={notifyPickedUp}
      confirmExchange={confirmExchange}
      cancelPurchase={cancelPurchase}
      removeSavedListing={removeSavedListing}
      addTbrEntry={addTbrEntry}
      removeTbrEntry={removeTbrEntry}
      success={!!searchParams.success}
      defaultTab={searchParams.demo_pending ? 'exchanges' : 'listings'}
      queryError={queryError}
      tbrError={searchParams.tbr_error ?? null}
    />
  )
}
```

Replace with:

```tsx
  return (
    <DashboardClient
      profile={profile}
      listings={listings}
      exchanges={exchanges}
      savedListings={savedListings}
      tbrEntries={tbrEntries}
      updateAction={updateProfile}
      updateListingStatus={updateListingStatus}
      notifyPickedUp={notifyPickedUp}
      confirmExchange={confirmExchange}
      cancelPurchase={cancelPurchase}
      removeSavedListing={removeSavedListing}
      addTbrEntry={addTbrEntry}
      removeTbrEntry={removeTbrEntry}
      success={!!searchParams.success}
      defaultTab={searchParams.tab === 'messages' ? 'messages' : (searchParams.demo_pending ? 'exchanges' : 'listings')}
      queryError={queryError}
      tbrError={searchParams.tbr_error ?? null}
      isDemo={demo}
      initialConversationId={searchParams.conversation ?? null}
    />
  )
}
```

- [ ] **Step 4: Verify the app builds**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Manually verify in the browser**

Run: `npm run dev`, then in a browser:
1. Sign in (demo mode: any username/password works — see `docs/superpowers/plans/2026-07-11-admin-panel-access-control.md` conventions, or just submit the sign-in form).
2. Visit `/profile`, click the 💬 Messages tab. Expected: a two-pane panel — conversation list on the left, "Select a conversation to start chatting" on the right.
3. Click a conversation in the list. Expected: the thread pane shows its messages; on a narrow window (<768px) the list disappears and a "‹" back button appears in the thread header.
4. Type a message and send it. Expected: it appears immediately in the thread (demo mode appends locally).
5. Go to the Exchanges tab, click "💬 Message" on any row. Expected: jumps to the Messages tab with that conversation already selected — no page navigation (URL stays `/profile`).

Note: the real-Supabase branch of the `messages` fetch added in Step 2 mirrors the exact join-avoidance pattern already proven elsewhere in this file (separate `.in()` queries, not joins) and cannot be exercised without a live, seeded Supabase project — it is code-reviewed for correctness rather than manually tested here.

- [ ] **Step 6: Commit**

```bash
git add app/profile/page.tsx
git commit -m "feat: fetch conversation messages and wire tab/conversation deep links into the dashboard"
```

---

### Task 4: Reroute the "Message Seller" flow

**Files:**
- Modify: `app/listings/[id]/page.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks (the redirect target is just a URL string).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update the 4 redirect targets in `startConversation`**

Find:

```tsx
  async function startConversation(formData: FormData) {
    'use server'
    const { redirect } = await import('next/navigation')
    const { cookies } = await import('next/headers')

    const isDemo = !process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http') ||
      !!cookies().get('lbe_demo_user')

    if (isDemo) {
      const { MOCK_CONVERSATIONS: convos } = await import('@/lib/mock-data')
      const mock = convos.find(c => c.listing_id === params.id)
      redirect(`/messages/${mock?.id ?? 'mock-convo-1'}`)
    }

    try {
      const { createClient: createSrv } = await import('@/lib/supabase/server')
      const supabase = createSrv()
      const { data: { user: u } } = await supabase.auth.getUser()
      if (!u) redirect(`/auth/signin?redirect=/listings/${params.id}`)

      const { data: existing } = await supabase
        .from('conversations').select('id').eq('listing_id', listing.id).eq('buyer_id', u!.id).maybeSingle()
      if (existing) redirect(`/messages/${existing.id}`)

      const sellerId = (listing.profiles as any)?.id ?? listing.user_id
      const { data: convo } = await supabase
        .from('conversations')
        .insert({ listing_id: listing.id, buyer_id: u!.id, seller_id: sellerId })
        .select('id').single()

      redirect(`/messages/${convo!.id}`)
    } catch (err: any) {
      if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
      const { MOCK_CONVERSATIONS: convos } = await import('@/lib/mock-data')
      const mock = convos.find(c => c.listing_id === params.id)
      redirect(`/messages/${mock?.id ?? 'mock-convo-1'}`)
    }
  }
```

Replace with:

```tsx
  async function startConversation(formData: FormData) {
    'use server'
    const { redirect } = await import('next/navigation')
    const { cookies } = await import('next/headers')

    const isDemo = !process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http') ||
      !!cookies().get('lbe_demo_user')

    if (isDemo) {
      const { MOCK_CONVERSATIONS: convos } = await import('@/lib/mock-data')
      const mock = convos.find(c => c.listing_id === params.id)
      redirect(`/profile?tab=messages&conversation=${mock?.id ?? 'mock-convo-1'}`)
    }

    try {
      const { createClient: createSrv } = await import('@/lib/supabase/server')
      const supabase = createSrv()
      const { data: { user: u } } = await supabase.auth.getUser()
      if (!u) redirect(`/auth/signin?redirect=/listings/${params.id}`)

      const { data: existing } = await supabase
        .from('conversations').select('id').eq('listing_id', listing.id).eq('buyer_id', u!.id).maybeSingle()
      if (existing) redirect(`/profile?tab=messages&conversation=${existing.id}`)

      const sellerId = (listing.profiles as any)?.id ?? listing.user_id
      const { data: convo } = await supabase
        .from('conversations')
        .insert({ listing_id: listing.id, buyer_id: u!.id, seller_id: sellerId })
        .select('id').single()

      redirect(`/profile?tab=messages&conversation=${convo!.id}`)
    } catch (err: any) {
      if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
      const { MOCK_CONVERSATIONS: convos } = await import('@/lib/mock-data')
      const mock = convos.find(c => c.listing_id === params.id)
      redirect(`/profile?tab=messages&conversation=${mock?.id ?? 'mock-convo-1'}`)
    }
  }
```

- [ ] **Step 2: Verify the app builds**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 3: Manually verify in the browser**

Run: `npm run dev`, then in a browser (signed in via demo mode):
1. Visit any listing detail page you don't own and click "Message Seller" (or the equivalent contact action).
2. Expected: you land on `/profile?tab=messages&conversation=<id>`, the Dashboard opens with the Messages tab active, and that conversation's thread is already showing.

- [ ] **Step 4: Commit**

```bash
git add "app/listings/[id]/page.tsx"
git commit -m "feat: route Message Seller into the dashboard's Messages tab"
```

---

### Task 5: Remove the standalone Messages route and nav link

**Files:**
- Modify: `components/Nav.tsx`
- Modify: `middleware.ts`
- Delete: `app/messages/page.tsx`, `app/messages/layout.tsx`, `app/messages/MessagesShell.tsx`, `app/messages/ConversationSidebar.tsx`, `app/messages/LockScroll.tsx`, `app/messages/[id]/page.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing consumed by later tasks. This is the final task.

- [ ] **Step 1: Remove the desktop nav link**

In `components/Nav.tsx`, find:

```tsx
              <span className="w-px h-5 bg-gray-200" />
              <Link href="/locations" className="font-bold text-[15px] text-[#2d2d2d] hover:text-bk-orange transition-colors">Libraries</Link>
              <span className="w-px h-5 bg-gray-200" />
              <Link href="/profile" className="font-bold text-[15px] text-[#2d2d2d] hover:text-bk-orange transition-colors">Dashboard</Link>
              <span className="w-px h-5 bg-gray-200" />
              <Link href="/messages" className="font-bold text-[15px] text-[#2d2d2d] hover:text-bk-orange transition-colors">Messages</Link>
              <span className="w-px h-5 bg-gray-200" />

              {/* Avatar dropdown — uses native <details> toggle, no JS state needed */}
```

Replace with:

```tsx
              <span className="w-px h-5 bg-gray-200" />
              <Link href="/locations" className="font-bold text-[15px] text-[#2d2d2d] hover:text-bk-orange transition-colors">Libraries</Link>
              <span className="w-px h-5 bg-gray-200" />
              <Link href="/profile" className="font-bold text-[15px] text-[#2d2d2d] hover:text-bk-orange transition-colors">Dashboard</Link>
              <span className="w-px h-5 bg-gray-200" />

              {/* Avatar dropdown — uses native <details> toggle, no JS state needed */}
```

- [ ] **Step 2: Remove the mobile menu link**

In the same file, find:

```tsx
              <Link href="/profile" className="flex items-center gap-3 px-5 py-4 font-bold text-[15px] text-[#2d2d2d] border-b border-gray-100 hover:bg-[#fff7ed] hover:text-bk-orange transition-colors md:hidden">
                📊 Dashboard
              </Link>
              <Link href="/messages" className="flex items-center gap-3 px-5 py-4 font-bold text-[15px] text-[#2d2d2d] border-b border-gray-100 hover:bg-[#fff7ed] hover:text-bk-orange transition-colors md:hidden">
                💬 Messages
              </Link>
              <a href="/auth/signout" onClick={clearDemoUser} className="flex items-center gap-3 px-5 py-4 font-bold text-[15px] text-red-400 hover:bg-red-50 transition-colors">
                🚪 Sign Out
              </a>
```

Replace with:

```tsx
              <Link href="/profile" className="flex items-center gap-3 px-5 py-4 font-bold text-[15px] text-[#2d2d2d] border-b border-gray-100 hover:bg-[#fff7ed] hover:text-bk-orange transition-colors md:hidden">
                📊 Dashboard
              </Link>
              <a href="/auth/signout" onClick={clearDemoUser} className="flex items-center gap-3 px-5 py-4 font-bold text-[15px] text-red-400 hover:bg-red-50 transition-colors">
                🚪 Sign Out
              </a>
```

- [ ] **Step 3: Remove `/messages` from the protected paths**

In `middleware.ts`, find:

```ts
  const protectedPaths = ['/post', '/messages', '/profile']
```

Replace with:

```ts
  const protectedPaths = ['/post', '/profile']
```

- [ ] **Step 4: Delete the standalone messages route**

```bash
git rm -r app/messages
```

- [ ] **Step 5: Verify the app builds**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors and no reference to the deleted `app/messages/*` files anywhere.

- [ ] **Step 6: Run the full test suite**

Run: `npm run test:run`
Expected: all tests pass, including `app/profile/MessagesTab.test.tsx` from Task 1 alongside the existing suite.

- [ ] **Step 7: Manually verify in the browser**

Run: `npm run dev`, then in a browser:
1. Sign in, look at the nav bar (desktop and — via a narrow window or dev tools device toolbar — mobile). Expected: no "Messages" link in either.
2. Navigate directly to `http://localhost:3000/messages`. Expected: Next.js 404 page (route no longer exists).
3. Re-run the full flow from Task 3, Step 5 and Task 4, Step 3 once more end-to-end to confirm nothing broke.

- [ ] **Step 8: Commit**

```bash
git add components/Nav.tsx middleware.ts
git commit -m "feat: remove standalone Messages route and nav link"
```

---

## Full Test Suite Check

- [ ] Run: `npm run test:run`
- [ ] Expected: all tests pass — `app/profile/MessagesTab.test.tsx` (new) alongside `components/HeartButton.test.tsx`, `components/ShareToggle.test.tsx`, `lib/actions/validateLocationInput.test.ts`, `lib/buildConfirmationMessage.test.ts`.
- [ ] Run: `npm run build`
- [ ] Expected: production build succeeds with no TypeScript errors.
