import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Nav from './Nav'

vi.mock('next/navigation', () => ({
  usePathname: () => '/profile',
}))

function openMobileMenu() {
  fireEvent.click(screen.getByLabelText('Menu'))
  return within(screen.getByTestId('mobile-menu'))
}

describe('Nav', () => {
  it('shows an Admin Panel link in the mobile menu when isAdmin is true', () => {
    render(<Nav userName="Alice" isAdmin />)
    const mobileMenu = openMobileMenu()
    expect(mobileMenu.getByRole('link', { name: /Admin Panel/i })).toHaveAttribute('href', '/admin')
  })

  it('does not show an Admin Panel link in the mobile menu when isAdmin is false', () => {
    render(<Nav userName="Alice" isAdmin={false} />)
    const mobileMenu = openMobileMenu()
    expect(mobileMenu.queryByRole('link', { name: /Admin Panel/i })).not.toBeInTheDocument()
  })

  it('does not show an Admin Panel link in the mobile menu when isAdmin is omitted', () => {
    render(<Nav userName="Alice" />)
    const mobileMenu = openMobileMenu()
    expect(mobileMenu.queryByRole('link', { name: /Admin Panel/i })).not.toBeInTheDocument()
  })

  it('does not show a badge on Dashboard when unreadCount is 0', () => {
    render(<Nav userName="Alice" unreadCount={0} />)
    expect(screen.queryByTestId('dashboard-badge')).not.toBeInTheDocument()
  })

  it('does not show a badge on Dashboard when unreadCount is omitted', () => {
    render(<Nav userName="Alice" />)
    expect(screen.queryByTestId('dashboard-badge')).not.toBeInTheDocument()
  })

  it('shows the unread count on the Dashboard badge', () => {
    render(<Nav userName="Alice" unreadCount={3} />)
    expect(screen.getByTestId('dashboard-badge')).toHaveTextContent('3')
  })

  it('caps the displayed badge at "99+"', () => {
    render(<Nav userName="Alice" unreadCount={140} />)
    expect(screen.getByTestId('dashboard-badge')).toHaveTextContent('99+')
  })

  it('does not show a badge when signed out, even with a nonzero count', () => {
    render(<Nav userName={null} unreadCount={3} />)
    expect(screen.queryByTestId('dashboard-badge')).not.toBeInTheDocument()
  })
})
