'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { editLibraryLocation, deleteLibraryLocation } from '@/lib/actions/libraryLocations'
import { resolveLocationReport } from '@/lib/actions/locationReports'

const MapView = dynamic(() => import('@/app/locations/MapView'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#e8f4ea] font-bold text-[13px] text-[#888]">
      Loading map…
    </div>
  ),
})

type LocType = 'lfl' | 'library' | 'bookstore' | 'fair'

type AdminLocation = {
  id: string
  name: string
  type: LocType
  lat: number
  lng: number
  street: string
  city: string
  description: string
  startDate: string | null
  endDate: string | null
}

type Report = {
  id: string
  locationId: string
  locationName: string
  locationType: LocType
  street: string
  city: string
  reason: string
  reporter: string
  date: string
  status: 'pending' | 'resolved'
  resolution: 'edited' | 'removed' | 'dismissed' | null
}

const TYPE_META: Record<LocType, { emoji: string; label: string; color: string; bg: string }> = {
  lfl:       { emoji: '📚', label: 'LFL',       color: '#f97316', bg: '#fff7ed' },
  library:   { emoji: '🏛️', label: 'Library',   color: '#0d9488', bg: '#ecfdf5' },
  bookstore: { emoji: '📖', label: 'Bookstore', color: '#2563eb', bg: '#eff6ff' },
  fair:      { emoji: '🎪', label: 'Fair',      color: '#db2777', bg: '#fdf2f8' },
}

const TYPE_OPTIONS: { val: 'all' | LocType; label: string; emoji: string }[] = [
  { val: 'all',       label: 'All',       emoji: '' },
  { val: 'lfl',       label: 'LFL',       emoji: '📚' },
  { val: 'library',   label: 'Library',   emoji: '🏛️' },
  { val: 'bookstore', label: 'Bookstore', emoji: '📖' },
  { val: 'fair',      label: 'Fair',      emoji: '🎪' },
]

type EditForm = {
  name: string
  type: LocType
  street: string
  city: string
  description: string
  startDate: string
  endDate: string
  lat: number
  lng: number
}

function toEditForm(loc: AdminLocation): EditForm {
  return {
    name: loc.name,
    type: loc.type,
    street: loc.street,
    city: loc.city,
    description: loc.description,
    startDate: loc.startDate ?? '',
    endDate: loc.endDate ?? '',
    lat: loc.lat,
    lng: loc.lng,
  }
}

export default function LocationsAdminTab({ onPendingCountChange }: { onPendingCountChange: (n: number) => void }) {
  const [subTab, setSubTab] = useState<'all' | 'reports'>('all')
  const [locations, setLocations] = useState<AdminLocation[]>([])
  const [reports, setReports] = useState<Report[]>([])

  const [typeFilter, setTypeFilter] = useState<'all' | LocType>('all')
  const [citySearch, setCitySearch] = useState('')

  const [editTarget, setEditTarget] = useState<AdminLocation | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [editReportId, setEditReportId] = useState<string | null>(null)
  const [editError, setEditError] = useState('')
  const [editFlyNonce, setEditFlyNonce] = useState(0)

  const pendingCountRef = useRef(onPendingCountChange)
  pendingCountRef.current = onPendingCountChange

  useEffect(() => {
    const supabase = createClient()

    supabase
      .from('library_locations')
      .select('id, name, type, lat, lng, street, city, description, start_date, end_date')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!data) return
        setLocations(data.map(row => ({
          id: row.id,
          name: row.name,
          type: row.type,
          lat: row.lat,
          lng: row.lng,
          street: row.street,
          city: row.city,
          description: row.description || '',
          startDate: row.start_date,
          endDate: row.end_date,
        })))
      })

    supabase
      .from('location_reports')
      .select('id, location_id, reason, status, resolution, created_at, library_locations(name, type, street, city), profiles!reporter_id(username, email)')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!data) return
        const mapped: Report[] = (data as any[]).map(row => ({
          id: row.id,
          locationId: row.location_id,
          locationName: row.library_locations?.name ?? 'Deleted location',
          locationType: row.library_locations?.type ?? 'lfl',
          street: row.library_locations?.street ?? '',
          city: row.library_locations?.city ?? '',
          reason: row.reason,
          reporter: row.profiles?.username || row.profiles?.email || 'Unknown',
          date: row.created_at ? row.created_at.slice(0, 10) : '',
          status: row.status,
          resolution: row.resolution,
        }))
        setReports(mapped)
        pendingCountRef.current(mapped.filter(r => r.status === 'pending').length)
      })
  }, [])

  const filteredLocations = useMemo(() => {
    let result = locations
    if (typeFilter !== 'all') result = result.filter(l => l.type === typeFilter)
    if (citySearch.trim()) {
      const q = citySearch.trim().toLowerCase()
      result = result.filter(l => l.city.toLowerCase().includes(q))
    }
    return result
  }, [locations, typeFilter, citySearch])

  const pending = reports.filter(r => r.status === 'pending')
  const resolved = reports.filter(r => r.status !== 'pending')

  function openEdit(loc: AdminLocation, reportId?: string) {
    setEditTarget(loc)
    setEditForm(toEditForm(loc))
    setEditReportId(reportId ?? null)
    setEditError('')
    setEditFlyNonce(n => n + 1)
  }

  function closeEdit() {
    setEditTarget(null)
    setEditForm(null)
    setEditReportId(null)
    setEditError('')
  }

  function handleReposition(lat: number, lng: number) {
    setEditForm(f => f && ({ ...f, lat, lng }))
  }

  async function saveEdit() {
    if (!editTarget || !editForm) return

    const result = await editLibraryLocation(editTarget.id, {
      name: editForm.name.trim(),
      type: editForm.type,
      lat: editForm.lat,
      lng: editForm.lng,
      street: editForm.street.trim(),
      city: editForm.city.trim(),
      description: editForm.description.trim(),
      startDate: editForm.type === 'fair' ? editForm.startDate : undefined,
      endDate: editForm.type === 'fair' ? editForm.endDate : undefined,
    })

    if (!result.ok) { setEditError(result.error); return }

    const updated: AdminLocation = {
      id: result.location.id,
      name: result.location.name,
      type: result.location.type,
      lat: result.location.lat,
      lng: result.location.lng,
      street: result.location.street,
      city: result.location.city,
      description: result.location.description ?? '',
      startDate: result.location.startDate ?? null,
      endDate: result.location.endDate ?? null,
    }
    setLocations(prev => prev.map(l => l.id === updated.id ? updated : l))

    if (editReportId) {
      const resolveResult = await resolveLocationReport(editReportId, 'edited')
      if (!resolveResult.ok) { alert(resolveResult.error) }
      else {
        setReports(prev => {
          const next = prev.map(r => r.id === editReportId ? { ...r, status: 'resolved' as const, resolution: 'edited' as const } : r)
          pendingCountRef.current(next.filter(r => r.status === 'pending').length)
          return next
        })
      }
    }

    closeEdit()
  }

  async function handleDelete(loc: AdminLocation, reportId?: string) {
    if (!window.confirm(`Delete "${loc.name}"? This cannot be undone.`)) return

    const result = await deleteLibraryLocation(loc.id)
    if (!result.ok) { alert(result.error); return }

    setLocations(prev => prev.filter(l => l.id !== loc.id))

    if (reportId) {
      await resolveLocationReport(reportId, 'removed')
    }

    setReports(prev => {
      // Deleting a location cascades away every report about it in the
      // database — mirror that locally, except keep (and mark resolved)
      // the specific report this delete was resolving, if any.
      const next = prev
        .filter(r => r.locationId !== loc.id || r.id === reportId)
        .map(r => r.id === reportId ? { ...r, status: 'resolved' as const, resolution: 'removed' as const } : r)
      pendingCountRef.current(next.filter(r => r.status === 'pending').length)
      return next
    })
  }

  async function handleDismiss(report: Report) {
    const result = await resolveLocationReport(report.id, 'dismissed')
    if (!result.ok) { alert(result.error); return }
    setReports(prev => {
      const next = prev.map(r => r.id === report.id ? { ...r, status: 'resolved' as const, resolution: 'dismissed' as const } : r)
      pendingCountRef.current(next.filter(r => r.status === 'pending').length)
      return next
    })
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {(['all', 'reports'] as const).map(t => (
          <button key={t} onClick={() => setSubTab(t)}
            className={`px-4 py-2 rounded-full font-extrabold text-[13px] border-2 transition-colors ${subTab === t ? 'bg-bk-orange border-bk-orange text-white' : 'bg-white border-[#e2e8f0] text-[#64748b] hover:border-bk-orange'}`}>
            {t === 'all' ? `📍 All Locations (${locations.length})` : `🚩 Reports (${pending.length} pending)`}
          </button>
        ))}
      </div>

      {subTab === 'all' ? (
        <AllLocationsPanel
          locations={filteredLocations}
          typeFilter={typeFilter} setTypeFilter={setTypeFilter}
          citySearch={citySearch} setCitySearch={setCitySearch}
          onEdit={loc => openEdit(loc)}
          onDelete={loc => handleDelete(loc)}
        />
      ) : (
        <ReportsPanel
          pending={pending} resolved={resolved}
          onEdit={report => {
            const loc = locations.find(l => l.id === report.locationId)
            if (loc) openEdit(loc, report.id)
          }}
          onRemove={report => {
            const loc = locations.find(l => l.id === report.locationId)
            if (loc) handleDelete(loc, report.id)
          }}
          onDismiss={handleDismiss}
        />
      )}

      {editTarget && editForm && (
        <EditLocationModal
          form={editForm} setForm={setEditForm}
          error={editError}
          flyNonce={editFlyNonce}
          onCancel={closeEdit}
          onSave={saveEdit}
          onReposition={handleReposition}
        />
      )}
    </div>
  )
}

function AllLocationsPanel({ locations, typeFilter, setTypeFilter, citySearch, setCitySearch, onEdit, onDelete }: {
  locations: AdminLocation[]
  typeFilter: 'all' | LocType
  setTypeFilter: (t: 'all' | LocType) => void
  citySearch: string
  setCitySearch: (s: string) => void
  onEdit: (loc: AdminLocation) => void
  onDelete: (loc: AdminLocation) => void
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {TYPE_OPTIONS.map(opt => (
          <button key={opt.val} onClick={() => setTypeFilter(opt.val)}
            className={`px-3 py-1.5 rounded-full font-extrabold text-[12px] border-2 transition-colors ${typeFilter === opt.val ? 'bg-bk-orange border-bk-orange text-white' : 'bg-white border-[#e2e8f0] text-[#64748b] hover:border-bk-orange'}`}>
            {opt.emoji ? `${opt.emoji} ` : ''}{opt.label}
          </button>
        ))}
        <input
          value={citySearch}
          onChange={e => setCitySearch(e.target.value)}
          placeholder="Filter by city…"
          className="border-2 border-[#e2e8f0] rounded-xl px-3 py-1.5 font-bold text-[13px] focus:outline-none focus:border-bk-orange ml-auto w-[200px]"
        />
      </div>

      <div className="bg-white rounded-2xl border border-[#f1f5f9] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#f1f5f9] bg-[#f8fafc]">
                {['Name', 'Type', 'Street', 'City', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-extrabold text-[#94a3b8] uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {locations.map(loc => {
                const meta = TYPE_META[loc.type]
                return (
                  <tr key={loc.id} className="border-b border-[#f8fafc] hover:bg-[#fafafa] transition-colors">
                    <td className="px-4 py-3 font-black text-[13px] text-[#1e293b]">{loc.name}</td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] font-extrabold px-2.5 py-1 rounded-full" style={{ background: meta.bg, color: meta.color }}>
                        {meta.emoji} {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[12px] font-semibold text-[#64748b] whitespace-nowrap">{loc.street}</td>
                    <td className="px-4 py-3 text-[12px] font-semibold text-[#64748b] whitespace-nowrap">{loc.city}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3 justify-end">
                        <button onClick={() => onEdit(loc)} className="text-[12px] font-bold text-bk-orange hover:underline whitespace-nowrap">Edit ✏️</button>
                        <button onClick={() => onDelete(loc)} className="text-[12px] font-bold text-red-500 hover:underline whitespace-nowrap">Delete 🗑️</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {locations.length === 0 && (
            <div className="py-12 text-center text-[#94a3b8] font-bold text-[14px]">No locations match this filter</div>
          )}
        </div>
      </div>
    </div>
  )
}

function ReportsPanel({ pending, resolved, onEdit, onRemove, onDismiss }: {
  pending: Report[]
  resolved: Report[]
  onEdit: (r: Report) => void
  onRemove: (r: Report) => void
  onDismiss: (r: Report) => void
}) {
  const RESOLUTION_LABEL: Record<NonNullable<Report['resolution']>, string> = {
    edited: 'Edited', removed: 'Removed', dismissed: 'Dismissed',
  }
  const RESOLUTION_COLOR: Record<NonNullable<Report['resolution']>, string> = {
    edited: '#f97316', removed: '#dc2626', dismissed: '#059669',
  }

  return (
    <div>
      {pending.length === 0 && (
        <div className="bg-white rounded-2xl border border-[#f1f5f9] p-12 text-center">
          <div className="text-4xl mb-3">✅</div>
          <p className="font-black text-[16px] text-[#1e293b]">All reports resolved</p>
          <p className="font-semibold text-[13px] text-[#94a3b8] mt-1">No pending location reports.</p>
        </div>
      )}

      <div className="space-y-4">
        {pending.map(r => {
          const meta = TYPE_META[r.locationType]
          return (
            <div key={r.id} className="bg-white rounded-2xl border border-[#f1f5f9] shadow-sm overflow-hidden">
              <div className="px-5 py-3 flex items-center gap-3 border-b border-[#f1f5f9]" style={{ background: meta.bg }}>
                <span className="text-xl">{meta.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-black text-[14px] text-[#1e293b]">{r.locationName}</div>
                  <div className="text-[12px] font-semibold text-[#64748b]">{r.street}, {r.city} · {meta.label}</div>
                </div>
                <span className="text-[11px] font-bold text-[#94a3b8] shrink-0">{r.date}</span>
              </div>
              <div className="px-5 py-4">
                <div className="text-[12px] font-extrabold text-[#94a3b8] uppercase tracking-wide mb-1">Report from {r.reporter}</div>
                <p className="font-semibold text-[14px] text-[#334155] leading-relaxed mb-4">"{r.reason}"</p>
                <div className="flex gap-3 flex-wrap">
                  <button onClick={() => onEdit(r)}
                    className="flex-1 min-w-[120px] bg-[#fff7ed] text-[#c2410c] border-2 border-[#fed7aa] rounded-xl py-2.5 font-extrabold text-[13px] hover:bg-orange-100 transition-colors">
                    ✏️ Edit Location
                  </button>
                  <button onClick={() => onRemove(r)}
                    className="flex-1 min-w-[120px] bg-[#fef2f2] text-[#dc2626] border-2 border-[#fecaca] rounded-xl py-2.5 font-extrabold text-[13px] hover:bg-red-100 transition-colors">
                    🗑️ Remove Location
                  </button>
                  <button onClick={() => onDismiss(r)}
                    className="flex-1 min-w-[120px] bg-[#f0fdf4] text-[#059669] border-2 border-[#bbf7d0] rounded-xl py-2.5 font-extrabold text-[13px] hover:bg-green-100 transition-colors">
                    ✓ Dismiss
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {resolved.length > 0 && (
        <div className="mt-8">
          <h3 className="font-black text-[14px] text-[#94a3b8] uppercase tracking-wide mb-3">Resolved</h3>
          <div className="space-y-2">
            {resolved.map(r => (
              <div key={r.id} className="bg-white rounded-xl border border-[#f1f5f9] px-4 py-3 flex items-center gap-3">
                <span className="text-[17px]">{TYPE_META[r.locationType].emoji}</span>
                <div className="flex-1">
                  <span className="font-bold text-[13px] text-[#334155]">{r.locationName}</span>
                  <span className="text-[12px] text-[#94a3b8] font-semibold ml-2">{r.city}</span>
                </div>
                {r.resolution && (
                  <span className="text-[11px] font-extrabold px-2.5 py-1 rounded-full" style={{ background: RESOLUTION_COLOR[r.resolution] + '18', color: RESOLUTION_COLOR[r.resolution] }}>
                    {RESOLUTION_LABEL[r.resolution]}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function EditLocationModal({ form, setForm, error, flyNonce, onCancel, onSave, onReposition }: {
  form: EditForm
  setForm: React.Dispatch<React.SetStateAction<EditForm | null>>
  error: string
  flyNonce: number
  onCancel: () => void
  onSave: () => void
  onReposition: (lat: number, lng: number) => void
}) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white rounded-3xl w-full max-w-[520px] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-[20px] text-[#1e293b]">Edit Location</h2>
          <button onClick={onCancel} className="text-[#94a3b8] hover:text-[#475569] text-[22px] font-black leading-none">×</button>
        </div>

        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Name</label>
            <input value={form.name} onChange={e => setForm(f => f && ({ ...f, name: e.target.value }))}
              className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
          </div>
          <div>
            <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Type</label>
            <select value={form.type} onChange={e => setForm(f => f && ({ ...f, type: e.target.value as LocType }))}
              className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange bg-white">
              <option value="lfl">📚 Little Free Library</option>
              <option value="library">🏛️ Public Library</option>
              <option value="bookstore">📖 Book Store</option>
              <option value="fair">🎪 Library Fair</option>
            </select>
          </div>
          {form.type === 'fair' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Start Date</label>
                <input type="date" value={form.startDate} onChange={e => setForm(f => f && ({ ...f, startDate: e.target.value }))}
                  className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
              </div>
              <div>
                <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">End Date</label>
                <input type="date" value={form.endDate} onChange={e => setForm(f => f && ({ ...f, endDate: e.target.value }))}
                  className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
              </div>
            </div>
          )}
          <div>
            <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Street</label>
            <input value={form.street} onChange={e => setForm(f => f && ({ ...f, street: e.target.value }))}
              className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
          </div>
          <div>
            <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">City</label>
            <input value={form.city} onChange={e => setForm(f => f && ({ ...f, city: e.target.value }))}
              className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
          </div>
          <div>
            <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Description</label>
            <input value={form.description} onChange={e => setForm(f => f && ({ ...f, description: e.target.value }))}
              className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-semibold text-[14px] focus:outline-none focus:border-bk-orange" />
          </div>
          <div>
            <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">
              Position <span className="font-semibold text-[#94a3b8] normal-case">— click the map to move the pin</span>
            </label>
            <div className="h-[220px] rounded-xl overflow-hidden border-2 border-[#e2e8f0]">
              <MapView
                locations={[]}
                pendingPin={[form.lat, form.lng]}
                flyTo={{ center: [form.lat, form.lng], zoom: 15, nonce: flyNonce }}
                addMode={true}
                onMapClick={onReposition}
                onReport={() => {}}
                onBoundsChange={() => {}}
              />
            </div>
            <p className="text-[11px] font-semibold text-[#94a3b8] mt-1">{form.lat.toFixed(4)}°, {form.lng.toFixed(4)}°</p>
          </div>
        </div>

        {error && <p className="text-red-500 font-bold text-[13px] mb-3">⚠️ {error}</p>}

        <div className="flex gap-3">
          <button onClick={onCancel}
            className="flex-1 border-2 border-[#e2e8f0] rounded-xl py-3 font-extrabold text-[14px] text-[#64748b]">Cancel</button>
          <button onClick={onSave}
            className="flex-1 bg-bk-orange text-white rounded-xl py-3 font-extrabold text-[14px] shadow-[0_3px_0_#c2410c]">Save Changes</button>
        </div>
      </div>
    </div>
  )
}
