// app/admin/AdminInboxTab.tsx
'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type InboxMessage = { id: string; body: string; sender_id: string; created_at: string }
type InboxConversation = {
  id: string
  user_id: string
  repliable: boolean
  created_at: string
  userName: string
  messages: InboxMessage[]
}

export default function AdminInboxTab() {
  const [adminId, setAdminId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<InboxConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  async function load() {
    setLoading(true)
    const supabase = createClient()

    const { data: { user } } = await supabase.auth.getUser()
    setAdminId(user?.id ?? null)

    const { data: convos } = await supabase
      .from('conversations').select('id, user_id, repliable, created_at')
      .eq('type', 'admin')
      .order('created_at', { ascending: false })

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

  const selected = conversations.find(c => c.id === selectedId) ?? null

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || !selected || !adminId) return
    setSending(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('messages')
      .insert({ conversation_id: selected.id, sender_id: adminId, body: body.trim(), kind: 'chat' })
      .select()
      .single()
    setSending(false)
    if (!error && data) {
      setBody('')
      setConversations(prev => prev.map(c => c.id === selected.id ? { ...c, messages: [...c.messages, data as InboxMessage] } : c))
    }
  }

  if (loading) return <p className="font-bold text-[13px]" style={{ color: '#aaa' }}>Loading inbox...</p>

  return (
    <div className="flex gap-5" style={{ height: 520 }}>
      <div className="w-[240px] shrink-0 bg-white rounded-2xl border border-[#f1f5f9] overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="p-4 font-bold text-[13px]" style={{ color: '#aaa' }}>No conversations yet.</p>
        ) : (
          conversations.map(c => {
            const last = c.messages[c.messages.length - 1]
            return (
              <button key={c.id} onClick={() => setSelectedId(c.id)}
                className={`w-full text-left px-4 py-3 border-b border-[#f8fafc] ${selectedId === c.id ? 'bg-orange-50' : 'hover:bg-[#f8fafc]'}`}>
                <p className="font-extrabold text-[13px] text-[#1e293b]">{c.userName}</p>
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
  )
}
