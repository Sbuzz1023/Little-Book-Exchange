'use client'
import { useState, useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import type { LibraryLocation } from './MapView'

const MapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#e8f4ea] font-bold text-[#888]">
      Loading map…
    </div>
  ),
})

const MOCK_LOCATIONS: LibraryLocation[] = [
  { id: 'm1',  name: 'Hawthorne LFL',           type: 'lfl',     lat: 45.5122, lng: -122.6587, street: 'SE Hawthorne Blvd', city: 'Portland, OR',  description: 'By the coffee shop — look for the blue door' },
  { id: 'm2',  name: 'Alberta Arts LFL',         type: 'lfl',     lat: 45.5586, lng: -122.6476, street: 'NE Alberta St',     city: 'Portland, OR',  description: 'Painted like a little schoolhouse' },
  { id: 'm3',  name: 'Multnomah County Library', type: 'library', lat: 45.5185, lng: -122.6793, street: 'SW 10th Ave',       city: 'Portland, OR',  description: 'Central branch' },
  { id: 'm4',  name: 'Capitol Hill LFL',         type: 'lfl',     lat: 47.6235, lng: -122.3212, street: 'E Pine St',         city: 'Seattle, WA',   description: 'Yellow mini-house on a post' },
  { id: 'm5',  name: 'Seattle Public Library',   type: 'library', lat: 47.6066, lng: -122.3328, street: '4th Ave',           city: 'Seattle, WA',   description: 'Central branch — iconic glass building' },
  { id: 'm6',  name: 'Lincoln Park LFL',         type: 'lfl',     lat: 41.9207, lng: -87.6490,  street: 'N Lincoln Ave',     city: 'Chicago, IL' },
  { id: 'm7',  name: 'Wicker Park LFL',          type: 'lfl',     lat: 41.9085, lng: -87.6787,  street: 'W North Ave',       city: 'Chicago, IL',   description: 'By the park bench near the fountain' },
  { id: 'm8',  name: 'Harold Washington Library',type: 'library', lat: 41.8836, lng: -87.6275,  street: 'S State St',        city: 'Chicago, IL',   description: 'Chicago Public Library main branch' },
  { id: 'm9',  name: 'South Congress LFL',       type: 'lfl',     lat: 30.2399, lng: -97.7489,  street: 'S Congress Ave',    city: 'Austin, TX' },
  { id: 'm10', name: 'Austin Central Library',   type: 'library', lat: 30.2662, lng: -97.7421,  street: 'W César Chávez St', city: 'Austin, TX',    description: 'Rooftop garden and reading room' },
  { id: 'm11', name: 'Park Slope LFL',           type: 'lfl',     lat: 40.6681, lng: -73.9797,  street: '7th Ave',           city: 'Brooklyn, NY' },
  { id: 'm12', name: 'Cobble Hill LFL',          type: 'lfl',     lat: 40.6862, lng: -73.9931,  street: 'Atlantic Ave',      city: 'Brooklyn, NY',  description: 'Shaped like a red barn' },
  { id: 'm13', name: 'Brooklyn Public Library',  type: 'library', lat: 40.6722, lng: -73.9678,  street: 'Eastern Pkwy',      city: 'Brooklyn, NY',  description: 'Grand Army Plaza — art deco' },
  { id: 'm14', name: 'Capitol Hill LFL',         type: 'lfl',     lat: 39.7329, lng: -104.9792, street: 'E Colfax Ave',      city: 'Denver, CO' },
  { id: 'm15', name: 'Denver Public Library',    type: 'library', lat: 39.7327, lng: -104.9877, street: 'W 14th Ave Pkwy',   city: 'Denver, CO',    description: 'Central branch — striking architecture' },
]

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180, Δλ = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

async function geocode(query: string): Promise<[number, number] | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
      { headers: { 'Accept-Language': 'en' } }
    )
    const data = await res.json()
    if (data?.[0]) return [parseFloat(data[0].lat), parseFloat(data[0].lon)]
  } catch {}
  return null
}

const DISTANCE_OPTIONS = [
  { val: 0, label: 'All' }, { val: 1, label: '1 mi' }, { val: 5, label: '5 mi' },
  { val: 10, label: '10 mi' }, { val: 25, label: '25 mi' }, { val: 50, label: '50 mi' },
]

type FlyTo = { center: [number, number]; zoom: number; nonce: number }

export default function LocationsClient() {
  const [locations, setLocations] = useState<LibraryLocation[]>(MOCK_LOCATIONS)
  const [userCoords, setUserCoords] = useState<[number, number] | null>(null)
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null)
  const [search, setSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [distance, setDistance] = useState(0)
  const [geoLoading, setGeoLoading] = useState(false)

  // Add location state
  const [addMode, setAddMode] = useState(false)
  const [pendingPin, setPendingPin] = useState<[number, number] | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState({ name: '', type: 'lfl' as 'lfl' | 'library', street: '', city: '', description: '' })
  const [formError, setFormError] = useState('')

  // Report / request-to-move state
  const [reportTarget, setReportTarget] = useState<LibraryLocation | null>(null)
  const [reportReason, setReportReason] = useState('')
  const [reportSent, setReportSent] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem('lbe_map_locations')
      if (stored) {
        const userAdded: LibraryLocation[] = JSON.parse(stored)
        setLocations(prev => [...prev, ...userAdded])
      }
    } catch {}
  }, [])

  const filteredLocations = useMemo(() => {
    let result = locations
    if (distance > 0 && userCoords) {
      result = result.filter(l => haversine(userCoords[0], userCoords[1], l.lat, l.lng) <= distance)
    }
    if (userCoords) {
      result = [...result].sort((a, b) =>
        haversine(userCoords[0], userCoords[1], a.lat, a.lng) -
        haversine(userCoords[0], userCoords[1], b.lat, b.lng)
      )
    }
    return result
  }, [locations, userCoords, distance])

  function flyToCoords(coords: [number, number], zoom = 12) {
    setFlyTo({ center: coords, zoom, nonce: Date.now() })
  }

  function useMyLocation() {
    if (!navigator.geolocation) return
    setGeoLoading(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude]
        setUserCoords(coords)
        flyToCoords(coords)
        setGeoLoading(false)
      },
      () => {
        setGeoLoading(false)
        alert('Could not get your location — check your browser permissions.')
      }
    )
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!search.trim()) return
    setSearching(true)
    const coords = await geocode(search)
    setSearching(false)
    if (coords) { setUserCoords(coords); flyToCoords(coords) }
    else alert('Location not found. Try a city name or full address.')
  }

  function handleMapClick(lat: number, lng: number) {
    setPendingPin([lat, lng])
    setShowAddForm(true)
  }

  function cancelAdd() {
    setAddMode(false); setPendingPin(null); setShowAddForm(false)
    setForm({ name: '', type: 'lfl', street: '', city: '', description: '' })
    setFormError('')
  }

  function saveLocation() {
    if (!pendingPin) return
    if (!form.name.trim())   { setFormError('Library name is required'); return }
    if (!form.street.trim()) { setFormError('Street is required'); return }
    if (!form.city.trim())   { setFormError('City is required'); return }
    const newLoc: LibraryLocation = {
      id: `u${Date.now()}`, name: form.name.trim(), type: form.type,
      lat: pendingPin[0], lng: pendingPin[1],
      street: form.street.trim(), city: form.city.trim(),
      description: form.description.trim() || undefined, isUserAdded: true,
    }
    setLocations(prev => {
      const next = [...prev, newLoc]
      try { localStorage.setItem('lbe_map_locations', JSON.stringify(next.filter(l => l.isUserAdded))) } catch {}
      return next
    })
    cancelAdd()
  }

  function sendReport() {
    // Demo: show success (would normally POST to admin API)
    setReportSent(true)
    setTimeout(() => {
      setReportTarget(null); setReportReason(''); setReportSent(false)
    }, 2200)
  }

  const lflCount = filteredLocations.filter(l => l.type === 'lfl').length
  const libCount = filteredLocations.filter(l => l.type === 'library').length

  return (
    <>
      {/* ── Fixed-height shell on desktop, natural scroll on mobile ── */}
      <div className="flex flex-col lg:h-[calc(100vh-68px)] lg:overflow-hidden bg-cream">

        {/* Page header */}
        <div className="flex-shrink-0 bg-bk-orange px-4 md:px-8 py-4">
          <h1 className="font-display text-[24px] md:text-[28px] text-white leading-tight">
            🗺️ Little Free Library Locations
          </h1>
          <p className="text-[#fff7ed] font-semibold text-[13px] mt-0.5">
            Find community libraries near you — or add one to the map.
          </p>
        </div>

        {/* Search + location controls */}
        <div className="flex-shrink-0 bg-white border-b-4 border-[#fed7aa] px-4 md:px-6 py-2.5 flex flex-wrap gap-2 items-center">
          <form onSubmit={handleSearch} className="flex items-center gap-2 bg-[#fffbf0] border-2 border-[#fed7aa] rounded-xl px-3 py-2 flex-1 min-w-[180px]">
            <span className="text-[15px] shrink-0">🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by city or address…"
              className="flex-1 bg-transparent font-bold text-[14px] focus:outline-none min-w-0"
            />
            <button type="submit" disabled={searching}
              className="bg-bk-orange text-white font-extrabold text-[13px] px-3 py-1 rounded-lg shrink-0 disabled:opacity-60">
              {searching ? '…' : 'Go'}
            </button>
          </form>
          <button onClick={useMyLocation} disabled={geoLoading}
            className="flex items-center gap-1.5 font-bold text-[14px] text-bk-teal hover:text-bk-orange transition-colors shrink-0 disabled:opacity-60 whitespace-nowrap">
            {geoLoading ? '⏳' : '📍'} {geoLoading ? 'Finding…' : 'My Location'}
          </button>
        </div>

        {/* Distance filter */}
        <div className="flex-shrink-0 bg-white border-b border-[#f3f4f6] px-4 md:px-6 py-2 flex items-center gap-2 flex-wrap">
          <span className="font-bold text-[12px] text-[#999] shrink-0">Distance:</span>
          {DISTANCE_OPTIONS.map(opt => (
            <button key={opt.val} onClick={() => setDistance(opt.val)}
              className={`px-3 py-1 rounded-full font-extrabold text-[12px] border-2 transition-colors ${
                distance === opt.val
                  ? 'bg-bk-orange border-bk-orange text-white'
                  : 'bg-white border-[#e5e7eb] text-[#666] hover:border-bk-orange'
              }`}>
              {opt.label}
            </button>
          ))}
          {distance > 0 && !userCoords && (
            <span className="text-[12px] font-bold text-bk-orange ml-1">⚠️ Search a location first</span>
          )}
          <span className="ml-auto font-bold text-[12px] text-[#aaa] whitespace-nowrap">
            {lflCount} LFL{lflCount !== 1 ? 's' : ''} · {libCount} librar{libCount !== 1 ? 'ies' : 'y'}
          </span>
        </div>

        {/* Add mode hint banner */}
        {addMode && !pendingPin && (
          <div className="flex-shrink-0 bg-[#ecfdf5] border-b-2 border-bk-teal px-4 py-2.5 text-bk-teal font-bold text-[14px] text-center">
            Click anywhere on the map to drop your pin 📌
          </div>
        )}

        {/* ── Main content: List LEFT · Map RIGHT ── */}
        <div className="flex flex-col lg:flex-row lg:flex-1 lg:min-h-0 lg:overflow-hidden">

          {/* LIST — left panel (order-2 mobile = below map, order-1 desktop = left) */}
          <div className="order-2 lg:order-1 w-full lg:w-[380px] lg:flex-shrink-0 flex flex-col lg:overflow-hidden border-t-4 lg:border-t-0 lg:border-r-4 border-[#fed7aa] bg-white">

            {/* Add Location button — pinned at top of list */}
            <div className="flex-shrink-0 p-3 border-b border-[#f3f4f6]">
              {addMode ? (
                <button onClick={cancelAdd}
                  className="w-full flex items-center justify-center gap-2 bg-red-50 text-red-500 border-2 border-red-200 font-bold text-[14px] px-4 py-2.5 rounded-xl">
                  ✕ Cancel Adding Location
                </button>
              ) : (
                <button onClick={() => setAddMode(true)}
                  className="w-full flex items-center justify-center gap-2 bg-bk-teal text-white font-extrabold text-[14px] px-4 py-2.5 rounded-xl shadow-[0_3px_0_#0f766e] hover:shadow-[0_1px_0_#0f766e] hover:translate-y-px transition-all">
                  📌 Add a Location
                </button>
              )}
            </div>

            {/* Location cards — scrollable */}
            <div className="flex-1 lg:overflow-y-auto">
              {filteredLocations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-6 text-center text-[#bbb]">
                  <div className="text-5xl mb-3">📭</div>
                  <p className="font-bold text-[15px] text-[#aaa]">No locations found</p>
                  <p className="font-semibold text-[13px] mt-1">Try expanding the distance or searching a different area</p>
                </div>
              ) : (
                <div className="divide-y divide-[#f3f4f6]">
                  {filteredLocations.map(loc => (
                    <LocationCard
                      key={loc.id}
                      loc={loc}
                      userCoords={userCoords}
                      onReport={setReportTarget}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* MAP — right panel (order-1 mobile = above list, order-2 desktop = right) */}
          <div className="order-1 lg:order-2 lg:flex-1 relative h-[320px] lg:h-auto">
            <MapView
              locations={filteredLocations}
              pendingPin={pendingPin}
              flyTo={flyTo}
              addMode={addMode}
              onMapClick={handleMapClick}
              onReport={setReportTarget}
            />
          </div>

        </div>
      </div>

      {/* ── Add Location form modal ── */}
      {showAddForm && pendingPin && (
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-[440px] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="font-display text-[22px] mb-1">Add a Location</h2>
            <p className="text-[#aaa] font-semibold text-[13px] mb-4">
              📌 Pin at {pendingPin[0].toFixed(4)}°, {pendingPin[1].toFixed(4)}°
              <button onClick={() => { setPendingPin(null); setShowAddForm(false) }}
                className="text-bk-orange font-bold ml-3 text-[12px]">
                Move pin
              </button>
            </p>
            <div className="space-y-3 mb-4">
              <FormField label="Library Name *">
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Corner Street LFL"
                  className="w-full border-2 border-[#e5e7eb] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
              </FormField>
              <FormField label="Type *">
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as 'lfl' | 'library' }))}
                  className="w-full border-2 border-[#e5e7eb] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange bg-white">
                  <option value="lfl">📚 Little Free Library</option>
                  <option value="library">🏛️ City / Public Library</option>
                </select>
              </FormField>
              <FormField label="Street *" hint="No exact address needed">
                <input value={form.street} onChange={e => setForm(f => ({ ...f, street: e.target.value }))}
                  placeholder="e.g. Oak Street"
                  className="w-full border-2 border-[#e5e7eb] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
              </FormField>
              <FormField label="City *">
                <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                  placeholder="e.g. Portland, OR"
                  className="w-full border-2 border-[#e5e7eb] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
              </FormField>
              <FormField label="Description" hint="optional">
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. Red barn shape, near the oak tree"
                  className="w-full border-2 border-[#e5e7eb] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
              </FormField>
            </div>
            <p className="text-[#bbb] text-[12px] font-semibold mb-3">🔒 Exact addresses are not stored — the pin marks the spot.</p>
            {formError && <p className="text-red-500 font-bold text-[13px] mb-3">⚠️ {formError}</p>}
            <div className="flex gap-3">
              <button onClick={cancelAdd}
                className="flex-1 border-2 border-[#e5e7eb] rounded-xl py-3 font-extrabold text-[14px] text-[#888]">
                Cancel
              </button>
              <button onClick={saveLocation}
                className="flex-1 bg-bk-teal text-white rounded-xl py-3 font-extrabold text-[14px] shadow-[0_3px_0_#0f766e]">
                Save Location
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Request to Move / Report modal ── */}
      {reportTarget && (
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-[440px] p-6 shadow-2xl">
            {reportSent ? (
              <div className="text-center py-6">
                <div className="text-5xl mb-4">✅</div>
                <h2 className="font-display text-[22px] mb-2">Request Sent!</h2>
                <p className="font-semibold text-[14px] text-[#666]">
                  Our team will review your request and update the map accordingly.
                </p>
              </div>
            ) : (
              <>
                <h2 className="font-display text-[22px] mb-1">Request Location Change</h2>
                <p className="text-[#888] font-semibold text-[13px] mb-4">
                  This request will be sent to an admin for review.
                </p>

                {/* Location being reported */}
                <div className="bg-[#fffbf0] border-2 border-[#fed7aa] rounded-xl p-3 mb-4">
                  <div className="font-black text-[14px] text-[#2d2d2d]">{reportTarget.name}</div>
                  <div className="font-semibold text-[13px] text-[#666]">{reportTarget.street}, {reportTarget.city}</div>
                  <span className={`inline-block mt-1 text-[11px] font-extrabold px-2 py-0.5 rounded-full ${
                    reportTarget.type === 'lfl' ? 'bg-[#fff7ed] text-[#f97316]' : 'bg-[#ecfdf5] text-[#0d9488]'
                  }`}>
                    {reportTarget.type === 'lfl' ? '📚 LFL' : '🏛️ Library'}
                  </span>
                </div>

                <label className="block font-extrabold text-[13px] mb-1.5 text-[#444]">
                  Reason for request *
                </label>
                <textarea
                  value={reportReason}
                  onChange={e => setReportReason(e.target.value)}
                  placeholder="e.g. This library has moved to a new location / is no longer there / address is incorrect…"
                  rows={4}
                  className="w-full border-2 border-[#e5e7eb] rounded-xl px-3 py-2.5 font-semibold text-[14px] focus:outline-none focus:border-bk-orange resize-none mb-4"
                />

                <p className="text-[#bbb] text-[12px] font-semibold mb-4">
                  📬 Your request will be reviewed by our team within 1–3 business days.
                </p>

                <div className="flex gap-3">
                  <button onClick={() => { setReportTarget(null); setReportReason('') }}
                    className="flex-1 border-2 border-[#e5e7eb] rounded-xl py-3 font-extrabold text-[14px] text-[#888]">
                    Cancel
                  </button>
                  <button
                    onClick={sendReport}
                    disabled={!reportReason.trim()}
                    className="flex-1 bg-bk-orange text-white rounded-xl py-3 font-extrabold text-[14px] shadow-[0_3px_0_#c2410c] disabled:opacity-50 disabled:shadow-none"
                  >
                    Send Request
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block font-extrabold text-[13px] mb-1 text-[#444]">
        {label}
        {hint && <span className="font-semibold text-[#aaa] ml-1.5">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

function LocationCard({ loc, userCoords, onReport }: {
  loc: LibraryLocation
  userCoords: [number, number] | null
  onReport: (loc: LibraryLocation) => void
}) {
  const dist = userCoords ? haversine(userCoords[0], userCoords[1], loc.lat, loc.lng) : null
  return (
    <div className="px-4 py-3.5 hover:bg-[#fffbf0] transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="font-black text-[15px] text-[#2d2d2d]">{loc.name}</span>
            <span className={`shrink-0 text-[11px] font-extrabold px-2 py-0.5 rounded-full ${
              loc.type === 'lfl' ? 'bg-[#fff7ed] text-[#f97316]' : 'bg-[#ecfdf5] text-[#0d9488]'
            }`}>
              {loc.type === 'lfl' ? '📚 LFL' : '🏛️ Library'}
            </span>
          </div>
          <div className="text-[13px] font-semibold text-[#666]">{loc.street}, {loc.city}</div>
          {loc.description && (
            <div className="text-[12px] text-[#999] font-semibold mt-0.5 truncate">{loc.description}</div>
          )}
          {dist !== null && (
            <div className="text-[12px] font-extrabold text-bk-teal mt-1">{dist.toFixed(1)} mi away</div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <a href={`https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`}
            target="_blank" rel="noopener noreferrer"
            className="text-[12px] font-bold text-bk-orange hover:underline whitespace-nowrap">
            Directions ↗
          </a>
          <button onClick={() => onReport(loc)}
            className="text-[12px] font-bold text-[#bbb] hover:text-[#888] transition-colors whitespace-nowrap">
            📩 Report
          </button>
        </div>
      </div>
    </div>
  )
}
