// app/admin/AdminInboxTab.tsx
'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { hasUnreadMessage } from '@/lib/adminUnread'

type InboxMessage = { id: string; body: string; sender_id: string; created_at: string }
type InboxConversation = {
  id: string
  user_id: string
  repliable: boolean
  created_at: string
  adminLastReadAt: string | null
  userName: string
  messages: InboxMessage[]
}

export default function AdminInboxTab({ onUnreadCountChange }: { onUnreadCountChange?: (count: number) => void }) {
  const [adminId, setAdminId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<InboxConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAnnouncements, setShowAnnouncements] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    const supabase = createClient()

    const { data: { user } } = await supabase.auth.getUser()
    setAdminId(user?.id ?? null)

    const { data: convos, error: convosError } = await supabase
      .from('conversations').select('id, user_id, repliable, created_at, admin_last_read_at')
      .eq('type', 'admin')
      .order('created_at', { ascending: false })
      .limit(200)

    if (convosError) {
      setError('Failed to load conversations. Please refresh.')
      setLoading(false)
      return
    }

    if (!convos || convos.length === 0) {
      setConversations([])
      setLoading(false)
      return
    }

    const userIds = [...new Set(convos.map(c => c.user_id))]
    const { data: profiles } = await supabase.from('profiles').select('id, username').in('id', userIds)
    const nameMap: Record<string, string> = {}
    for (const p of profiles ?? []) nameMap[p.id] = p.username || 'Unknown'

    const { data: messages } = await supabase
      .from('messages').select('id, conversation_id, body, sender_id, created_at')
      .in('conversation_id', convos.map(c => c.id))
      .order('created_at', { ascending: true })
    const messagesByConvo: Record<string, InboxMessage[]> = {}
    for (const m of messages ?? []) (messagesByConvo[m.conversation_id] ??= []).push(m)

    const withMessages = convos.map(c => ({
      ...c,
      adminLastReadAt: (c as any).admin_last_read_at ?? null,
      userName: nameMap[c.user_id] ?? 'Unknown',
      messages: messagesByConvo[c.id] ?? [],
    }))
    withMessages.sort((a, b) => {
      const aLast = a.messages[a.messages.length - 1]?.created_at ?? a.created_at
      const bLast = b.messages[b.messages.length - 1]?.created_at ?? b.created_at
      return new Date(bLast).getTime() - new Date(aLast).getTime()
    })
    setConversations(withMessages)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Report the unread count upward (badges the sidebar tab + the Inbox pill)
  // whenever the underlying data changes.
  useEffect(() => {
    if (!adminId) return
    const count = conversations.filter(c => hasUnreadMessage(c.messages, adminId, c.adminLastReadAt)).length
    onUnreadCountChange?.(count)
  }, [conversations, adminId, onUnreadCountChange])

  const selected = conversations.find(c => c.id === selectedId) ?? null

  // Per-item read: opening a specific conversation marks only that one read —
  // others stay highlighted/counted until opened individually.
  async function openConversation(c: InboxConversation) {
    setSelectedId(c.id)
    if (!adminId || !hasUnreadMessage(c.messages, adminId, c.adminLastReadAt)) return
    const now = new Date().toISOString()
    setConversations(prev => prev.map(x => x.id === c.id ? { ...x, adminLastReadAt: now } : x))
    const supabase = createClient()
    await supabase.from('conversations').update({ admin_last_read_at: now }).eq('id', c.id)
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || !selected || !adminId) return
    setSending(true)
    const supabase = createClient()
    const { data, error: sendError } = await supabase
      .from('messages')
      .insert({ conversation_id: selected.id, sender_id: adminId, body: body.trim(), kind: 'chat' })
      .select()
      .single()
    setSending(false)
    if (sendError || !data) {
      setError('Failed to send. Please try again.')
      return
    }
    setBody('')
    setConversations(prev => prev.map(c => c.id === selected.id ? { ...c, messages: [...c.messages, data as InboxMessage] } : c))
  }

  if (loading) return <p className="font-bold text-[13px]" style={{ color: '#aaa' }}>Loading inbox...</p>

  const visibleConversations = conversations.filter(c => showAnnouncements || c.repliable)

  return (
    <div>
      {error && (
        <div className="mb-4 bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-red-700 font-bold text-sm">{error}</div>
      )}
      <div className="flex gap-5" style={{ height: 520 }}>
      <div className="w-[240px] shrink-0 bg-white rounded-2xl border border-[#f1f5f9] overflow-y-auto">
        <label className="flex items-center gap-2 px-4 py-2 font-bold text-[12px] text-[#64748b] border-b border-[#f8fafc]">
          <input type="checkbox" checked={showAnnouncements} onChange={e => setShowAnnouncements(e.target.checked)} />
          Show announcements too
        </label>
        {visibleConversations.length === 0 ? (
          <p className="p-4 font-bold text-[13px]" style={{ color: '#aaa' }}>No conversations yet.</p>
        ) : (
          visibleConversations.map(c => {
            const last = c.messages[c.messages.length - 1]
            const unread = !!adminId && hasUnreadMessage(c.messages, adminId, c.adminLastReadAt)
            return (
              <button key={c.id} data-testid={`inbox-convo-${c.id}`} data-unread={unread} onClick={() => openConversation(c)}
                className={`w-full text-left px-4 py-3 border-b border-[#f8fafc] relative ${selectedId === c.id ? 'bg-orange-50' : 'hover:bg-[#f8fafc]'}`}
                style={unread ? { boxShadow: 'inset 3px 0 0 #f97316', background: '#fff7ed' } : undefined}>
                <p className="font-extrabold text-[13px] text-[#1e293b] flex items-center gap-1.5">
                  {unread && <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: '#f97316', display: 'inline-block' }} />}
                  {c.userName}
                </p>
                <p className="text-[11px] font-bold text-[#94a3b8]">{c.repliable ? 'Conversation' : 'Announcement'}</p>
                {last && <p className="text-[12px] font-semibold text-[#94a3b8] truncate mt-0.5">{last.body}</p>}
              </button>
            )
          })
        )}
      </div>

      <div className="flex-1 bg-white rounded-2xl border border-[#f1f5f9] flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center font-bold text-[13px]" style={{ color: '#ccc' }}>
            Select a conversation
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-[#f1f5f9]">
              <p className="font-extrabold text-[14px] text-[#1e293b]">{selected.userName}</p>
              <p className="text-[11px] font-bold text-[#94a3b8]">{selected.repliable ? 'Repliable conversation' : 'One-shot announcement'}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
              {selected.messages.length === 0 && (
                <p className="font-semibold text-[13px]" style={{ color: '#ccc' }}>No messages yet.</p>
              )}
              {selected.messages.map(m => (
                <div key={m.id} className={`max-w-[70%] px-3 py-2 rounded-xl text-[13px] font-semibold ${m.sender_id === adminId ? 'ml-auto bg-bk-orange text-white' : 'bg-[#f1f5f9] text-[#1e293b]'}`}>
                  {m.body}
                </div>
              ))}
            </div>
            <form onSubmit={send} className="px-4 py-3 border-t border-[#f1f5f9] flex gap-2">
              <input value={body} onChange={e => setBody(e.target.value)} placeholder="Reply…"
                className="flex-1 border-2 border-[#e2e8f0] rounded-xl px-3 py-2 font-semibold text-[13px] focus:outline-none focus:border-bk-orange" />
              <button type="submit" disabled={!body.trim() || sending}
                className="bg-bk-orange text-white rounded-xl px-4 py-2 font-extrabold text-[13px] disabled:opacity-50">
                Send
              </button>
            </form>
          </>
        )}
      </div>
      </div>
    </div>
  )
}
