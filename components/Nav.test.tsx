import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Nav from './Nav'

vi.mock('next/navigation', () => ({
  usePathname: () => '/profile',
}))

describe('Nav', () => {
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
