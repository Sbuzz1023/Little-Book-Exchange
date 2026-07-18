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
})
