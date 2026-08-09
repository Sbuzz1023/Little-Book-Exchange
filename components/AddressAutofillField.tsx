'use client'

import { useState } from 'react'
import { AddressAutofill } from '@mapbox/search-js-react'
import StateSelect from '@/components/StateSelect'

// Mapbox's Address Autofill onRetrieve payload is a GeoJSON FeatureCollection.
// Only the fields this component reads are typed here — see
// https://docs.mapbox.com/api/search/geocoding/ for the full response shape.
type AddressAutofillRetrieveResponse = {
  features: {
    properties?: {
      context?: {
        place?: { name?: string }
        region?: { region_code?: string }
        postcode?: { name?: string }
      }
      coordinates?: { latitude?: number; longitude?: number }
    }
  }[]
}

type Props = {
  defaultAddress?: string
  defaultCity?: string
  defaultState?: string
  defaultZip?: string
  defaultLat?: number | null
  defaultLng?: number | null
  inputClassName: string
  inputStyle: React.CSSProperties
  labelStyle: React.CSSProperties
  requiredMark?: React.ReactNode
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''

export default function AddressAutofillField({
  defaultAddress = '',
  defaultCity = '',
  defaultState = '',
  defaultZip = '',
  defaultLat = null,
  defaultLng = null,
  inputClassName,
  inputStyle,
  labelStyle,
  requiredMark,
}: Props) {
  const [city, setCity] = useState(defaultCity)
  const [state, setState] = useState(defaultState)
  const [zip, setZip] = useState(defaultZip)
  // Round-trip previously-saved coordinates as hidden fields so an unrelated
  // profile edit (one that doesn't touch the address) doesn't wipe them.
  // They're only replaced when the user picks a new suggestion below — a
  // manual text edit to the street address leaves them as whatever was last
  // picked, a deliberate, low-stakes trade-off (see the design spec's "Out
  // of scope").
  const [lat, setLat] = useState(defaultLat != null ? String(defaultLat) : '')
  const [lng, setLng] = useState(defaultLng != null ? String(defaultLng) : '')

  function handleRetrieve(res: AddressAutofillRetrieveResponse) {
    const context = res.features?.[0]?.properties?.context
    if (context?.place?.name) setCity(context.place.name)
    if (context?.region?.region_code) setState(context.region.region_code)
    if (context?.postcode?.name) setZip(context.postcode.name)
    const coords = res.features?.[0]?.properties?.coordinates
    if (typeof coords?.latitude === 'number') setLat(String(coords.latitude))
    if (typeof coords?.longitude === 'number') setLng(String(coords.longitude))
  }

  const addressInput = (
    <input
      name="address"
      type="text"
      placeholder="e.g. 123 Main St"
      defaultValue={defaultAddress}
      autoComplete="address-line1"
      className={inputClassName}
      style={inputStyle}
    />
  )

  return (
    <>
      <input type="hidden" name="lat" value={lat} />
      <input type="hidden" name="lng" value={lng} />

      <div>
        <label className="block mb-1.5" style={labelStyle}>Street Address</label>
        {MAPBOX_TOKEN ? (
          <AddressAutofill accessToken={MAPBOX_TOKEN} options={{ country: 'us' }} onRetrieve={handleRetrieve}>
            {addressInput}
          </AddressAutofill>
        ) : addressInput}
      </div>

      <div>
        <label className="block mb-1.5" style={labelStyle}>City{requiredMark}</label>
        <input
          name="city"
          type="text"
          placeholder="e.g. Chicago"
          value={city}
          onChange={e => setCity(e.target.value)}
          required
          autoComplete="address-level2"
          className={inputClassName}
          style={inputStyle}
        />
      </div>

      <div>
        <label className="block mb-1.5" style={labelStyle}>State{requiredMark}</label>
        <StateSelect
          key={state}
          name="state"
          defaultValue={state}
          required
          placeholder="Select a state"
          className={inputClassName}
          style={inputStyle}
        />
      </div>

      <div>
        <label className="block mb-1.5" style={labelStyle}>Zip Code</label>
        <input
          name="zip"
          type="text"
          placeholder="e.g. 60614"
          value={zip}
          onChange={e => setZip(e.target.value)}
          autoComplete="postal-code"
          className={inputClassName}
          style={inputStyle}
        />
      </div>
    </>
  )
}
