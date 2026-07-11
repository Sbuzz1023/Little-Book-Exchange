import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import SaveButton from './SaveButton'

describe('SaveButton', () => {
  const originalLocation = window.location

  beforeEach(() => {
    // @ts-expect-error - deliberately replacing window.location for the test
    delete window.location
    // @ts-expect-error - minimal stand-in, only href/pathname are used
    window.location = { ...originalLocation, href: '', pathname: '/listings/abc-123' }
  })

  afterEach(() => {
    // @ts-expect-error - restoring the real Location object after the test stand-in
    window.location = originalLocation
  })

  it('toggles to "Saved" when clicked while logged in', () => {
    const { getByRole } = render(<SaveButton listingId="abc-123" isLoggedIn={true} />)
    const button = getByRole('button')
    expect(button).toHaveTextContent('Save')
    fireEvent.click(button)
    expect(button).toHaveTextContent('Saved ✓')
  })

  it('does not navigate when clicked while logged in', () => {
    const { getByRole } = render(<SaveButton listingId="abc-123" isLoggedIn={true} />)
    fireEvent.click(getByRole('button'))
    expect(window.location.href).toBe('')
  })

  it('redirects to sign-in with the current path when clicked while logged out', () => {
    const { getByRole } = render(<SaveButton listingId="abc-123" isLoggedIn={false} />)
    fireEvent.click(getByRole('button'))
    expect(window.location.href).toBe('/auth/signin?redirect=/listings/abc-123')
  })

  it('does not toggle to "Saved" when clicked while logged out', () => {
    const { getByRole } = render(<SaveButton listingId="abc-123" isLoggedIn={false} />)
    const button = getByRole('button')
    fireEvent.click(button)
    expect(button).toHaveTextContent('Save')
    expect(button).not.toHaveTextContent('Saved ✓')
  })
})
