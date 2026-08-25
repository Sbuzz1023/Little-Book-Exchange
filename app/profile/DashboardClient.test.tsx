import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DashboardClient from './DashboardClient'
import { createClient } from '@/lib/supabase/client'

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}))

// DashboardClient calls router.refresh() after a successful phone verification
// so the server-rendered profile (and the bonus card) update in-session.
const refreshMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}))

const baseProps = {
  profile: { id: 'me', username: 'me', city: 'Chicago', state: 'IL' },
  listings: [],
  savedListings: [],
  tbrEntries: [
    { id: 'tbr-1', title: 'Dune', author: '', city: '', state: '', match: { id: 'listing-1', title: 'Dune' } },
  ],
  transactions: [],
  updateAction: vi.fn(() => Promise.resolve()),
  updateListingStatus: vi.fn(() => Promise.resolve()),
  markPickedUp: vi.fn(() => Promise.resolve()),
  fileDispute: vi.fn(() => Promise.resolve({ ok: true })),
  hideExchangeHistory: vi.fn(() => Promise.resolve()),
  submitReview: vi.fn(() => Promise.resolve({ ok: true })),
  confirmExchange: vi.fn(() => Promise.resolve()),
  cancelPurchase: vi.fn(() => Promise.resolve()),
  denyPurchase: vi.fn(() => Promise.resolve()),
  removeSavedListing: vi.fn(() => Promise.resolve()),
  moveSavedListingToTbr: vi.fn(() => Promise.resolve()),
  addTbrEntry: vi.fn(() => Promise.resolve()),
  removeTbrEntry: vi.fn(() => Promise.resolve()),
  isDemo: false,
  unreadCounts: { total: 2, exchanges: 1, tbr: 1, messages: 0 },
  unreadEntityIds: { message: [] as string[], decisionOrPickup: [] as string[], tbrMatch: ['tbr-1'] },
  resendEmailConfirmation: vi.fn(() => Promise.resolve({ ok: true })),
  sendPhoneOtp: vi.fn(() => Promise.resolve({ ok: true })),
  verifyPhoneOtp: vi.fn(() => Promise.resolve({ ok: true })),
  startSupportConversation: vi.fn(() => Promise.resolve({ ok: true, conversationId: 'convo-support' })),
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

  it('offers a state dropdown (not free text) on the TBR add form, with "any state" as the default', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} defaultTab="tbr" />)
    // The TBR add form's state field is the only <select> rendered on this tab.
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Any state' })).toHaveValue('')
    expect(screen.getByRole('option', { name: 'IL — Illinois' })).toBeInTheDocument()
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

  it('shows a badge on the Wallet tab when onboarding_bonus_claimed is false', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} profile={{ ...baseProps.profile, onboarding_bonus_claimed: false }} defaultTab="listings" />)
    const walletButton = screen.getByText('Wallet').closest('button')!
    expect(walletButton.querySelector('[data-testid="tab-badge"]')).not.toBeNull()
    expect(walletButton.textContent).toContain('1')
  })

  it('shows no badge on the Wallet tab when onboarding_bonus_claimed is true', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} profile={{ ...baseProps.profile, onboarding_bonus_claimed: true }} defaultTab="listings" />)
    const walletButton = screen.getByText('Wallet').closest('button')!
    expect(walletButton.querySelector('[data-testid="tab-badge"]')).toBeNull()
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

describe('DashboardClient — dual pickup confirmation', () => {
  const confirmedExchange = {
    id: 'convo-2', listing_id: 'listing-2', buyer_id: 'them', seller_id: 'me',
    created_at: '2026-08-01T00:00:00.000Z',
    exchange_status: 'confirmed' as const, completed_at: null, buyer_hidden: false, seller_hidden: false,
    sellerRating: null, reviewed: false,
    seller_picked_up_at: null as string | null,
    buyer_picked_up_at: null as string | null,
    completion_type: null,
    hasOpenDispute: false,
    listings: { title: 'Dune', author: 'Frank Herbert' },
    buyer: { name: 'Neighbor' }, seller: { name: 'Me' },
    messages: [],
  }

  it('shows the seller their Mark Picked Up and Dispute buttons when neither party has confirmed', () => {
    render(<DashboardClient {...baseProps} exchanges={[confirmedExchange]} defaultTab="exchanges" />)
    expect(screen.getByText('📦 Mark Picked Up')).toBeInTheDocument()
    expect(screen.getByText('🚩 Dispute')).toBeInTheDocument()
  })

  it('shows the buyer their I Got It and Dispute buttons when neither party has confirmed', () => {
    const asBuyer = { ...confirmedExchange, id: 'convo-3', buyer_id: 'me', seller_id: 'them' }
    render(<DashboardClient {...baseProps} exchanges={[asBuyer]} defaultTab="exchanges" />)
    expect(screen.getByText('📚 I Got It!')).toBeInTheDocument()
    expect(screen.getByText('🚩 Dispute')).toBeInTheDocument()
  })

  it('shows a waiting state instead of the button once the seller has confirmed', () => {
    const sellerConfirmed = { ...confirmedExchange, seller_picked_up_at: '2026-08-01T00:00:00.000Z' }
    render(<DashboardClient {...baseProps} exchanges={[sellerConfirmed]} defaultTab="exchanges" />)
    expect(screen.queryByText('📦 Mark Picked Up')).not.toBeInTheDocument()
    expect(screen.getByText(/You confirmed — waiting for/)).toBeInTheDocument()
  })

  it('shows a dispute-pending state instead of both buttons when there is an open dispute', () => {
    const disputed = { ...confirmedExchange, hasOpenDispute: true }
    render(<DashboardClient {...baseProps} exchanges={[disputed]} defaultTab="exchanges" />)
    expect(screen.queryByText('📦 Mark Picked Up')).not.toBeInTheDocument()
    expect(screen.queryByText('🚩 Dispute')).not.toBeInTheDocument()
    expect(screen.getByText(/Dispute pending review/)).toBeInTheDocument()
  })

  it('opens the dispute popup and submits a message via fileDispute', async () => {
    const fileDispute = vi.fn(() => Promise.resolve({ ok: true }))
    render(<DashboardClient {...baseProps} exchanges={[confirmedExchange]} defaultTab="exchanges" fileDispute={fileDispute} />)

    fireEvent.click(screen.getByText('🚩 Dispute'))
    const textarea = await screen.findByPlaceholderText(/describe the issue/i)
    fireEvent.change(textarea, { target: { value: 'The book was damaged.' } })
    fireEvent.click(screen.getByRole('button', { name: /Send to Admin/i }))

    await waitFor(() => expect(fileDispute).toHaveBeenCalled())
  })

  it('places the Dispute button in the header (top-right) area, not the action row, once both parties can act', () => {
    const { container } = render(<DashboardClient {...baseProps} exchanges={[confirmedExchange]} defaultTab="exchanges" />)
    const header = container.querySelector('[data-testid="exchange-header-actions"]')
    const actionRow = container.querySelector('[data-testid="exchange-action-row"]')
    expect(header?.textContent).toContain('Dispute')
    expect(actionRow?.textContent).not.toContain('Dispute')
  })

  it('places the Message button in the action row, not the header, once both parties can act', () => {
    const { container } = render(<DashboardClient {...baseProps} exchanges={[confirmedExchange]} defaultTab="exchanges" />)
    const header = container.querySelector('[data-testid="exchange-header-actions"]')
    const actionRow = container.querySelector('[data-testid="exchange-action-row"]')
    expect(actionRow?.textContent).toContain('Message')
    expect(header?.textContent).not.toContain('Message')
  })

  it('still shows the Message button on a requested exchange, where Dispute does not apply yet', () => {
    render(<DashboardClient {...baseProps} exchanges={[pendingExchange]} defaultTab="exchanges" />)
    expect(screen.getByText('💬 Message')).toBeInTheDocument()
    expect(screen.queryByText('🚩 Dispute')).not.toBeInTheDocument()
  })

  it("shows the buyer a Directions link to the confirmed address once the seller has confirmed", () => {
    const asBuyer = {
      ...confirmedExchange, id: 'convo-4', buyer_id: 'me', seller_id: 'them',
      confirmed_address: '555 Oak Ave', confirmed_address_unit: 'Unit 3',
      listings: { title: 'Dune', author: 'Frank Herbert', city: 'Oak Park', state: 'IL' },
    }
    render(<DashboardClient {...baseProps} exchanges={[asBuyer]} defaultTab="exchanges" />)
    const link = screen.getByRole('link', { name: /Directions/ })
    expect(link).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=555%20Oak%20Ave%20Unit%203%2C%20Oak%20Park%2C%20IL')
  })

  it('omits the Directions link when the seller did not confirm a street address', () => {
    const asBuyer = {
      ...confirmedExchange, id: 'convo-5', buyer_id: 'me', seller_id: 'them',
      confirmed_address: null, confirmed_address_unit: null,
      listings: { title: 'Dune', author: 'Frank Herbert', city: 'Oak Park', state: 'IL' },
    }
    render(<DashboardClient {...baseProps} exchanges={[asBuyer]} defaultTab="exchanges" />)
    expect(screen.queryByRole('link', { name: /Directions/ })).not.toBeInTheDocument()
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

describe('DashboardClient — transaction history', () => {
  const tx = [
    { id: 't1', amount: -1, reason: 'purchase_spent', created_at: '2026-08-01T00:00:00.000Z' },
    { id: 't2', amount: 1, reason: 'sale_earned', created_at: '2026-08-02T00:00:00.000Z' },
  ]

  it('renders real transactions when present', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} transactions={tx} defaultTab="wallet" />)
    expect(screen.getByText(/Spent 1 credit/)).toBeInTheDocument()
    expect(screen.getByText(/Earned 1 credit/)).toBeInTheDocument()
  })

  it('shows the empty state when there are no transactions', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} transactions={[]} defaultTab="wallet" />)
    expect(screen.getByText('No transactions yet.')).toBeInTheDocument()
  })
})

describe('DashboardClient — onboarding checklist', () => {
  const unclaimedProfile = { ...baseProps.profile, email_verified: false, phone_verified: false, onboarding_bonus_claimed: false }

  it('shows the checklist with books-posted progress when the bonus is unclaimed', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} transactions={[]} profile={unclaimedProfile}
      listings={[{ id: 'l1', title: 'Dune', author: 'Herbert', condition: 'Good', status: 'active' }]}
      defaultTab="wallet" resendEmailConfirmation={vi.fn()} />)
    expect(screen.getByText('Earn Your First Credit')).toBeInTheDocument()
    expect(screen.getByText('1/3')).toBeInTheDocument()
  })

  it('shows the bonus-earned message instead of the checklist once claimed', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} transactions={[]}
      profile={{ ...unclaimedProfile, onboarding_bonus_claimed: true }}
      defaultTab="wallet" resendEmailConfirmation={vi.fn()} />)
    expect(screen.getByText(/Bonus earned/)).toBeInTheDocument()
    expect(screen.queryByText('Earn Your First Credit')).not.toBeInTheDocument()
  })

  it('calls resendEmailConfirmation when the resend button is clicked', async () => {
    const resend = vi.fn(() => Promise.resolve({ ok: true }))
    render(<DashboardClient {...baseProps} exchanges={[]} transactions={[]} profile={unclaimedProfile} defaultTab="wallet" resendEmailConfirmation={resend} />)
    fireEvent.click(screen.getByRole('button', { name: /Resend confirmation email/ }))
    expect(resend).toHaveBeenCalled()
  })

  it('confirms a successful resend to the user', async () => {
    const resend = vi.fn(() => Promise.resolve({ ok: true }))
    render(<DashboardClient {...baseProps} exchanges={[]} transactions={[]} profile={unclaimedProfile} defaultTab="wallet" resendEmailConfirmation={resend} />)
    fireEvent.click(screen.getByRole('button', { name: /Resend confirmation email/ }))
    expect(await screen.findByText(/Confirmation email sent/)).toBeInTheDocument()
  })

  it('surfaces a failed resend instead of failing silently', async () => {
    const resend = vi.fn(() => Promise.resolve({ ok: false, error: 'Rate limit exceeded.' }))
    render(<DashboardClient {...baseProps} exchanges={[]} transactions={[]} profile={unclaimedProfile} defaultTab="wallet" resendEmailConfirmation={resend} />)
    fireEvent.click(screen.getByRole('button', { name: /Resend confirmation email/ }))
    expect(await screen.findByText('Rate limit exceeded.')).toBeInTheDocument()
  })
})

describe('DashboardClient — phone verification', () => {
  const unverifiedProfile = { ...baseProps.profile, email_verified: true, phone_verified: false, onboarding_bonus_claimed: false, phone: '3125550100' }

  beforeEach(() => { refreshMock.mockClear() })

  it('refreshes the server-rendered profile after a successful verification', async () => {
    const verifyOtp = vi.fn(() => Promise.resolve({ ok: true }))
    render(<DashboardClient {...baseProps} exchanges={[]} transactions={[]} profile={unverifiedProfile}
      defaultTab="wallet" resendEmailConfirmation={vi.fn()} sendPhoneOtp={vi.fn(() => Promise.resolve({ ok: true }))} verifyPhoneOtp={verifyOtp} />)

    fireEvent.click(screen.getByRole('button', { name: /Verify Phone/ }))
    fireEvent.change(await screen.findByPlaceholderText(/6-digit code/), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /Confirm code/ }))

    await waitFor(() => expect(refreshMock).toHaveBeenCalled())
  })

  it('does not refresh when verification fails', async () => {
    const verifyOtp = vi.fn(() => Promise.resolve({ ok: false, error: 'Invalid code.' }))
    render(<DashboardClient {...baseProps} exchanges={[]} transactions={[]} profile={unverifiedProfile}
      defaultTab="wallet" resendEmailConfirmation={vi.fn()} sendPhoneOtp={vi.fn(() => Promise.resolve({ ok: true }))} verifyPhoneOtp={verifyOtp} />)

    fireEvent.click(screen.getByRole('button', { name: /Verify Phone/ }))
    fireEvent.change(await screen.findByPlaceholderText(/6-digit code/), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: /Confirm code/ }))

    expect(await screen.findByText('Invalid code.')).toBeInTheDocument()
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('sends an OTP and then verifies it', async () => {
    const sendOtp = vi.fn(() => Promise.resolve({ ok: true }))
    const verifyOtp = vi.fn(() => Promise.resolve({ ok: true }))
    render(<DashboardClient {...baseProps} exchanges={[]} transactions={[]} profile={unverifiedProfile}
      defaultTab="wallet" resendEmailConfirmation={vi.fn()} sendPhoneOtp={sendOtp} verifyPhoneOtp={verifyOtp} />)

    fireEvent.click(screen.getByRole('button', { name: /Verify Phone/ }))
    fireEvent.click(screen.getByRole('button', { name: /Send code/ }))
    expect(sendOtp).toHaveBeenCalled()

    const codeInput = await screen.findByPlaceholderText(/6-digit code/)
    fireEvent.change(codeInput, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /Confirm code/ }))
    expect(verifyOtp).toHaveBeenCalled()
  })
})

describe('DashboardClient — saved listings', () => {
  const activeSaved = { id: 'listing-active', title: 'Dune', author: 'Frank Herbert', condition: 'Good', status: 'active' }
  const soldSaved = { id: 'listing-sold', title: 'Educated', author: 'Tara Westover', condition: 'Fair', status: 'sold' }

  it('shows a Sold badge and a Move to To Be Read button on a sold saved listing', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} savedListings={[soldSaved]} defaultTab="saved" />)
    expect(screen.getByText('Sold')).toBeInTheDocument()
    expect(screen.getByText('📖 Move to To Be Read')).toBeInTheDocument()
  })

  it('does not show a Sold badge or the Move to To Be Read button on an active saved listing', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} savedListings={[activeSaved]} defaultTab="saved" />)
    expect(screen.queryByText('Sold')).not.toBeInTheDocument()
    expect(screen.queryByText('📖 Move to To Be Read')).not.toBeInTheDocument()
  })

  it('still shows the Unsave button on a sold saved listing', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} savedListings={[soldSaved]} defaultTab="saved" />)
    expect(screen.getByText('💔 Unsave')).toBeInTheDocument()
  })

  it("wires the Move to To Be Read button's hidden field to the correct listing", () => {
    const { container } = render(<DashboardClient {...baseProps} exchanges={[]} savedListings={[soldSaved]} defaultTab="saved" />)
    const button = screen.getByText('📖 Move to To Be Read')
    const form = button.closest('form')!
    expect(form.querySelector('input[name="listing_id"]')).toHaveValue('listing-sold')
  })
})
