import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import AddressAutofillField from './AddressAutofillField'

// Stub out Mapbox's real <AddressAutofill> (a web component wrapper that
// would otherwise try to reach the network in jsdom). The stub renders the
// wrapped input as-is and exposes a button to simulate picking a suggestion,
// calling the real onRetrieve prop with a representative Mapbox response.
vi.mock('@mapbox/search-js-react', () => ({
  AddressAutofill: ({ children, onRetrieve }: any) => (
    <div>
      {children}
      <button type="button" onClick={() => onRetrieve(SAMPLE_RETRIEVE_RESPONSE)}>
        simulate retrieve
      </button>
    </div>
  ),
}))

const SAMPLE_RETRIEVE_RESPONSE = {
  features: [
    {
      properties: {
        context: {
          place: { name: 'Chicago' },
          region: { region_code: 'IL' },
          postcode: { name: '60614' },
        },
        coordinates: { latitude: 41.9, longitude: -87.6 },
      },
    },
  ],
}

const inputClassName = 'test-input'
const inputStyle = {}
const labelStyle = {}

describe('AddressAutofillField', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('renders plain editable fields seeded with the given defaults', () => {
    render(
      <AddressAutofillField
        defaultAddress="123 Main St"
        defaultCity="Springfield"
        defaultState="IL"
        defaultZip="62704"
        inputClassName={inputClassName}
        inputStyle={inputStyle}
        labelStyle={labelStyle}
      />
    )
    expect(screen.getByPlaceholderText('e.g. 123 Main St')).toHaveValue('123 Main St')
    expect(screen.getByPlaceholderText('e.g. Chicago')).toHaveValue('Springfield')
    expect(screen.getByPlaceholderText('e.g. 60614')).toHaveValue('62704')
  })

  it('preserves previously-saved coordinates in hidden fields until a new suggestion is picked', () => {
    vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'pk.test')
    const { container } = render(
      <AddressAutofillField
        defaultLat={41.5}
        defaultLng={-88.1}
        inputClassName={inputClassName}
        inputStyle={inputStyle}
        labelStyle={labelStyle}
      />
    )
    expect(container.querySelector('input[name="lat"]')).toHaveValue('41.5')
    expect(container.querySelector('input[name="lng"]')).toHaveValue('-88.1')
  })

  it('picking a suggestion fills city, state, zip, and hidden lat/lng', () => {
    vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'pk.test')
    const { container } = render(
      <AddressAutofillField
        inputClassName={inputClassName}
        inputStyle={inputStyle}
        labelStyle={labelStyle}
      />
    )
    fireEvent.click(screen.getByText('simulate retrieve'))

    expect(screen.getByPlaceholderText('e.g. Chicago')).toHaveValue('Chicago')
    expect(container.querySelector('select[name="state"]')).toHaveValue('IL')
    expect(screen.getByPlaceholderText('e.g. 60614')).toHaveValue('60614')
    expect(container.querySelector('input[name="lat"]')).toHaveValue('41.9')
    expect(container.querySelector('input[name="lng"]')).toHaveValue('-87.6')
  })

  it('renders plain input without Mapbox wrapper when no token is available', () => {
    vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', '')
    render(
      <AddressAutofillField
        inputClassName={inputClassName}
        inputStyle={inputStyle}
        labelStyle={labelStyle}
      />
    )
    // The mocked AddressAutofill renders a "simulate retrieve" button only when token is present
    expect(screen.queryByText('simulate retrieve')).not.toBeInTheDocument()
    // But the plain input should still be present and typable
    const addressInput = screen.getByPlaceholderText('e.g. 123 Main St') as HTMLInputElement
    expect(addressInput).toBeInTheDocument()
    expect(addressInput.value).toBe('')
  })
})
