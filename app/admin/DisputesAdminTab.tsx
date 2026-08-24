// app/admin/DisputesAdminTab.tsx
'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import DisputeRow from './DisputeRow'
import { markDisputesRead } from '@/lib/actions/admin'
import { isDisputeUnread } from '@/lib/adminUnread'
import type { EnrichedDispute } from '@/lib/disputeEnrichment'

type Filter = 'active' | 'history'

export default function DisputesAdminTab({
  disputes,
  disputesLoaded,
  onChanged,
  onMessageReporter,
}: {
  disputes: EnrichedDispute[]
  disputesLoaded: boolean
  onChanged: () => void
  onMessageReporter: (userId: string) => void
}) {
  const [filter, setFilter] = useState<Filter>('active')
  const alreadyMarked = useRef<Set<string>>(new Set())

  // Dispute rows have no separate "click to view" — the full thing is always
  // shown inline — so being rendered here IS the read event. Only fires for
  // ids we haven't already sent, so a re-render with unchanged data is a
  // no-op rather than an extra request.
  useEffect(() => {
    if (!disputesLoaded) return
    const newlyUnread = disputes
      .filter(d => isDisputeUnread(d.status, d.adminReadAt) && !alreadyMarked.current.has(d.id))
      .map(d => d.id)
    if (newlyUnread.length === 0) return
    for (const id of newlyUnread) alreadyMarked.current.add(id)
    markDisputesRead(newlyUnread).then(() => onChanged())
  }, [disputes, disputesLoaded, onChanged])

  const shown = useMemo(() => {
    const sorted = [...disputes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    // Active = still open, needs admin attention. History = archived either
    // way (resolved or unresolved) — a one-way move, no reopening from here.
    return filter === 'active'
      ? sorted.filter(d => d.status === 'open')
      : sorted.filter(d => d.status !== 'open')
  }, [disputes, filter])

  return (
    <div>
      <div className="flex gap-2 mb-3">
        {(['active', 'history'] as const).map(f => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full font-extrabold text-[12px] border-2 transition-colors ${filter === f ? 'bg-bk-orange border-bk-orange text-white' : 'bg-white border-[#e2e8f0] text-[#64748b]'}`}>
            {f === 'active' ? 'Active' : 'History'}
          </button>
        ))}
      </div>
      {!disputesLoaded ? (
        <p className="font-bold text-[13px]" style={{ color: '#aaa' }}>Loading disputes...</p>
      ) : shown.length === 0 ? (
        <p className="font-bold text-[13px]" style={{ color: '#aaa' }}>{filter === 'active' ? 'No active disputes.' : 'No history yet.'}</p>
      ) : (
        <div className="flex flex-col" style={{ gap: 12 }}>
          {shown.map(d => (
            <DisputeRow key={d.id} dispute={d} context="admin-tab" onChanged={onChanged} onMessageReporter={onMessageReporter} />
          ))}
        </div>
      )}
    </div>
  )
}
