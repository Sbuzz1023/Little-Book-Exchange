import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DashboardClient from './DashboardClient'
import { createClient } from '@/lib/supabase/client'

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}))

const baseProps = {
  profile: { id: 'me', username: 'me', city: 'Chicago', state: 'IL' },
  listings: [],
  savedListings: [],
  tbrEntries: [
    { id: 'tbr-1', title: 'Dune', author: '', city: '', state: '', match: { id: 'listing-1', title: 'Dune' } },
  ],
  updateAction: vi.fn(() => Promise.resolve()),
  updateListingStatus: vi.fn(() => Promise.resolve()),
  completeExchange: vi.fn(() => Promise.resolve()),
  hideExchangeHistory: vi.fn(() => Promise.resolve()),
  submitReview: vi.fn(() => Promise.resolve({ ok: true })),
  confirmExchange: vi.fn(() => Promise.resolve()),
  cancelPurchase: vi.fn(() => Promise.resolve()),
  denyPurchase: vi.fn(() => Promise.resolve()),
  removeSavedListing: vi.fn(() => Promise.resolve()),
  addTbrEntry: vi.fn(() => Promise.resolve()),
  removeTbrEntry: vi.fn(() => Promise.resolve()),
  isDemo: false,
  unreadCounts: { total: 2, exchanges: 1, tbr: 1, messages: 0 },
  unreadEntityIds: { message: [] as string[], decisionOrPickup: [] as string[], tbrMatch: ['tbr-1'] },
}

const pendingExchange = {
  id: 'convo-1', listing_id: 'listing-1', buyer_id: 'them', seller_id: 'me',
  created_at: '2026-07-14T00:00:00.000Z',
  exchange_status: 'requested' as const, completed_at: null, buyer_hidden: false, seller_hidden: false,
  sellerRating: null, reviewed: false,
  listings: { title: 'Dune', author: 'Frank Herbert' },
  buyer: { name: 'Neighbor' }, seller: { name: 'Me' },
  messages: [],
}

describe('DashboardClient — notification badges and highlighting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the tbr unread count as a badge on the TBR tab', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} defaultTab="tbr" />)
    // Note: screen.getByText('To Be Read') is ambiguous here — the active-tab section
    // heading (<h2>) also renders the exact text "To Be Read" when the TBR tab is active,
    // independent of this task's changes. getByRole disambiguates to just the tab button.
    const tbrButton = screen.getByRole('button', { name: /To Be Read/ })
    expect(tbrButton.textContent).toContain('1')
  })

  it('shows the exchanges unread count as a badge on the Exchanges tab', () => {
    render(<DashboardClient {...baseProps} exchanges={[pendingExchange]} defaultTab="listings" />)
    const exchangesButton = screen.getByText('Exchanges').closest('button')!
    expect(exchangesButton.textContent).toContain('1')
  })

  it('shows no badge on a tab with zero unread', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} unreadCounts={{ ...baseProps.unreadCounts, messages: 0 }} defaultTab="listings" />)
    const messagesButton = screen.getByText('Messages').closest('button')!
    expect(messagesButton.querySelector('[data-testid="tab-badge"]')).toBeNull()
  })

  it('highlights a seller\'s pending purchase request row', () => {
    const { container } = render(<DashboardClient {...baseProps} exchanges={[pendingExchange]} defaultTab="exchanges" />)
    const highlighted = container.querySelector('[data-testid="exchange-row-highlighted"]')
    expect(highlighted).not.toBeNull()
    expect(highlighted?.textContent).toContain('Dune')
  })

  it('does not highlight a confirmed exchange row', () => {
    const confirmed = { ...pendingExchange, exchange_status: 'confirmed' as const }
    const { container } = render(<DashboardClient {...baseProps} exchanges={[confirmed]} defaultTab="exchanges" />)
    expect(container.querySelector('[data-testid="exchange-row-highlighted"]')).toBeNull()
  })

  it('marks purchase_decision/pickup notifications read when the Exchanges tab is opened', () => {
    // Mock chain supports both `.eq().eq()` (tbr path) and `.eq().in()` (exchanges path)
    // shapes markTabRead can call — mockReturnThis() alone would leave `.in` undefined.
    const update = vi.fn(() => ({ eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis() }))
    vi.mocked(createClient).mockReturnValue({ from: vi.fn(() => ({ update })) } as any)

    render(<DashboardClient {...baseProps} exchanges={[pendingExchange]} unreadEntityIds={{ ...baseProps.unreadEntityIds, decisionOrPickup: ['convo-2'] }} defaultTab="listings" />)
    fireEvent.click(screen.getByText('Exchanges').closest('button')!)
    expect(update).toHaveBeenCalledWith({ read: true })
  })

  it('does not call Supabase to mark read in demo mode', () => {
    render(<DashboardClient {...baseProps} exchanges={[pendingExchange]} isDemo={true} unreadEntityIds={{ ...baseProps.unreadEntityIds, decisionOrPickup: ['convo-2'] }} defaultTab="listings" />)
    fireEvent.click(screen.getByText('Exchanges').closest('button')!)
    expect(createClient).not.toHaveBeenCalled()
  })

  it('excludes a declined exchange from the active Sold/Bought lists, moving it to History instead', () => {
    const declined = { ...pendingExchange, exchange_status: 'declined' as const }
    const { container } = render(<DashboardClient {...baseProps} exchanges={[declined]} defaultTab="exchanges" />)
    expect(container.querySelector('[data-testid="exchange-row-highlighted"]')).toBeNull()
    expect(container.textContent).toContain('Sold (0)')
    expect(container.textContent).toContain('History (1)')
  })

  it('excludes a plain message-only conversation (no purchase request) from Sold/Bought/History — it belongs only in Messages', () => {
    const messageOnly = { ...pendingExchange, exchange_status: 'none' as const }
    const { container } = render(<DashboardClient {...baseProps} exchanges={[messageOnly]} defaultTab="exchanges" />)
    expect(container.textContent).toContain('Sold (0)')
    expect(container.textContent).toContain('Bought (0)')
    expect(container.textContent).toContain('History (0)')
  })

  it('resets to the conversation list when the Messages tab is clicked while a conversation is open', () => {
    render(
      <DashboardClient {...baseProps} isDemo={true} exchanges={[pendingExchange]} defaultTab="listings" initialConversationId="convo-1" />
    )
    expect(screen.queryByTestId('thread-title-back')).not.toBeNull()
    fireEvent.click(screen.getByText('Messages').closest('button')!)
    expect(screen.queryByTestId('thread-title-back')).toBeNull()
  })
})

describe('DashboardClient — My Listings active/paused split', () => {
  const activeListing = {
    id: 'listing-active', title: 'Dune', author: 'Frank Herbert',
    price: null, condition: 'good', status: 'active', photo_url: null,
  }
  const pausedListing = {
    id: 'listing-paused', title: 'Neuromancer', author: 'William Gibson',
    price: null, condition: 'fair', status: 'paused', photo_url: null,
  }
  const pendingListing = {
    id: 'listing-pending', title: 'Snow Crash', author: 'Neal Stephenson',
    price: null, condition: 'good', status: 'pending', photo_url: null,
  }
  const soldListing = {
    id: 'listing-sold', title: 'The Hobbit', author: 'J.R.R. Tolkien',
    price: null, condition: 'good', status: 'sold', photo_url: null,
  }

  it('shows an active listing with Pause and Delete, not Mark Sold or Re-list', () => {
    render(<DashboardClient {...baseProps} listings={[activeListing]} exchanges={[]} defaultTab="listings" />)
    expect(screen.getByText('Dune')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark Sold' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Re-list' })).not.toBeInTheDocument()
  })

  it('shows a paused listing in the Paused section with Resume and Delete', () => {
    render(<DashboardClient {...baseProps} listings={[pausedListing]} exchanges={[]} defaultTab="listings" />)
    expect(screen.getByText(/Paused \(1\)/)).toBeInTheDocument()
    expect(screen.getByText('Neuromancer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('does not show pending or sold listings in My Listings at all', () => {
    render(<DashboardClient {...baseProps} listings={[pendingListing, soldListing]} exchanges={[]} defaultTab="listings" />)
    expect(screen.queryByText('Snow Crash')).not.toBeInTheDocument()
    expect(screen.queryByText('The Hobbit')).not.toBeInTheDocument()
    expect(screen.getByText(/No active listings/)).toBeInTheDocument()
  })

  it('omits the Paused section when there are no paused listings', () => {
    render(<DashboardClient {...baseProps} listings={[activeListing]} exchanges={[]} defaultTab="listings" />)
    expect(screen.queryByText(/Paused/)).not.toBeInTheDocument()
  })

  it('shows the true lifetime count in the header even when some listings are hidden from this tab', () => {
    render(<DashboardClient {...baseProps} listings={[activeListing, soldListing]} exchanges={[]} defaultTab="listings" />)
    expect(screen.getByText('2 books posted')).toBeInTheDocument()
  })
})

describe('DashboardClient — wallet balance', () => {
  it('shows the real credit balance instead of a hardcoded 0', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} profile={{ ...baseProps.profile, credits: 7 }} defaultTab="wallet" />)
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('disables the Buy Credits button with a Coming soon label', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} defaultTab="wallet" />)
    const buyButton = screen.getByRole('button', { name: /Buy Credits/ })
    expect(buyButton).toBeDisabled()
    expect(buyButton.textContent).toMatch(/Coming soon/)
  })
})
