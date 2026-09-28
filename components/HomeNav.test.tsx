import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import HomeNav from './HomeNav'

let pathname = '/'
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}))

function tabBar() {
  return within(screen.getByRole('navigation', { name: 'Tabs' }))
}

function tabHrefs() {
  return tabBar().getAllByRole('link').map(a => [a.textContent, a.getAttribute('href')])
}

describe('HomeNav mobile tab bar', () => {
  beforeEach(() => { pathname = '/' })

  it('signed in: Browse, Post, Trail, Dashboard', () => {
    render(<HomeNav userName="SeanB" />)
    expect(tabHrefs()).toEqual([
      ['Browse', '/listings'],
      ['Post', '/post'],
      ['Trail', '/locations'],
      ['Dashboard', '/profile'],
    ])
  })

  it('signed out: Browse, Post, Trail, Sign In', () => {
    render(<HomeNav userName={null} />)
    expect(tabHrefs()).toEqual([
      ['Browse', '/listings'],
      ['Post', '/post'],
      ['Trail', '/locations'],
      ['Sign In', '/auth/signin'],
    ])
  })

  it("marks the current section's tab, including a listing's detail page", () => {
    pathname = '/listings/abc-123'
    render(<HomeNav userName="SeanB" />)
    expect(tabBar().getByRole('link', { name: 'Browse' })).toHaveAttribute('aria-current', 'page')
    expect(tabBar().getByRole('link', { name: 'Post' })).not.toHaveAttribute('aria-current')
  })

  it('shows the unread count on the Dashboard tab', () => {
    render(<HomeNav userName="SeanB" unreadCount={3} />)
    const dash = tabBar().getByRole('link', { name: /Dashboard/ })
    expect(within(dash).getByText('3')).toBeInTheDocument()
  })

  it('no longer has a hamburger menu', () => {
    render(<HomeNav userName="SeanB" />)
    expect(screen.queryByRole('button', { name: /menu/i })).toBeNull()
  })
})
