'use client'
import { useState, useMemo } from 'react'
import dynamic from 'next/dynamic'
import type { LibraryLocation, Bounds } from './MapView'
import { addLibraryLocation } from '@/lib/actions/libraryLocations'
import { submitLocationReport } from '@/lib/actions/locationReports'
import '../home.css'
import './trail.css'

const MapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--sage)', color: 'var(--ink-faint)', fontWeight: 700 }}>
      Loading map…
    </div>
  ),
})

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
      <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 22s7-7.4 7-12.5A7 7 0 0 0 5 9.5C5 14.6 12 22 12 22z" /><circle cx="12" cy="9.5" r="2.4" fill="var(--sage)" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

// Generic image slot with a graceful fallback (the emoji + label already in
// TYPE_META) for illustrations that haven't been supplied yet — so the page
// reads as "not styled yet" rather than a broken-image icon.
function TrailImg({ src, alt, className, fallbackEmoji, fallbackLabel }: {
  src: string
  alt: string
  className?: string
  fallbackEmoji?: string
  fallbackLabel?: string
}) {
  const [broken, setBroken] = useState(false)
  if (broken) {
    return (
      <div className={`trail-img-fallback ${className ?? ''}`}>
        {fallbackEmoji && <span className="emoji">{fallbackEmoji}</span>}
        {fallbackLabel && <span className="txt">{fallbackLabel}</span>}
      </div>
    )
  }
  return <img src={src} alt={alt} className={className} onError={() => setBroken(true)} />
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180, Δλ = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

type GeocodeResult = { coords: [number, number]; street: string; city: string }

async function geocode(query: string): Promise<GeocodeResult | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' } }
    )
    const data = await res.json()
    const hit = data?.[0]
    if (!hit) return null
    const a = hit.address ?? {}
    const street = [a.house_number, a.road].filter(Boolean).join(' ')
    const cityName = a.city || a.town || a.village || a.hamlet || a.county || ''
    const city = [cityName, a.state].filter(Boolean).join(', ')
    return { coords: [parseFloat(hit.lat), parseFloat(hit.lon)], street, city }
  } catch {}
  return null
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

type LocType = 'lfl' | 'library' | 'bookstore' | 'fair'

const TYPE_META: Record<LocType, { emoji: string; label: string; icon: string }> = {
  lfl:       { emoji: '📚', label: 'Little Free Library', icon: '/home/trail-icon-lfl.png?v=2' },
  library:   { emoji: '🏛️', label: 'Public Library',      icon: '/home/trail-icon-library.png?v=2' },
  bookstore: { emoji: '📖', label: 'Book Store',           icon: '/home/trail-icon-bookstore.png?v=2' },
  fair:      { emoji: '🎪', label: 'Book Fair',            icon: '/home/trail-icon-fair.png?v=2' },
}

const TYPE_ORDER: LocType[] = ['lfl', 'library', 'bookstore', 'fair']

// Deep, text-legible shade per type — mirrors the same hex values used for
// data-type CSS rules in trail.css and for pins/badges in MapView.tsx, for
// the handful of spots (dates, distance) where inline color beats a CSS hook.
const TYPE_COLOR: Record<LocType, string> = {
  lfl: '#B5462F',
  library: '#234A40',
  bookstore: '#6E7B3E',
  fair: '#9C6B1F',
}

type FlyTo = { center: [number, number]; zoom: number; nonce: number }

export default function LocationsClient({ initialLocations, isLoggedIn }: {
  initialLocations: LibraryLocation[]
  isLoggedIn: boolean
}) {
  const [locations, setLocations] = useState<LibraryLocation[]>(initialLocations)
  const [userCoords, setUserCoords] = useState<[number, number] | null>(null)
  const [searchLabel, setSearchLabel] = useState('')   // human-readable "Near X" label
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null)
  const [search, setSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [checkedTypes, setCheckedTypes] = useState<Set<LocType>>(() => new Set(TYPE_ORDER))
  const [geoLoading, setGeoLoading] = useState(false)
  const [mapBounds, setMapBounds] = useState<Bounds | null>(null)

  // Add location state
  const [addMode, setAddMode] = useState(false)
  const [pendingPin, setPendingPin] = useState<[number, number] | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState({ name: '', type: 'lfl' as LocType, street: '', city: '', description: '', startDate: '', endDate: '' })
  const [formError, setFormError] = useState('')
  const [addressQuery, setAddressQuery] = useState('')
  const [addressSearching, setAddressSearching] = useState(false)

  // Report state
  const [reportTarget, setReportTarget] = useState<LibraryLocation | null>(null)
  const [reportReason, setReportReason] = useState('')
  const [reportSent, setReportSent] = useState(false)
  const [reportSending, setReportSending] = useState(false)
  const [reportError, setReportError] = useState('')

  const filteredLocations = useMemo(() => {
    let result = locations
    if (mapBounds) {
      const [[swLat, swLng], [neLat, neLng]] = mapBounds
      result = result.filter(l => l.lat >= swLat && l.lat <= neLat && l.lng >= swLng && l.lng <= neLng)
    }
    result = result.filter(l => checkedTypes.has(l.type))
    if (userCoords) {
      result = [...result].sort((a, b) =>
        haversine(userCoords[0], userCoords[1], a.lat, a.lng) -
        haversine(userCoords[0], userCoords[1], b.lat, b.lng)
      )
    }
    return result
  }, [locations, userCoords, mapBounds, checkedTypes])

  function toggleType(t: LocType) {
    setCheckedTypes(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  function applyLocation(coords: [number, number], label: string, zoom = 12) {
    setUserCoords(coords)
    setSearchLabel(label)
    setFlyTo({ center: coords, zoom, nonce: Date.now() })
  }

  function clearSearch() {
    setUserCoords(null)
    setSearchLabel('')
    setSearch('')
  }

  function useMyLocation() {
    if (!navigator.geolocation) return
    setGeoLoading(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude]
        applyLocation(coords, 'My Location')
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
    const result = await geocode(search)
    setSearching(false)
    if (result) applyLocation(result.coords, search.trim())
    else alert('Location not found. Try a city name or full address.')
  }

  function startAddMode() {
    if (!isLoggedIn) {
      window.location.href = '/auth/signin?redirect=/locations'
      return
    }
    setAddMode(true)
  }

  function handleMapClick(lat: number, lng: number) {
    setPendingPin([lat, lng])
    setShowAddForm(true)
  }

  async function locateByAddress(e: React.FormEvent) {
    e.preventDefault()
    if (!addressQuery.trim()) return
    setAddressSearching(true)
    const result = await geocode(addressQuery)
    setAddressSearching(false)
    if (result) {
      setPendingPin(result.coords)
      setForm(f => ({ ...f, street: result.street || f.street, city: result.city || f.city }))
      setShowAddForm(true)
      setAddressQuery('')
    } else {
      alert('Address not found. Try a more specific address or click the map instead.')
    }
  }

  function selectLocation(loc: LibraryLocation) {
    setFlyTo({ center: [loc.lat, loc.lng], zoom: 16, nonce: Date.now() })
  }

  function cancelAdd() {
    setAddMode(false); setPendingPin(null); setShowAddForm(false)
    setForm({ name: '', type: 'lfl', street: '', city: '', description: '', startDate: '', endDate: '' })
    setFormError('')
    setAddressQuery('')
  }

  async function saveLocation() {
    if (!pendingPin) return
    if (!form.name.trim())   { setFormError('Library name is required'); return }
    if (!form.street.trim()) { setFormError('Street is required'); return }
    if (!form.city.trim())   { setFormError('City is required'); return }
    if (form.type === 'fair') {
      if (!form.startDate) { setFormError('Start date is required for a fair'); return }
      if (!form.endDate)   { setFormError('End date is required for a fair'); return }
      if (form.endDate < form.startDate) { setFormError('End date must be on or after the start date'); return }
    }
    setFormError('')

    const result = await addLibraryLocation({
      name: form.name.trim(),
      type: form.type,
      lat: pendingPin[0],
      lng: pendingPin[1],
      street: form.street.trim(),
      city: form.city.trim(),
      description: form.description.trim(),
      startDate: form.type === 'fair' ? form.startDate : undefined,
      endDate: form.type === 'fair' ? form.endDate : undefined,
    })

    if (!result.ok) { setFormError(result.error); return }
    setLocations(prev => [...prev, result.location])
    cancelAdd()
  }

  function openReport(loc: LibraryLocation) {
    if (!isLoggedIn) {
      window.location.href = '/auth/signin?redirect=/locations'
      return
    }
    setReportError('')
    setReportTarget(loc)
  }

  async function sendReport() {
    if (!reportTarget) return
    setReportSending(true)
    const result = await submitLocationReport(reportTarget.id, reportReason)
    setReportSending(false)
    if (!result.ok) { setReportError(result.error); return }
    setReportSent(true)
    setTimeout(() => { setReportTarget(null); setReportReason(''); setReportSent(false) }, 2200)
  }

  return (
    <div className="home-v2 trail-page">
      {/* ── Hero: destination callout · title/search · decorative art ── */}
      <section className="trail-hero">
        <div className="wrap trail-hero-grid">
          <div className="trail-decor-left">
            <TrailImg
              src="/home/trail-decor-left.png?v=1"
              alt="Choose Your Destination"
              fallbackEmoji="🧭"
              fallbackLabel="Choose Your Destination"
            />
          </div>

          <div className="trail-hero-copy">
            <h1>Reading Trail Locations</h1>
            <p className="sub">Discover little libraries, book stores, public libraries, and book fairs near you.</p>

            <div className="trail-search-row">
              <form onSubmit={handleSearch} className="trail-search-bar">
                <SearchIcon />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="City or address…"
                />
                {(search || searchLabel) && (
                  <button type="button" onClick={clearSearch} className="trail-search-clear">×</button>
                )}
                <button type="submit" disabled={searching} className="trail-search-go">
                  {searching ? '…' : 'Go'}
                </button>
              </form>
              <button onClick={useMyLocation} disabled={geoLoading} className="trail-mylocation">
                <PinIcon />{geoLoading ? 'Locating…' : 'My Location'}
              </button>
            </div>
          </div>

          <div className="trail-decor-right">
            <TrailImg
              src="/home/trail-decor-right.png?v=1"
              alt=""
              fallbackEmoji="📚"
              fallbackLabel="Books & flowers"
            />
          </div>
        </div>

        {/* ── Type filter cards ── */}
        <div className="wrap">
          <div className="trail-type-cards">
            {TYPE_ORDER.map(t => {
              const meta = TYPE_META[t]
              const checked = checkedTypes.has(t)
              return (
                <button
                  key={t}
                  type="button"
                  data-type={t}
                  aria-pressed={checked}
                  className={`trail-type-card${checked ? ' active' : ''}`}
                  onClick={() => toggleType(t)}
                >
                  <span className="trail-type-icon">
                    <TrailImg src={meta.icon} alt="" fallbackEmoji={meta.emoji} />
                  </span>
                  <span className="trail-type-label">{meta.label}</span>
                  <span className="trail-type-arrow">{checked && <CheckIcon />}</span>
                </button>
              )
            })}
          </div>

          {/* Add Location button */}
          {addMode ? (
            <button onClick={cancelAdd} className="trail-add-cancel">✕ Cancel Adding Location</button>
          ) : (
            <button onClick={startAddMode} className="btn btn-primary trail-add-btn">+ Add a Location</button>
          )}

          {/* Active filter / search chips + count */}
          <div className="trail-meta-row">
            {searchLabel && (
              <span className="trail-meta-chip">
                Near {searchLabel}
                <span className="x" onClick={clearSearch}>×</span>
              </span>
            )}
            {!userCoords && <span>Search a city or use My Location to sort by distance</span>}
            <span className="trail-meta-count">
              {filteredLocations.length} location{filteredLocations.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Add mode hint */}
          {addMode && !pendingPin && (
            <div className="trail-addmode-hint">
              <span>Click anywhere on the map to drop your pin 📌</span>
              <span>or</span>
              <form onSubmit={locateByAddress}>
                <input
                  value={addressQuery}
                  onChange={e => setAddressQuery(e.target.value)}
                  placeholder="Enter an address…"
                />
                <button type="submit" disabled={addressSearching}>
                  {addressSearching ? '…' : 'Locate'}
                </button>
              </form>
            </div>
          )}
        </div>
      </section>

      {/* ── Main content: List LEFT · Map RIGHT ── */}
      <div className="wrap">
        <div className="trail-split">
          <div className="trail-list-col">
            {filteredLocations.length === 0 ? (
              <div className="trail-empty">
                <div className="big">📭</div>
                <p>No locations found</p>
                <p>Try a different type filter or clear the search</p>
              </div>
            ) : (
              filteredLocations.map(loc => (
                <TrailRow key={loc.id} loc={loc} userCoords={userCoords} onReport={openReport} onSelect={selectLocation} />
              ))
            )}
          </div>

          <div className="trail-map-col">
            <MapView
              locations={filteredLocations}
              pendingPin={pendingPin}
              flyTo={flyTo}
              addMode={addMode}
              onMapClick={handleMapClick}
              onReport={openReport}
              onBoundsChange={setMapBounds}
            />
          </div>
        </div>
      </div>

      {/* ── Add Location form modal ── */}
      {showAddForm && pendingPin && (
        <div className="trail-modal-overlay">
          <div className="trail-modal-card">
            <h2>Add a Location</h2>
            <p className="trail-modal-hint">
              📌 Pin at {pendingPin[0].toFixed(4)}°, {pendingPin[1].toFixed(4)}°
              <button onClick={() => { setPendingPin(null); setShowAddForm(false) }}>Move pin</button>
            </p>
            <FormField label="Library Name *">
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Corner Street LFL" className="trail-input" />
            </FormField>
            <FormField label="Type *">
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as LocType }))}
                className="trail-input">
                <option value="lfl">📚 Little Free Library</option>
                <option value="library">🏛️ Public Library</option>
                <option value="bookstore">📖 Book Store</option>
                <option value="fair">🎪 Library Fair</option>
              </select>
            </FormField>
            {form.type === 'fair' && (
              <>
                <FormField label="Start Date *">
                  <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                    className="trail-input" />
                </FormField>
                <FormField label="End Date *">
                  <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                    className="trail-input" />
                </FormField>
              </>
            )}
            <FormField label="Street *" hint="No exact address needed">
              <input value={form.street} onChange={e => setForm(f => ({ ...f, street: e.target.value }))}
                placeholder="e.g. Oak Street" className="trail-input" />
            </FormField>
            <FormField label="City *">
              <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                placeholder="e.g. Portland, OR" className="trail-input" />
            </FormField>
            <FormField label="Description" hint="optional">
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="e.g. Red barn shape, near the oak tree" className="trail-input" />
            </FormField>
            <p className="trail-modal-note">🔒 Exact addresses are not stored — the pin marks the spot.</p>
            {formError && <p className="trail-modal-error">⚠️ {formError}</p>}
            <div className="trail-modal-actions">
              <button onClick={cancelAdd} className="trail-modal-cancel">Cancel</button>
              <button onClick={saveLocation} className="btn btn-primary">Save Location</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Request to Move modal ── */}
      {reportTarget && (
        <div className="trail-modal-overlay">
          <div className="trail-modal-card">
            {reportSent ? (
              <div className="trail-report-success">
                <div className="big">✅</div>
                <h2>Request Sent!</h2>
                <p>Our team will review your request and update the map.</p>
              </div>
            ) : (
              <>
                <h2>Request Location Change</h2>
                <p className="trail-modal-hint">This will be sent to an admin for review.</p>
                <div className="trail-report-preview" data-type={reportTarget.type}>
                  <div className="name">{reportTarget.name}</div>
                  <div className="addr">{reportTarget.street}, {reportTarget.city}</div>
                  <div className="type">
                    {TYPE_META[reportTarget.type].emoji} {TYPE_META[reportTarget.type].label}
                  </div>
                </div>
                <FormField label="Reason for request *">
                  <textarea
                    value={reportReason}
                    onChange={e => setReportReason(e.target.value)}
                    placeholder="e.g. This library has moved / no longer exists / address is incorrect…"
                    rows={4}
                    className="trail-textarea"
                  />
                </FormField>
                <p className="trail-modal-note">📬 Our team reviews requests within 1–3 business days.</p>
                {reportError && <p className="trail-modal-error">⚠️ {reportError}</p>}
                <div className="trail-modal-actions">
                  <button onClick={() => { setReportTarget(null); setReportReason(''); setReportError('') }} className="trail-modal-cancel">Cancel</button>
                  <button onClick={sendReport} disabled={!reportReason.trim() || reportSending} className="btn btn-primary">
                    {reportSending ? 'Sending…' : 'Send Request'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="trail-field">
      <label>
        {label}{hint && <span className="hint">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

function TrailRow({ loc, userCoords, onReport, onSelect }: {
  loc: LibraryLocation
  userCoords: [number, number] | null
  onReport: (loc: LibraryLocation) => void
  onSelect: (loc: LibraryLocation) => void
}) {
  const dist = userCoords ? haversine(userCoords[0], userCoords[1], loc.lat, loc.lng) : null
  const meta = TYPE_META[loc.type]
  const color = TYPE_COLOR[loc.type]

  return (
    <div onClick={() => onSelect(loc)} className="trail-row" data-type={loc.type}>
      <div className="trail-row-type">
        <span className="trail-row-icon">
          <TrailImg src={meta.icon} alt="" fallbackEmoji={meta.emoji} />
        </span>
        <span className="trail-row-type-label">{meta.label}</span>
      </div>

      <div className="trail-row-body">
        <div className="trail-row-name">{loc.name}</div>
        <div className="trail-row-addr">{loc.street}, {loc.city}</div>
        {loc.type === 'fair' && loc.startDate && loc.endDate && (
          <div className="trail-row-dates" style={{ color }}>
            🗓️ {formatDate(loc.startDate)} – {formatDate(loc.endDate)}
          </div>
        )}
        {loc.description && <div className="trail-row-desc">{loc.description}</div>}
        {dist !== null && <div className="trail-row-dist">{dist.toFixed(1)} mi away</div>}
      </div>

      <div className="trail-row-actions">
        <a href={`https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`}
          target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
          className="trail-row-directions">
          Directions ↗
        </a>
        <button onClick={e => { e.stopPropagation(); onReport(loc) }} className="trail-row-report">
          🚩 Report
        </button>
      </div>
    </div>
  )
}
