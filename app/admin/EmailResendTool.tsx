'use client'
import { useState, useMemo } from 'react'
import { resendConfirmationEmail, resendPasswordResetEmail } from '@/lib/actions/emailAdmin'

type ResendUser = { id: string; username: string; email: string }

export default function EmailResendTool({ users }: { users: ResendUser[] }) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ResendUser | null>(null)
  const [busy, setBusy] = useState<'confirmation' | 'reset' | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const matches = useMemo(
    () => users.filter(u => u.username.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())).slice(0, 8),
    [users, search]
  )

  async function resend(kind: 'confirmation' | 'reset') {
    if (!selected) return
    setBusy(kind)
    setMessage(null)
    const result = kind === 'confirmation' ? await resendConfirmationEmail(selected.id) : await resendPasswordResetEmail(selected.id)
    setBusy(null)
    setMessage({ ok: result.ok, text: result.ok ? 'Sent!' : (result.error ?? 'Failed to send.') })
  }

  return (
    <div className="space-y-5">
      <h2 className="font-display text-[22px] text-[#1e293b]">Resend an Email</h2>
      <div className="bg-white rounded-2xl p-5 border border-[#f1f5f9] shadow-sm space-y-4">
        <input
          value={search} onChange={e => { setSearch(e.target.value); setSelected(null); setMessage(null) }}
          placeholder="Search by username or email…"
          className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2 font-bold text-[13px] focus:outline-none focus:border-bk-orange"
        />
        {search && !selected && (
          <div className="border border-[#f1f5f9] rounded-xl overflow-hidden">
            {matches.map(u => (
              <button key={u.id} onClick={() => { setSelected(u); setSearch(`${u.username} (${u.email})`) }}
                className="w-full text-left px-3 py-2 text-[13px] font-semibold hover:bg-[#f8fafc] border-b border-[#f8fafc] last:border-0">
                {u.username} <span className="text-[#94a3b8]">— {u.email}</span>
              </button>
            ))}
            {matches.length === 0 && <div className="px-3 py-2 text-[12px] text-[#94a3b8] font-semibold">No matches</div>}
          </div>
        )}

        {selected && (
          <div className="flex gap-3">
            <button onClick={() => resend('confirmation')} disabled={busy !== null}
              className="bg-bk-orange text-white rounded-xl px-4 py-2 font-extrabold text-[13px] shadow-[0_3px_0_#c2410c] disabled:opacity-60">
              {busy === 'confirmation' ? 'Sending…' : 'Resend Confirmation Email'}
            </button>
            <button onClick={() => resend('reset')} disabled={busy !== null}
              className="bg-[#1e293b] text-white rounded-xl px-4 py-2 font-extrabold text-[13px] shadow-[0_3px_0_#0f172a] disabled:opacity-60">
              {busy === 'reset' ? 'Sending…' : 'Resend Password Reset'}
            </button>
          </div>
        )}

        {message && (
          <div className={`rounded-xl px-4 py-3 font-bold text-sm border-2 ${message.ok ? 'bg-teal-50 border-teal-200 text-teal-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {message.text}
          </div>
        )}
      </div>
    </div>
  )
}
