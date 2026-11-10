'use client'
import { useEffect, useRef, useState } from 'react'
import { getEmailHistory, type EmailHistoryRow } from '@/lib/actions/emailAdmin'

const KIND_LABELS: Record<EmailHistoryRow['kind'], string> = {
  broadcast: 'Broadcast',
  welcome_confirmation: 'Welcome & confirm',
  password_reset: 'Password reset',
}

export default function EmailHistoryTab() {
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<EmailHistoryRow[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Guards against an older (slower) search response overwriting a newer one.
  const requestId = useRef(0)

  useEffect(() => {
    const id = ++requestId.current
    const t = setTimeout(async () => {
      setLoading(true)
      const term = search.trim()
      const res = await getEmailHistory(term ? { search: term } : {})
      if (id !== requestId.current) return
      setLoading(false)
      if (!res.ok) { setError(res.error ?? 'Failed to load email history.'); setRows([]); setHasMore(false); return }
      setError(null)
      setRows(res.rows ?? [])
      setHasMore(!!res.hasMore)
    }, search ? 300 : 0)
    return () => clearTimeout(t)
  }, [search])

  async function loadMore() {
    const last = rows[rows.length - 1]
    if (!last) return
    const id = requestId.current
    setLoadingMore(true)
    const res = await getEmailHistory({ search: search.trim(), before: last.sent_at })
    if (id !== requestId.current) return
    setLoadingMore(false)
    if (!res.ok) { setError(res.error ?? 'Failed to load more.'); return }
    setError(null)
    setRows(prev => [...prev, ...(res.rows ?? [])])
    setHasMore(!!res.hasMore)
  }

  return (
    <div className="space-y-5">
      <h2 className="font-display text-[22px] text-[#1e293b]">Email History</h2>
      <div className="bg-white rounded-2xl p-5 border border-[#f1f5f9] shadow-sm space-y-4">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by recipient email or subject…"
          className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2 font-bold text-[13px] focus:outline-none focus:border-bk-orange"
        />

        {error && (
          <div className="rounded-xl px-4 py-3 font-bold text-sm border-2 bg-red-50 border-red-200 text-red-700">{error}</div>
        )}

        {loading ? (
          <div className="text-[13px] text-[#94a3b8] font-semibold">Loading…</div>
        ) : rows.length === 0 && !error ? (
          <div className="text-[13px] text-[#94a3b8] font-semibold">No emails yet.</div>
        ) : (
          <div className="border border-[#f1f5f9] rounded-xl overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="bg-[#f8fafc] text-[#64748b] font-extrabold">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Recipient</th>
                  <th className="px-3 py-2">Subject</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const username = r.profiles?.username
                  return (
                    <tr key={r.id} className="border-t border-[#f8fafc] align-top font-semibold text-[#1e293b]">
                      <td className="px-3 py-2 whitespace-nowrap">{new Date(r.sent_at).toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <div>{username ?? r.recipient_email}</div>
                        {username && <div className="text-[#94a3b8]">{r.recipient_email}</div>}
                      </td>
                      <td className="px-3 py-2">{r.subject}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{KIND_LABELS[r.kind] ?? r.kind}</td>
                      <td className="px-3 py-2">
                        {r.status === 'sent' ? (
                          <span className="text-teal-700 font-extrabold">Sent</span>
                        ) : (
                          <div title={r.error ?? undefined}>
                            <span className="text-red-700 font-extrabold">Failed</span>
                            {r.error && <div className="text-red-600 font-semibold">{r.error}</div>}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {hasMore && !loading && (
          <button onClick={loadMore} disabled={loadingMore}
            className="bg-[#1e293b] text-white rounded-xl px-4 py-2 font-extrabold text-[13px] shadow-[0_3px_0_#0f172a] disabled:opacity-60">
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  )
}
