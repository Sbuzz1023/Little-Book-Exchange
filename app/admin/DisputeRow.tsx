'use client'
import { useState } from 'react'
import { adminSetDisputeStatus, adminDeleteDispute } from '@/lib/actions/admin'
import type { EnrichedDispute } from '@/lib/disputeEnrichment'

export default function DisputeRow({
  dispute,
  context,
  cardUserId,
  onChanged,
  onMessageReporter,
}: {
  dispute: EnrichedDispute
  context: 'admin-tab' | 'user-card'
  cardUserId?: string
  onChanged: () => void
  onMessageReporter?: (userId: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      if (!result.ok) {
        setError(result.error ?? 'Something went wrong.')
        return
      }
      onChanged()
    } catch (err) {
      setError('Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  function handleDelete() {
    if (!window.confirm('Permanently delete this dispute? This cannot be undone.')) return
    run(() => adminDeleteDispute(dispute.id))
  }

  const framing = context === 'admin-tab'
    ? `Reported by ${dispute.reporterName} against ${dispute.otherPartyName}`
    : dispute.reporterId === cardUserId ? 'Filed by this user' : 'Filed against this user'

  return (
    <div style={{ background: '#fff', border: '2px solid #fecdd3', borderRadius: 16, padding: 16 }}>
      <p className="font-black text-[14px]">{dispute.bookTitle}</p>
      <p className="font-semibold text-[12px]" style={{ color: '#aaa' }}>
        {framing} · Filed {new Date(dispute.createdAt).toLocaleDateString()} ·{' '}
        <span style={{ color: dispute.status === 'open' ? '#dc2626' : '#059669' }}>
          {dispute.status === 'open' ? 'Open' : 'Resolved'}
        </span>
      </p>
      <p className="font-semibold text-[13px] mt-2" style={{ color: '#444' }}>{dispute.message}</p>
      {error && <p className="font-bold text-[12px] mt-2" style={{ color: '#e11d48' }}>{error}</p>}
      <div className="flex gap-2 mt-3">
        {dispute.status === 'open' && (
          <button type="button" disabled={busy} onClick={() => run(() => adminSetDisputeStatus(dispute.id, 'resolved'))}
            className="font-extrabold text-[12px] text-white"
            style={{ background: '#059669', padding: '7px 18px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            ✓ Resolve
          </button>
        )}
        {dispute.status === 'resolved' && (
          <button type="button" disabled={busy} onClick={() => run(() => adminSetDisputeStatus(dispute.id, 'open'))}
            className="font-extrabold text-[12px] text-white"
            style={{ background: '#f59e0b', padding: '7px 18px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            ↺ Unresolved
          </button>
        )}
        <button type="button" disabled={busy} onClick={handleDelete}
          className="font-extrabold text-[12px] text-white"
          style={{ background: '#dc2626', padding: '7px 18px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
          🗑️ Delete
        </button>
        {onMessageReporter && (
          <button type="button" onClick={() => onMessageReporter(dispute.reporterId)}
            className="font-extrabold text-[12px] text-white"
            style={{ background: '#0ea5e9', padding: '7px 18px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            💬 Message
          </button>
        )}
      </div>
    </div>
  )
}
