'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { MOCK_CONVERSATIONS, MOCK_MESSAGES_BY_CONVO, MOCK_USER_ID } from '@/lib/mock-data'

type Message = {
  id: string
  body: string
  sender_id: string
  created_at: string
}

const IS_DEMO = !process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http')

function formatTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diff < 172800000) return `Yesterday ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function ThreadPage({ params }: { params: { id: string } }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [body, setBody] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [convo, setConvo] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const isMock = IS_DEMO || params.id.startsWith('mock-')

  useEffect(() => {
    if (isMock) {
      const mockConvo = MOCK_CONVERSATIONS.find(c => c.id === params.id) ?? MOCK_CONVERSATIONS[0]
      const mockMsgs = (MOCK_MESSAGES_BY_CONVO[params.id] ?? MOCK_MESSAGES_BY_CONVO[mockConvo.id] ?? []) as Message[]
      setUserId(MOCK_USER_ID)
      setConvo(mockConvo)
      setMessages(mockMsgs)
      setLoading(false)
      return
    }

    // Real Supabase path — only reached when URL is properly configured
    let cleanup: (() => void) | undefined

    async function load() {
      try {
        const { createClient } = await import('@/lib/supabase/client')
        const supabase = createClient()

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { window.location.href = '/auth/signin'; return }
        setUserId(user.id)

        const { data: c } = await supabase
          .from('conversations')
          .select('*, listings(id, title, author, price), buyer:profiles!conversations_buyer_id_fkey(id, username), seller:profiles!conversations_seller_id_fkey(id, username)')
          .eq('id', params.id)
          .single()
        setConvo(c)

        const { data: m } = await supabase
          .from('messages').select('*')
          .eq('conversation_id', params.id)
          .order('created_at', { ascending: true })
        setMessages(m ?? [])
        setLoading(false)

        const channel = supabase
          .channel(`messages:${params.id}`)
          .on('postgres_changes', {
            event: 'INSERT', schema: 'public', table: 'messages',
            filter: `conversation_id=eq.${params.id}`,
          }, payload => {
            setMessages(prev => [...prev, payload.new as Message])
          })
          .subscribe()

        cleanup = () => supabase.removeChannel(channel)
      } catch {
        // Fall back to mock if real Supabase fails
        const mockConvo = MOCK_CONVERSATIONS[0]
        setUserId(MOCK_USER_ID)
        setConvo(mockConvo)
        setMessages(MOCK_MESSAGES_BY_CONVO[mockConvo.id] as Message[])
        setLoading(false)
      }
    }

    load()
    return () => cleanup?.()
  }, [params.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || !userId) return
    const text = body.trim()
    setBody('')
    inputRef.current?.focus()

    if (isMock) {
      setMessages(prev => [...prev, {
        id: `demo-${Date.now()}`,
        body: text,
        sender_id: userId,
        created_at: new Date().toISOString(),
      }])
      return
    }

    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      await supabase.from('messages').insert({ conversation_id: params.id, sender_id: userId, body: text })
    } catch {}
  }

  const other = convo?.buyer_id === userId ? convo?.seller : convo?.buyer
  const otherName = other?.name || other?.username || 'Neighbor'
  const listing = convo?.listings

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fffbf0' }}>

      {/* Header */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14,
        padding: '14px 20px', background: '#fff', borderBottom: '2px solid #e5e7eb',
      }}>
        <a
          href="/messages"
          className="md:hidden font-extrabold text-bk-orange text-[20px] leading-none shrink-0"
          style={{ textDecoration: 'none', marginRight: 4 }}
        >
          ‹
        </a>
        {loading ? (
          <div style={{ height: 24, width: 200, background: '#f3f4f6', borderRadius: 8 }} />
        ) : (
          <>
            <div>
              <p style={{ fontWeight: 900, fontSize: 16, color: '#1a1a1a', lineHeight: 1.2 }}>
                {otherName}
              </p>
              {listing && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#aaa' }}>📚 {listing.title}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 800, color: '#fff',
                    background: '#f97316',
                    padding: '1px 8px', borderRadius: 999,
                  }}>
                    1 credit
                  </span>
                  {listing.id && (
                    <Link href={`/listings/${listing.id}`}
                      style={{ fontSize: 11, fontWeight: 700, color: '#f97316', textDecoration: 'none' }}>
                      View →
                    </Link>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '20px 20px 8px',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        {loading && (
          <div style={{ textAlign: 'center', paddingTop: 40, color: '#ccc', fontWeight: 700 }}>Loading...</div>
        )}
        {!loading && messages.length === 0 && (
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
                  {otherName}
                </p>
              )}
              {!sameSenderAbove && isMine && idx > 0 && <div style={{ marginTop: 10 }} />}
              <div style={{ display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start', marginBottom: sameSenderBelow ? 2 : 0 }}>
                <div style={{
                  maxWidth: '68%', padding: '10px 14px', borderRadius: br,
                  fontSize: 14, fontWeight: 600, lineHeight: 1.45, wordBreak: 'break-word',
                  ...(isMine
                    ? { background: '#f97316', color: '#fff' }
                    : { background: '#fff', color: '#1a1a1a', border: '1.5px solid #e5e7eb' }),
                }}>
                  {m.body}
                </div>
              </div>
              {showTime && (
                <p style={{
                  fontSize: 11, fontWeight: 700, color: '#ccc',
                  textAlign: isMine ? 'right' : 'left', marginTop: 4, marginBottom: 6,
                }}>
                  {formatTime(m.created_at)}
                </p>
              )}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <form onSubmit={send} style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px', background: '#fff', borderTop: '2px solid #e5e7eb',
      }}>
        <input
          ref={inputRef}
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e as any) } }}
          placeholder="iMessage"
          style={{
            flex: 1, background: '#f3f4f6', border: '1.5px solid #e5e7eb', borderRadius: 22,
            padding: '10px 16px', fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
            outline: 'none', color: '#1a1a1a',
          }}
        />
        <button
          type="submit"
          disabled={!body.trim()}
          style={{
            width: 36, height: 36, borderRadius: '50%',
            background: body.trim() ? '#f97316' : '#e5e7eb',
            border: 'none', cursor: body.trim() ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, transition: 'background 0.15s',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M14 8L2 2l3 6-3 6 12-6z" fill={body.trim() ? '#fff' : '#aaa'} />
          </svg>
        </button>
      </form>
    </div>
  )
}
