import '@testing-library/jest-dom'

// Set a test Mapbox token for test environment so the AddressAutofill mock is used
if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN = 'pk.test'
}
