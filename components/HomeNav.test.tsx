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

describe('HomeNav credit balance', () => {
  beforeEach(() => { pathname = '/' })

  it('shows the signed-in balance next to the avatar, linking to the Wallet', () => {
    render(<HomeNav userName="SeanB" credits={12} />)
    const pill = screen.getByRole('link', { name: '12 credits' })
    expect(pill).toHaveAttribute('href', '/profile?tab=wallet')
    expect(pill).toHaveTextContent('12')
    // sits immediately before the avatar menu
    expect(pill.nextElementSibling).toHaveClass('hnav-avatar-menu')
  })

  it('says "1 credit" for a single credit', () => {
    render(<HomeNav userName="SeanB" credits={1} />)
    expect(screen.getByRole('link', { name: '1 credit' })).toBeInTheDocument()
  })

  it('shows 0 credits rather than hiding the balance', () => {
    render(<HomeNav userName="SeanB" credits={0} />)
    expect(screen.getByRole('link', { name: '0 credits' })).toBeInTheDocument()
  })

  it('is hidden when signed out', () => {
    render(<HomeNav userName={null} credits={5} />)
    expect(screen.queryByRole('link', { name: /credits?$/ })).toBeNull()
  })

  it('is hidden when the balance is unknown', () => {
    render(<HomeNav userName="SeanB" />)
    expect(screen.queryByRole('link', { name: /credits?$/ })).toBeNull()
  })
})
