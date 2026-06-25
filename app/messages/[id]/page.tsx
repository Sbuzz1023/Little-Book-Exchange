'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

type Message = {
  id: string
  body: string
  sender_id: string
  created_at: string
}

export default function ThreadPage({ params }: { params: { id: string } }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [body, setBody] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [convo, setConvo] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { window.location.href = '/auth/signin'; return }
      setUserId(user.id)

      const { data: c } = await supabase
        .from('conversations')
        .select('*, listings(id, title, price), buyer:profiles!conversations_buyer_id_fkey(name), seller:profiles!conversations_seller_id_fkey(name)')
        .eq('id', params.id)
        .single()
      setConvo(c)

      const { data: m } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', params.id)
        .order('created_at', { ascending: true })
      setMessages(m ?? [])
      setLoading(false)
    }
    load()

    const channel = supabase
      .channel(`messages:${params.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${params.id}`,
      }, payload => {
        setMessages(prev => [...prev, payload.new as Message])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [params.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || !userId) return
    const text = body.trim()
    setBody('')
    await supabase.from('messages').insert({
      conversation_id: params.id,
      sender_id: userId,
      body: text,
    })
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-8 py-10 text-center text-gray-400 font-bold">
        <div className="text-3xl mb-2">⏳</div>
        Loading...
      </div>
    )
  }

  const other = convo?.buyer_id === userId ? convo?.seller : convo?.buyer

  return (
    <div className="max-w-2xl mx-auto px-8 py-8 flex flex-col h-[calc(100vh-130px)]">
      <div className="flex items-center gap-4 mb-4">
        <Link href="/messages" className="text-bk-orange font-bold text-sm hover:underline">← Inbox</Link>
        <div>
          <p className="font-black text-gray-800">{convo?.listings?.title}</p>
          <p className="text-xs text-gray-400 font-semibold">with {other?.name}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 mb-4 bg-white rounded-2xl border-2 border-gray-100 p-5 shadow-[0_4px_0_#e5e7eb]">
        {messages.length === 0 && (
          <p className="text-center text-gray-300 font-bold text-sm py-8">No messages yet. Say hi!</p>
        )}
        {messages.map(m => {
          const isMine = m.sender_id === userId
          return (
            <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-sm font-semibold ${
                isMine
                  ? 'bg-bk-orange text-white rounded-br-sm shadow-[0_3px_0_#c2410c]'
                  : 'bg-gray-100 text-gray-700 rounded-bl-sm'
              }`}>
                {m.body}
              </div>
            </div>
          )
        })}
        <div ref={bottomRef}/>
      </div>

      <form onSubmit={send} className="flex gap-3">
        <input
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 border-2 border-orange-200 rounded-xl px-4 py-3 font-bold text-sm focus:outline-none focus:border-bk-orange"
        />
        <button
          type="submit"
          disabled={!body.trim()}
          className="bg-bk-orange text-white px-6 py-3 rounded-xl font-extrabold text-sm shadow-[0_3px_0_#c2410c] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </form>
    </div>
  )
}
