'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import StateSelect from '@/components/StateSelect'
import { resolveStateCode } from '@/lib/usStates'

// @mapbox/search-js-react's AddressAutofill executes browser-only code
// (customElements.define or similar) at module-import time, which crashes
// Next.js's SSR pass for this 'use client' component with "document is not
// defined" — 'use client' components are still server-rendered for their
// initial HTML, so a static top-level import still gets evaluated on the
// server. Loading it via next/dynamic with ssr:false defers the actual
// import() to the browser only, matching the identical fix this codebase
// already uses for react-leaflet in app/locations/LocationsClient.tsx, for
// the same underlying reason. Only this piece is skipped during SSR — the
// rest of the form (City/State/Zip, and the plain fallback input below)
// still renders on the server normally.
const AddressAutofill = dynamic(
  () => import('@mapbox/search-js-react').then(mod => mod.AddressAutofill),
  { ssr: false }
)

// Mapbox's Address Autofill `retrieve()` payload is a GeoJSON FeatureCollection
// of AddressAutofillFeatureSuggestion (see @mapbox/search-js-core's
// dist/autofill/types.d.ts) — a flat, WHATWG-Autocomplete-shaped `properties`
// object, not the nested `context.*` shape the standalone Geocoding/Search
// Box APIs use. Only the fields this component reads are typed here.
//
// Coordinates are deliberately NOT read here: AddressAutofillCore.retrieve()'s
// own JSDoc states its coordinates "should be used ephemerally and not
// persisted" per the Mapbox Terms of Service — a different license than the
// address text fields below, which Autofill is explicitly built to let you
// store. See the design spec's Addendum for what a compliant coordinate
// source would require.
type AddressAutofillRetrieveResponse = {
  features: {
    properties?: {
      address_level2?: string // city
      address_level1?: string // state — may be a full name or a code; resolved via resolveStateCode
      postcode?: string
    }
  }[]
}

type Props = {
  defaultAddress?: string
  defaultCity?: string
  defaultState?: string
  defaultZip?: string
  inputClassName: string
  inputStyle: React.CSSProperties
  labelStyle: React.CSSProperties
  requiredMark?: React.ReactNode
}

export default function AddressAutofillField({
  defaultAddress = '',
  defaultCity = '',
  defaultState = '',
  defaultZip = '',
  inputClassName,
  inputStyle,
  labelStyle,
  requiredMark,
}: Props) {
  const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''
  const [city, setCity] = useState(defaultCity)
  const [state, setState] = useState(defaultState)
  const [zip, setZip] = useState(defaultZip)
  const [stateKey, setStateKey] = useState(0)
  // The plain input must render identically on the server and on the
  // client's first paint (mounted=false in both) to avoid a hydration
  // mismatch. Only after useEffect fires post-hydration does this flip to
  // true, swapping in the Mapbox-enhanced version — progressive
  // enhancement, same spirit as the no-token fallback below. This also
  // fixes a real bug: since AddressAutofill is a next/dynamic(ssr:false)
  // bailout boundary and addressInput is passed as its children, gating on
  // MAPBOX_TOKEN alone made the whole subtree — including the required
  // Street Address input — absent from the initial SSR HTML.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  function handleRetrieve(res: AddressAutofillRetrieveResponse) {
    const props = res.features?.[0]?.properties
    if (props?.address_level2) setCity(props.address_level2)
    if (props?.address_level1) {
      const code = resolveStateCode(props.address_level1)
      if (code) {
        setState(code)
        setStateKey(k => k + 1)
      }
    }
    if (props?.postcode) setZip(props.postcode)
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
      <div>
        <label className="block mb-1.5" style={labelStyle}>Street Address</label>
        {mounted && MAPBOX_TOKEN ? (
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
          key={stateKey}
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
