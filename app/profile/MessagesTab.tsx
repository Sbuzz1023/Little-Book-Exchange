'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { StarRatingBadge } from '@/components/StarRating'

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
  listings?: { title: string; author: string; photo_url?: string | null } | null
  buyer?: { username?: string | null; name?: string | null }
  seller?: { username?: string | null; name?: string | null }
  sellerRating?: { average: number; count: number } | null
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

function lastActivity(convo: MessagesTabExchange, localMessages: Record<string, MessageRow[]>) {
  const msgs = localMessages[convo.id] ?? convo.messages
  return msgs.length > 0 ? msgs[msgs.length - 1].created_at : convo.created_at
}

function otherNameFor(convo: MessagesTabExchange, userId: string) {
  if (convo.type === 'admin') return 'Little Book Exchange Team'
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
  exchanges, userId, isDemo, selectedId, onSelectId, unreadConversationIds = [],
}: {
  exchanges: MessagesTabExchange[]
  userId: string
  isDemo: boolean
  selectedId: string | null
  onSelectId: (id: string | null) => void
  unreadConversationIds?: string[]
}) {
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
    <div
      className="rounded-[20px] border-2 border-[#f3f4f6]"
      style={{ height: 560, display: 'flex', overflow: 'hidden', boxShadow: '0 6px 0 #e5e7eb' }}
    >
      {/* Conversation list */}
      <div
        className={`${inThread ? 'hidden md:flex' : 'flex'} md:w-[260px] md:shrink-0 w-full flex-col`}
        style={{ borderRight: '2px solid #f3f4f6', overflowY: 'auto', background: '#fff' }}
      >
        {sortedExchanges.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-center px-6 py-10 font-bold" style={{ color: '#ccc' }}>
            <div>
              <div className="text-4xl mb-3">💬</div>
              <p className="text-[13px]">No conversations yet</p>
            </div>
          </div>
        ) : (
          sortedExchanges.map(ex => {
            const otherName = otherNameFor(ex, userId)
            const msgs = localMessages[ex.id] ?? ex.messages
            const lastMsg = msgs[msgs.length - 1]
            const isActive = selectedId === ex.id
            const isUnread = unreadConversationIds.includes(ex.id)
            const color = avatarColor(otherName)
            return (
              <button
                key={ex.id}
                type="button"
                onClick={() => selectConversation(ex.id)}
                data-testid={isUnread ? 'conversation-row-unread' : undefined}
                className="flex items-center gap-3 text-left"
                style={{
                  padding: '14px 16px', border: 'none', width: '100%', fontFamily: 'inherit', cursor: 'pointer',
                  background: isActive ? '#fff7ed' : isUnread ? '#fef9f0' : 'transparent',
                  borderLeft: isActive ? '3px solid #f97316' : isUnread ? '3px solid #fdba74' : '3px solid transparent',
                  borderBottom: '1px solid #f3f4f6',
                }}
              >
                <div style={{
                  width: 44, height: 44, borderRadius: '50%', background: ex.type === 'admin' ? '#f97316' : color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  color: '#fff', fontWeight: 900, fontSize: ex.type === 'admin' ? 20 : 17,
                }}>
                  {ex.type === 'admin' ? '📣' : initial(otherName)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, marginBottom: 2 }}>
                    <p style={{ fontSize: 14, fontWeight: 800, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {otherName}
                    </p>
                    {lastMsg && <span style={{ fontSize: 11, fontWeight: 700, color: '#bbb', flexShrink: 0 }}>{timeAgo(lastMsg.created_at)}</span>}
                  </div>
                  {ex.type !== 'admin' && (
                    <p style={{ fontSize: 12, fontWeight: 700, color: isActive ? '#f97316' : '#aaa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 2 }}>
                      📚 {ex.listings?.title}
                    </p>
                  )}
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
                style={{ background: 'none', border: 'none', cursor: 'pointer', margin: '-8px 0 -8px -4px', padding: 8, fontFamily: 'inherit' }}
              >
                ‹
              </button>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    data-testid="thread-title-back"
                    onClick={() => onSelectId(null)}
                    className="md:hidden"
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                  >
                    <p style={{ fontWeight: 900, fontSize: 16, color: '#1a1a1a', lineHeight: 1.2 }}>{otherNameFor(convo, userId)}</p>
                  </button>
                  <p className="hidden md:block" style={{ fontWeight: 900, fontSize: 16, color: '#1a1a1a', lineHeight: 1.2 }}>{otherNameFor(convo, userId)}</p>
                  {convo.type !== 'admin' && convo.seller_id !== userId && <StarRatingBadge rating={convo.sellerRating ?? null} sellerId={convo.seller_id!} />}
                </div>
                {convo.type !== 'admin' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#aaa' }}>📚 {convo.listings?.title}</span>
                    <Link href={`/listings/${convo.listing_id}`} style={{ fontSize: 11, fontWeight: 700, color: '#f97316', textDecoration: 'none' }}>
                      View →
                    </Link>
                  </div>
                )}
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

            {convo.type === 'admin' && convo.repliable === false ? (
              <div style={{ flexShrink: 0, padding: '14px 16px', background: '#fff', borderTop: '2px solid #e5e7eb', textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#bbb' }}>
                🔒 Announcement — replies aren't enabled
              </div>
            ) : (
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
            )}
          </>
        )}
      </div>
    </div>
  )
}
