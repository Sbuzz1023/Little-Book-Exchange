import { render, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import SaveButton from './SaveButton'
import { saveListing, unsaveListing } from '@/lib/actions/savedListings'

vi.mock('@/lib/actions/savedListings', () => ({
  saveListing: vi.fn(() => Promise.resolve()),
  unsaveListing: vi.fn(() => Promise.resolve()),
}))

describe('SaveButton', () => {
  const originalLocation = window.location

  beforeEach(() => {
    vi.clearAllMocks()
    // @ts-expect-error - deliberately replacing window.location for the test
    delete window.location
    // @ts-expect-error - minimal stand-in, only href/pathname are used
    window.location = { ...originalLocation, href: '', pathname: '/listings/abc-123' }
  })

  afterEach(() => {
    // @ts-expect-error - restoring the real Location object after the test stand-in
    window.location = originalLocation
  })

  it('starts on "Save" when initialSaved is false', () => {
    const { getByRole } = render(<SaveButton listingId="abc-123" isLoggedIn={true} initialSaved={false} />)
    expect(getByRole('button')).toHaveTextContent('Save')
  })

  it('starts on "Saved" when initialSaved is true', () => {
    const { getByRole } = render(<SaveButton listingId="abc-123" isLoggedIn={true} initialSaved={true} />)
    expect(getByRole('button')).toHaveTextContent('Saved ✓')
  })

  it('calls saveListing and flips to "Saved" when clicked while unsaved and logged in', () => {
    const { getByRole } = render(<SaveButton listingId="abc-123" isLoggedIn={true} initialSaved={false} />)
    const button = getByRole('button')
    fireEvent.click(button)
    expect(button).toHaveTextContent('Saved ✓')
    expect(saveListing).toHaveBeenCalledWith('abc-123', '/listings/abc-123')
    expect(unsaveListing).not.toHaveBeenCalled()
  })

  it('calls unsaveListing and flips to "Save" when clicked while saved and logged in', () => {
    const { getByRole } = render(<SaveButton listingId="abc-123" isLoggedIn={true} initialSaved={true} />)
    const button = getByRole('button')
    fireEvent.click(button)
    expect(button).toHaveTextContent('Save')
    expect(button).not.toHaveTextContent('Saved ✓')
    expect(unsaveListing).toHaveBeenCalledWith('abc-123', '/listings/abc-123')
    expect(saveListing).not.toHaveBeenCalled()
  })

  it('reverts the optimistic flip if the save call fails', async () => {
    vi.mocked(saveListing).mockRejectedValueOnce(new Error('boom'))
    const { getByRole } = render(<SaveButton listingId="abc-123" isLoggedIn={true} initialSaved={false} />)
    const button = getByRole('button')
    fireEvent.click(button)
    expect(button).toHaveTextContent('Saved ✓')
    await waitFor(() => expect(button).toHaveTextContent('Save'))
    expect(button).not.toHaveTextContent('Saved ✓')
  })

  it('does not call saveListing/unsaveListing when clicked while logged out', () => {
    const { getByRole } = render(<SaveButton listingId="abc-123" isLoggedIn={false} initialSaved={false} />)
    fireEvent.click(getByRole('button'))
    expect(saveListing).not.toHaveBeenCalled()
    expect(unsaveListing).not.toHaveBeenCalled()
  })

  it('redirects to sign-in with the current path when clicked while logged out', () => {
    const { getByRole } = render(<SaveButton listingId="abc-123" isLoggedIn={false} initialSaved={false} />)
    fireEvent.click(getByRole('button'))
    expect(window.location.href).toBe('/auth/signin?redirect=/listings/abc-123')
  })
})
