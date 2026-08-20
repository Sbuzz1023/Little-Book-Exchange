// app/admin/DisputesAdminTab.tsx
'use client'
import { useMemo, useState } from 'react'
import DisputeRow from './DisputeRow'
import type { EnrichedDispute } from '@/lib/disputeEnrichment'

type Filter = 'open' | 'resolved' | 'all'

export default function DisputesAdminTab({
  disputes,
  onChanged,
  onMessageReporter,
}: {
  disputes: EnrichedDispute[]
  onChanged: () => void
  onMessageReporter: (userId: string) => void
}) {
  const [filter, setFilter] = useState<Filter>('open')

  const shown = useMemo(() => {
    const sorted = [...disputes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    if (filter === 'all') return sorted
    return sorted.filter(d => d.status === filter)
  }, [disputes, filter])

  return (
    <div>
      <div className="flex gap-2 mb-3">
        {(['open', 'resolved', 'all'] as const).map(f => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full font-extrabold text-[12px] border-2 transition-colors ${filter === f ? 'bg-bk-orange border-bk-orange text-white' : 'bg-white border-[#e2e8f0] text-[#64748b]'}`}>
            {f === 'open' ? 'Open' : f === 'resolved' ? 'Resolved' : 'All'}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="font-bold text-[13px]" style={{ color: '#aaa' }}>No {filter === 'all' ? '' : filter} disputes.</p>
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
