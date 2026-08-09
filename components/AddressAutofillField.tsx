'use client'

import { useState } from 'react'
import { AddressAutofill } from '@mapbox/search-js-react'
import StateSelect from '@/components/StateSelect'
import { resolveStateCode } from '@/lib/usStates'

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

  function handleRetrieve(res: AddressAutofillRetrieveResponse) {
    const props = res.features?.[0]?.properties
    if (props?.address_level2) setCity(props.address_level2)
    if (props?.address_level1) {
      const code = resolveStateCode(props.address_level1)
      if (code) setState(code)
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
