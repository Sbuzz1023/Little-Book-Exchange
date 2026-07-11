import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import HeartButton from './HeartButton'

describe('HeartButton', () => {
  const originalLocation = window.location

  beforeEach(() => {
    // @ts-expect-error - deliberately replacing window.location for the test
    delete window.location
    // @ts-expect-error - minimal stand-in, only href/pathname are used
    window.location = { ...originalLocation, href: '', pathname: '/listings' }
  })

  afterEach(() => {
    // @ts-expect-error - restoring the real Location object after the test stand-in
    window.location = originalLocation
  })

  it('toggles saved style when clicked while logged in', () => {
    const { container } = render(<HeartButton isLoggedIn={true} />)
    const button = container.querySelector('button') as HTMLButtonElement
    expect(button.style.background).toBe('rgba(255, 255, 255, 0.92)')
    fireEvent.click(button)
    expect(button.style.background).toBe('rgb(255, 240, 243)')
  })

  it('does not navigate when clicked while logged in', () => {
    const { container } = render(<HeartButton isLoggedIn={true} />)
    fireEvent.click(container.querySelector('button')!)
    expect(window.location.href).toBe('')
  })

  it('redirects to sign-in with the current path when clicked while logged out', () => {
    const { container } = render(<HeartButton isLoggedIn={false} />)
    fireEvent.click(container.querySelector('button')!)
    expect(window.location.href).toBe('/auth/signin?redirect=/listings')
  })

  it('does not toggle saved style when clicked while logged out', () => {
    const { container } = render(<HeartButton isLoggedIn={false} />)
    const button = container.querySelector('button') as HTMLButtonElement
    fireEvent.click(button)
    expect(button.style.background).toBe('rgba(255, 255, 255, 0.92)')
  })
})
