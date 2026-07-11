import { render, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import HeartButton from './HeartButton'
import { saveListing, unsaveListing } from '@/lib/actions/savedListings'

vi.mock('@/lib/actions/savedListings', () => ({
  saveListing: vi.fn(() => Promise.resolve()),
  unsaveListing: vi.fn(() => Promise.resolve()),
}))

describe('HeartButton', () => {
  const originalLocation = window.location

  beforeEach(() => {
    vi.clearAllMocks()
    // @ts-expect-error - deliberately replacing window.location for the test
    delete window.location
    // @ts-expect-error - minimal stand-in, only href/pathname are used
    window.location = { ...originalLocation, href: '', pathname: '/listings' }
  })

  afterEach(() => {
    // @ts-expect-error - restoring the real Location object after the test stand-in
    window.location = originalLocation
  })

  it('starts unsaved when initialSaved is false', () => {
    const { container } = render(<HeartButton listingId="l1" isLoggedIn={true} initialSaved={false} />)
    const button = container.querySelector('button') as HTMLButtonElement
    expect(button.style.background).toBe('rgba(255, 255, 255, 0.92)')
  })

  it('starts saved when initialSaved is true', () => {
    const { container } = render(<HeartButton listingId="l1" isLoggedIn={true} initialSaved={true} />)
    const button = container.querySelector('button') as HTMLButtonElement
    expect(button.style.background).toBe('rgb(255, 240, 243)')
  })

  it('calls saveListing and flips to saved style when clicked while unsaved and logged in', () => {
    const { container } = render(<HeartButton listingId="l1" isLoggedIn={true} initialSaved={false} />)
    const button = container.querySelector('button') as HTMLButtonElement
    fireEvent.click(button)
    expect(button.style.background).toBe('rgb(255, 240, 243)')
    expect(saveListing).toHaveBeenCalledWith('l1', '/listings')
    expect(unsaveListing).not.toHaveBeenCalled()
  })

  it('calls unsaveListing and flips to unsaved style when clicked while saved and logged in', () => {
    const { container } = render(<HeartButton listingId="l1" isLoggedIn={true} initialSaved={true} />)
    const button = container.querySelector('button') as HTMLButtonElement
    fireEvent.click(button)
    expect(button.style.background).toBe('rgba(255, 255, 255, 0.92)')
    expect(unsaveListing).toHaveBeenCalledWith('l1', '/listings')
    expect(saveListing).not.toHaveBeenCalled()
  })

  it('reverts the optimistic flip if the save call fails', async () => {
    vi.mocked(saveListing).mockRejectedValueOnce(new Error('boom'))
    const { container } = render(<HeartButton listingId="l1" isLoggedIn={true} initialSaved={false} />)
    const button = container.querySelector('button') as HTMLButtonElement
    fireEvent.click(button)
    expect(button.style.background).toBe('rgb(255, 240, 243)')
    await waitFor(() => expect(button.style.background).toBe('rgba(255, 255, 255, 0.92)'))
  })

  it('does not call saveListing/unsaveListing when clicked while logged out', () => {
    const { container } = render(<HeartButton listingId="l1" isLoggedIn={false} initialSaved={false} />)
    fireEvent.click(container.querySelector('button')!)
    expect(saveListing).not.toHaveBeenCalled()
    expect(unsaveListing).not.toHaveBeenCalled()
  })

  it('redirects to sign-in with the current path when clicked while logged out', () => {
    const { container } = render(<HeartButton listingId="l1" isLoggedIn={false} initialSaved={false} />)
    fireEvent.click(container.querySelector('button')!)
    expect(window.location.href).toBe('/auth/signin?redirect=/listings')
  })
})
