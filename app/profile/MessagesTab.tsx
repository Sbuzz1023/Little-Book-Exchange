'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { StarRatingBadge } from '@/components/StarRating'
import { thumbnailUrl } from '@/lib/listingPhotos'
import { avatarInitials } from '@/lib/avatarInitials'

export type MessageRow = { id: string; body: string; sender_id: string; created_at: string }

export type MessagesTabExchange = {
  id: string
  type?: 'exchange' | 'admin'
  listing_id?: string | null
  buyer_id?: string | null
  seller_id?: string | null
  user_id?: string | null
  repliable?: boolean
  created_at: string
  listings?: { title: string; author: string; photo_url?: string | null; cover_url?: string | null } | null
  buyer?: { username?: string | null; name?: string | null; city?: string | null; state?: string | null }
  seller?: { username?: string | null; name?: string | null; city?: string | null; state?: string | null }
  sellerRating?: { average: number; count: number } | null
  messages: MessageRow[]
}

// Folk palette (app/home.css .home-v2 tokens) for the other person's avatar —
// picked deterministically from their name so it stays stable.
const AVATAR_PALETTE = [
  { bg: '#234A40', fg: '#fff' },    // pine
  { bg: '#E4B04A', fg: '#2B2622' }, // mustard
  { bg: '#B5462F', fg: '#fff' },    // rust (brick)
  { bg: '#6E7B3E', fg: '#fff' },    // sage (moss)
  { bg: '#E07A5F', fg: '#fff' },    // coral
  { bg: '#5F574D', fg: '#fff' },    // ink-soft
]

function avatarPalette(name: string) {
  const sum = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return AVATAR_PALETTE[sum % AVATAR_PALETTE.length]
}

// Circle avatar matching the nav's .hnav-avatar: initials from the nav rule,
// or the sprout logo for the Little Book Exchange Team (support threads).
function MessageAvatar({ name, support = false, size }: { name: string; support?: boolean; size: number }) {
  if (support) {
    return (
      <span className="dash-msg-avatar is-support" style={{ width: size, height: size }} data-testid="message-avatar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/home/sprout-mark.svg" alt="Little Book Exchange" />
      </span>
    )
  }
  const { bg, fg } = avatarPalette(name)
  return (
    <span
      className="dash-msg-avatar"
      style={{ width: size, height: size, background: bg, color: fg, fontSize: Math.round(size / 3) }}
      data-testid="message-avatar"
      aria-hidden="true"
    >
      {avatarInitials(name)}
    </span>
  )
}

function lastActivity(convo: MessagesTabExchange, localMessages: Record<string, MessageRow[]>) {
  const msgs = localMessages[convo.id] ?? convo.messages
  return msgs.length > 0 ? msgs[msgs.length - 1].created_at : convo.created_at
}

function otherNameFor(convo: MessagesTabExchange, userId: string) {
  if (convo.type === 'admin') return 'Little Book Exchange Team'
  const other = convo.buyer_id === userId ? convo.seller : convo.buyer
  return other?.name || other?.username || 'Neighbor'
}

// "Seller" / "Buyer" is the other person's role relative to me; "Support"
// for a Little Book Exchange Team thread. Adds " · City, ST" when known.
function otherRoleLine(convo: MessagesTabExchange, userId: string) {
  if (convo.type === 'admin') return 'Support'
  const iAmBuyer = convo.buyer_id === userId
  const other = iAmBuyer ? convo.seller : convo.buyer
  const place = [other?.city, other?.state].filter(Boolean).join(', ')
  return `${iAmBuyer ? 'Seller' : 'Buyer'}${place ? ` · ${place}` : ''}`
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
  exchanges, userId, isDemo, selectedId, onSelectId, unreadConversationIds = [],
}: {
  exchanges: MessagesTabExchange[]
  userId: string
  isDemo: boolean
  selectedId: string | null
  onSelectId: (id: string | null) => void
  unreadConversationIds?: string[]
}) {
  const router = useRouter()
  const [localMessages, setLocalMessages] = useState<Record<string, MessageRow[]>>({})
  const [body, setBody] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const convo = exchanges.find(e => e.id === selectedId) ?? null
  const messages = convo ? (localMessages[convo.id] ?? convo.messages) : []

  const sortedExchanges = [...exchanges].sort(
    (a, b) => new Date(lastActivity(b, localMessages)).getTime() - new Date(lastActivity(a, localMessages)).getTime()
  )

  async function selectConversation(id: string) {
    onSelectId(id)
    if (!isDemo && unreadConversationIds.includes(id)) {
      const supabase = createClient()
      await supabase.from('notifications').update({ read: true })
        .eq('user_id', userId).eq('type', 'message').eq('entity_id', id)
      // The Messages tab badge and this row's own highlight both come from
      // server-rendered props computed at the last page load — marking the
      // notification read in the database alone doesn't update them.
      // Without this, they stay stuck showing unread until some unrelated
      // navigation happens to reload the page.
      router.refresh()
    }
  }

  useEffect(() => {
    if (!convo) return
    setLocalMessages(prev => (prev[convo.id] ? prev : { ...prev, [convo.id]: convo.messages }))

    if (isDemo) return
    const supabase = createClient()
    const channel = supabase
      .channel(`messages:${convo.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${convo.id}`,
      }, (payload: any) => {
        setLocalMessages(prev => {
          const existing = prev[convo.id] ?? convo.messages
          const incoming = payload.new as MessageRow
          if (existing.some(m => m.id === incoming.id)) return prev
          return { ...prev, [convo.id]: [...existing, incoming] }
        })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
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
      const supabase = createClient()
      const { data, error } = await supabase
        .from('messages')
        .insert({ conversation_id: convo.id, sender_id: userId, body: text })
        .select()
        .single()
      if (error) throw error
      setLocalMessages(prev => {
        const existing = prev[convo.id] ?? convo.messages
        if (existing.some(m => m.id === data.id)) return prev
        return { ...prev, [convo.id]: [...existing, data as MessageRow] }
      })
    } catch {}
  }

  const inThread = !!convo

  return (
    <div className="dash-msg">
      {/* Conversation list */}
      <div className={`${inThread ? 'hidden md:flex' : 'flex'} dash-msg-list md:w-[260px] md:shrink-0 w-full flex-col`}>
        {sortedExchanges.length === 0 ? (
          <div className="dash-msg-list-empty">
            <div>
              <div className="text-4xl mb-3">💬</div>
              <p>No conversations yet</p>
            </div>
          </div>
        ) : (
          sortedExchanges.map(ex => {
            const otherName = otherNameFor(ex, userId)
            const msgs = localMessages[ex.id] ?? ex.messages
            const lastMsg = msgs[msgs.length - 1]
            const isActive = selectedId === ex.id
            const isUnread = unreadConversationIds.includes(ex.id)
            return (
              <button
                key={ex.id}
                type="button"
                onClick={() => selectConversation(ex.id)}
                data-testid={isUnread ? 'conversation-row-unread' : undefined}
                className={`dash-msg-row${isActive ? ' is-active' : isUnread ? ' is-unread' : ''}`}
              >
                <MessageAvatar name={otherName} support={ex.type === 'admin'} size={40} />
                <div className="dash-msg-row-body">
                  <div className="dash-msg-row-top">
                    <p className="dash-msg-row-name">{otherName}</p>
                    {lastMsg && <span className="dash-msg-row-time">{timeAgo(lastMsg.created_at)}</span>}
                  </div>
                  {ex.type !== 'admin' && (
                    <p className="dash-msg-row-book">📚 {ex.listings?.title}</p>
                  )}
                  {lastMsg && <p className="dash-msg-row-last">{lastMsg.body}</p>}
                </div>
              </button>
            )
          })
        )}
      </div>

      {/* Thread */}
      <div className={`${inThread ? 'flex' : 'hidden md:flex'} dash-msg-thread flex-1 flex-col`}>
        {!convo ? (
          <div className="dash-msg-placeholder">
            <div style={{ fontSize: 56, marginBottom: 16 }}>💬</div>
            <p className="dash-msg-placeholder-title">Your messages</p>
            <p>Select a conversation to start chatting</p>
          </div>
        ) : (
          <>
            <div className="dash-msg-head" data-testid="thread-header">
              <button
                type="button"
                onClick={() => onSelectId(null)}
                className="md:hidden dash-msg-back"
              >
                ‹
              </button>
              <MessageAvatar name={otherNameFor(convo, userId)} support={convo.type === 'admin'} size={44} />
              <div className="dash-msg-head-info">
                <div className="dash-msg-head-name-row">
                  <button
                    type="button"
                    data-testid="thread-title-back"
                    onClick={() => onSelectId(null)}
                    className="md:hidden dash-msg-head-title-btn"
                  >
                    <p className="dash-msg-head-name">{otherNameFor(convo, userId)}</p>
                  </button>
                  <p className="hidden md:block dash-msg-head-name">{otherNameFor(convo, userId)}</p>
                  {convo.type !== 'admin' && convo.seller_id !== userId && <StarRatingBadge rating={convo.sellerRating ?? null} sellerId={convo.seller_id!} />}
                </div>
                <p className="dash-msg-head-role" data-testid="thread-header-role">{otherRoleLine(convo, userId)}</p>
              </div>
            </div>

            {convo.type !== 'admin' && (
              <div className="home-v2 dash-msg-book" data-testid="thread-book-card">
                <div className="dash-msg-book-cover">
                  {thumbnailUrl(convo.listings) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbnailUrl(convo.listings)!} alt={convo.listings?.title ?? ''} />
                  ) : (
                    <span>📚</span>
                  )}
                </div>
                <div className="dash-msg-book-info">
                  <p className="dash-msg-book-title">{convo.listings?.title ?? 'Unknown'}</p>
                  {convo.listings?.author && <p className="dash-msg-book-author">{convo.listings.author}</p>}
                </div>
                {convo.listing_id && (
                  <Link href={`/listings/${convo.listing_id}`} className="btn btn-primary dash-msg-book-btn">
                    ← Back to book
                  </Link>
                )}
              </div>
            )}

            <div className="dash-msg-scroll" data-testid="thread-messages">
              {messages.length === 0 && (
                <div className="dash-msg-empty">
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
                  <div key={m.id} style={{ marginTop: !sameSenderAbove && idx > 0 ? 10 : 0 }}>
                    <div className={`dash-msg-line${isMine ? ' is-mine' : ''}`} style={{ marginBottom: sameSenderBelow ? 2 : 0 }}>
                      {/* Their avatar sits beside the first bubble of each group;
                          later bubbles keep an empty slot so they stay aligned. */}
                      {!isMine && (
                        <span className="dash-msg-line-avatar">
                          {!sameSenderAbove && <MessageAvatar name={otherNameFor(convo, userId)} support={convo.type === 'admin'} size={28} />}
                        </span>
                      )}
                      <div className={`dash-msg-bubble${isMine ? ' is-mine' : ''}`} style={{ borderRadius: br }}>
                        {m.body}
                      </div>
                    </div>
                    {showTime && (
                      <p className={`dash-msg-time${isMine ? ' is-mine' : ''}`}>{formatTime(m.created_at)}</p>
                    )}
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>

            {convo.type === 'admin' && convo.repliable === false ? (
              <div className="dash-msg-readonly">
                🔒 Announcement — replies aren't enabled
              </div>
            ) : (
              <form onSubmit={send} className="dash-msg-composer">
                <input
                  ref={inputRef}
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e as any) } }}
                  placeholder="Write a message…"
                  className="dash-msg-input"
                />
                <button
                  type="submit"
                  disabled={!body.trim()}
                  aria-label="Send"
                  className={`dash-msg-send${body.trim() ? ' is-ready' : ''}`}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M14 8L2 2l3 6-3 6 12-6z" fill="currentColor" />
                  </svg>
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  )
}
