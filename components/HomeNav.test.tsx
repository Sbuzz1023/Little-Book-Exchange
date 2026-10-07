import { render, screen, within, fireEvent } from '@testing-library/react'
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

import type { UnseenCredit } from '@/lib/creditShow'

vi.mock('@/lib/actions/creditsSeen', () => ({ markCreditsSeen: vi.fn(() => Promise.resolve()) }))

describe('HomeNav credit coin show', () => {
  beforeEach(() => {
    pathname = '/'
    // Motion path (jsdom has no Web Animations, so coins run on timers): the
    // pill only changes when a coin lands ~1.5s in, so a synchronous
    // assertion sees the starting balance. (With reduced motion the first
    // burst's balance step is immediate.)
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia
  })

  // Started shows are remembered (per seenUpTo) for the whole page session,
  // so every test gets its own timestamp.
  let tick = 0
  let sale: UnseenCredit
  beforeEach(() => {
    tick++
    sale = { id: 's', amount: 1, reason: 'sale_earned', created_at: `2026-10-06T10:00:${String(tick).padStart(2, '0')}Z`, title: 'Dune' }
  })

  it('shows the starting balance on first render while a show is pending', () => {
    render(<HomeNav userName="SeanB" credits={4} unseenCredits={[sale]} />)
    expect(screen.getByRole('link', { name: '3 credits' })).toBeInTheDocument()
  })

  it('mounts the show only when there are unseen credits', () => {
    const { container, rerender } = render(<HomeNav userName="SeanB" credits={4} />)
    expect(container.ownerDocument.querySelector('.ccs')).toBeNull()
    rerender(<HomeNav userName="SeanB" credits={4} unseenCredits={[sale]} />)
    expect(container.ownerDocument.querySelector('.ccs')).not.toBeNull()
  })

  it('no balance means no pill and no show, without crashing', () => {
    const { container } = render(<HomeNav userName="SeanB" credits={null} unseenCredits={[sale]} />)
    expect(container.ownerDocument.querySelector('.ccs')).toBeNull()
    expect(screen.queryByRole('link', { name: /credits?$/ })).toBeNull()
  })

  it('signed out never shows it', () => {
    const { container } = render(<HomeNav userName={null} credits={4} unseenCredits={[sale]} />)
    expect(container.ownerDocument.querySelector('.ccs')).toBeNull()
  })

  it('a re-render with an identical (new) rows array mid-show does not restart or remount it', () => {
    const { container, rerender } = render(<HomeNav userName="SeanB" credits={4} unseenCredits={[sale]} />)
    const overlay = container.ownerDocument.querySelector('.ccs')
    rerender(<HomeNav userName="SeanB" credits={4} unseenCredits={[{ ...sale }]} />)
    expect(container.ownerDocument.querySelector('.ccs')).toBe(overlay)
    expect(screen.getByRole('link', { name: '3 credits' })).toBeInTheDocument()
  })

  it('after the show is skipped the pill shows the real balance and the overlay is gone, and the same rows do not restart it', () => {
    const { container, rerender } = render(<HomeNav userName="SeanB" credits={4} unseenCredits={[sale]} />)
    fireEvent.click(container.ownerDocument.querySelector('.ccs')!)
    expect(screen.getByRole('link', { name: '4 credits' })).toBeInTheDocument()
    expect(container.ownerDocument.querySelector('.ccs')).toBeNull()
    rerender(<HomeNav userName="SeanB" credits={4} unseenCredits={[{ ...sale }]} />)
    expect(container.ownerDocument.querySelector('.ccs')).toBeNull()
  })

  it('does not replay after the nav is swapped out and back (a classic-nav page in between)', () => {
    const first = render(<HomeNav userName="SeanB" credits={4} unseenCredits={[sale]} />)
    fireEvent.click(first.container.ownerDocument.querySelector('.ccs')!)
    first.unmount()
    const again = render(<HomeNav userName="SeanB" credits={4} unseenCredits={[sale]} />)
    expect(again.container.ownerDocument.querySelector('.ccs')).toBeNull()
    expect(screen.getByRole('link', { name: '4 credits' })).toBeInTheDocument()
  })

  it('does not replay a show that was left mid-way (it was already marked seen when it started)', () => {
    const first = render(<HomeNav userName="SeanB" credits={4} unseenCredits={[sale]} />)
    first.unmount()
    const again = render(<HomeNav userName="SeanB" credits={4} unseenCredits={[sale]} />)
    expect(again.container.ownerDocument.querySelector('.ccs')).toBeNull()
  })
})
