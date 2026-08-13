// app/admin/EmailComposeTab.tsx
'use client'
import { useState, useEffect, useMemo } from 'react'
import { resolveBroadcastRecipients, sendBroadcastEmail, type BroadcastTarget } from '@/lib/actions/emailAdmin'

type ComposeUser = { id: string; username: string; email: string; city: string; state: string }

export default function EmailComposeTab({ users }: { users: ComposeUser[] }) {
  const [targetKind, setTargetKind] = useState<'all' | 'user' | 'filtered'>('all')
  const [userSearch, setUserSearch] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [recipientCount, setRecipientCount] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cities = useMemo(() => [...new Set(users.map(u => u.city).filter(Boolean))].sort(), [users])
  const states = useMemo(() => [...new Set(users.map(u => u.state).filter(Boolean))].sort(), [users])
  const matchingUsers = useMemo(
    () => users.filter(u => u.username.toLowerCase().includes(userSearch.toLowerCase()) || u.email.toLowerCase().includes(userSearch.toLowerCase())).slice(0, 8),
    [users, userSearch]
  )

  function currentTarget(): BroadcastTarget | null {
    if (targetKind === 'all') return { kind: 'all' }
    if (targetKind === 'user') return selectedUserId ? { kind: 'user', userId: selectedUserId } : null
    if (targetKind === 'filtered') return { kind: 'filtered', city: city || undefined, state: state || undefined }
    return null
  }

  async function startConfirm() {
    setError(null)
    setResult(null)
    const target = currentTarget()
    if (!target) { setError('Pick a recipient.'); return }
    if (!subject.trim() || !body.trim()) { setError('Subject and body are required.'); return }

    const res = await resolveBroadcastRecipients(target)
    if (!res.ok) { setError(res.error ?? 'Failed to look up recipients.'); return }
    setRecipientCount(res.recipients?.length ?? 0)
    setConfirming(true)
  }

  async function confirmSend() {
    const target = currentTarget()
    if (!target) return
    setSending(true)
    const res = await sendBroadcastEmail(target, subject, body)
    setSending(false)
    setConfirming(false)
    if (res.ok) {
      setResult({ sent: res.sent, failed: res.failed })
      setSubject('')
      setBody('')
    } else {
      setError(res.error ?? 'Failed to send.')
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="font-display text-[22px] text-[#1e293b]">Compose Email</h2>

      <div className="bg-white rounded-2xl p-5 border border-[#f1f5f9] shadow-sm space-y-4">
        <div className="flex gap-2">
          {(['all', 'user', 'filtered'] as const).map(k => (
            <button key={k} onClick={() => setTargetKind(k)}
              className={`px-3 py-1.5 rounded-full font-extrabold text-[12px] border-2 transition-colors ${targetKind === k ? 'bg-bk-orange border-bk-orange text-white' : 'bg-white border-[#e2e8f0] text-[#64748b]'}`}>
              {k === 'all' ? 'All Users' : k === 'user' ? 'One User' : 'Filtered Group'}
            </button>
          ))}
        </div>

        {targetKind === 'user' && (
          <div>
            <input
              value={userSearch} onChange={e => { setUserSearch(e.target.value); setSelectedUserId(null) }}
              placeholder="Search by username or email…"
              className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2 font-bold text-[13px] focus:outline-none focus:border-bk-orange"
            />
            {userSearch && !selectedUserId && (
              <div className="mt-2 border border-[#f1f5f9] rounded-xl overflow-hidden">
                {matchingUsers.map(u => (
                  <button key={u.id} onClick={() => { setSelectedUserId(u.id); setUserSearch(`${u.username} (${u.email})`) }}
                    className="w-full text-left px-3 py-2 text-[13px] font-semibold hover:bg-[#f8fafc] border-b border-[#f8fafc] last:border-0">
                    {u.username} <span className="text-[#94a3b8]">— {u.email}</span>
                  </button>
                ))}
                {matchingUsers.length === 0 && <div className="px-3 py-2 text-[12px] text-[#94a3b8] font-semibold">No matches</div>}
              </div>
            )}
          </div>
        )}

        {targetKind === 'filtered' && (
          <div className="grid grid-cols-2 gap-3">
            <select value={city} onChange={e => setCity(e.target.value)} className="border-2 border-[#e2e8f0] rounded-xl px-3 py-2 font-bold text-[13px] bg-white">
              <option value="">Any city</option>
              {cities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={state} onChange={e => setState(e.target.value)} className="border-2 border-[#e2e8f0] rounded-xl px-3 py-2 font-bold text-[13px] bg-white">
              <option value="">Any state</option>
              {states.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}

        <div>
          <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Subject</label>
          <input value={subject} onChange={e => setSubject(e.target.value)}
            className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
        </div>
        <div>
          <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Body</label>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={6}
            className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-semibold text-[13px] focus:outline-none focus:border-bk-orange resize-y" />
        </div>

        {error && <div className="bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-red-700 font-bold text-sm">{error}</div>}
        {result && (
          <div className="bg-teal-50 border-2 border-teal-200 rounded-xl px-4 py-3 text-teal-700 font-bold text-sm">
            Sent to {result.sent}{result.failed > 0 ? `, failed for ${result.failed}` : ''}.
          </div>
        )}

        <button onClick={startConfirm}
          className="bg-bk-orange text-white rounded-xl px-4 py-2.5 font-extrabold text-[13px] shadow-[0_3px_0_#c2410c]">
          Send…
        </button>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-3xl w-full max-w-[420px] p-6 shadow-2xl">
            <h2 className="font-display text-[18px] text-[#1e293b] mb-3">Confirm Send</h2>
            <p className="font-semibold text-[14px] text-[#334155] mb-5">
              This will email <span className="font-black text-bk-orange">{recipientCount}</span> {recipientCount === 1 ? 'person' : 'people'}. Send?
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirming(false)} className="flex-1 border-2 border-[#e2e8f0] rounded-xl py-2.5 font-extrabold text-[14px] text-[#64748b]">Cancel</button>
              <button onClick={confirmSend} disabled={sending} className="flex-1 bg-bk-orange text-white rounded-xl py-2.5 font-extrabold text-[14px] shadow-[0_3px_0_#c2410c] disabled:opacity-60">
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
