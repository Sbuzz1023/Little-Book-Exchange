import { render, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import HistorySection, { type HistoryExchange } from './HistorySection'

const baseExchange: HistoryExchange = {
  id: 'convo-1',
  listing_id: 'listing-1',
  buyer_id: 'me',
  seller_id: 'them-1',
  exchange_status: 'completed',
  completed_at: '2026-07-10T12:00:00.000Z',
  listings: { title: 'The Hobbit', author: 'J.R.R. Tolkien', photo_url: null },
  buyer: { username: 'me', name: 'Me' },
  seller: { username: 'them1', name: 'Neighbor One' },
  buyer_hidden: false,
  seller_hidden: false,
  sellerRating: { average: 4.5, count: 8 },
  reviewed: false,
}

describe('HistorySection', () => {
  let hideExchangeHistory: ReturnType<typeof vi.fn>
  let submitReview: ReturnType<typeof vi.fn>

  beforeEach(() => {
    hideExchangeHistory = vi.fn(() => Promise.resolve())
    submitReview = vi.fn(() => Promise.resolve({ ok: true }))
  })

  it('shows an empty state with no completed exchanges', () => {
    const { container } = render(
      <HistorySection exchanges={[]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    expect(container.textContent).toContain('No completed exchanges yet')
  })

  it('labels a row "Bought" when the user was the buyer, and shows the seller\'s rating', () => {
    const { container } = render(
      <HistorySection exchanges={[baseExchange]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    expect(container.textContent).toContain('Bought')
    expect(container.textContent).toContain('Neighbor One')
    expect(container.textContent).toContain('4.5')
  })

  it('labels a row "Sold" when the user was the seller, and never shows a rate button', () => {
    const soldExchange: HistoryExchange = { ...baseExchange, buyer_id: 'them-2', seller_id: 'me', buyer: { username: 'them2', name: 'Neighbor Two' } }
    const { container } = render(
      <HistorySection exchanges={[soldExchange]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    expect(container.textContent).toContain('Sold')
    expect(container.textContent).not.toContain('Rate Seller')
  })

  it('excludes a completed exchange the current user has hidden on their own side', () => {
    const hidden: HistoryExchange = { ...baseExchange, buyer_hidden: true }
    const { container } = render(
      <HistorySection exchanges={[hidden]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    expect(container.textContent).toContain('No completed exchanges yet')
  })

  it('shows "Rate Seller" for an unreviewed Bought row, and "Rated" for a reviewed one', () => {
    const { container, rerender } = render(
      <HistorySection exchanges={[baseExchange]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    expect(container.textContent).toContain('Rate Seller')

    rerender(
      <HistorySection exchanges={[{ ...baseExchange, reviewed: true }]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    expect(container.textContent).toContain('Rated')
  })

  it('opens a rating modal and submits the chosen star count and text', async () => {
    const { container } = render(
      <HistorySection exchanges={[baseExchange]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    fireEvent.click(Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Rate Seller'))!)

    const starButtons = Array.from(container.querySelectorAll('button[aria-label$="stars"], button[aria-label$="star"]'))
    fireEvent.click(starButtons[1]) // 2 stars

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Good seller' } })

    fireEvent.click(Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Submit Rating'))!)

    await waitFor(() => expect(submitReview).toHaveBeenCalled())
    const sentFormData = submitReview.mock.calls[0][0] as FormData
    expect(sentFormData.get('conversation_id')).toBe('convo-1')
    expect(sentFormData.get('seller_id')).toBe('them-1')
    expect(sentFormData.get('rating')).toBe('2')
    expect(sentFormData.get('text')).toBe('Good seller')
  })

  it('shows "Rated" immediately after a successful submission without waiting for a reload', async () => {
    const { container } = render(
      <HistorySection exchanges={[baseExchange]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    fireEvent.click(Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Rate Seller'))!)
    fireEvent.click(Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Submit Rating'))!)
    await waitFor(() => expect(container.textContent).toContain('Rated'))
  })

  it('shows a "Declined" badge and "Declined by <name>" text for a declined exchange from the buyer\'s perspective, and no "Rate Seller" button', () => {
    const declined: HistoryExchange = { ...baseExchange, exchange_status: 'declined' }
    const { container } = render(
      <HistorySection exchanges={[declined]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    expect(container.textContent).toContain('Declined')
    expect(container.textContent).toContain('Declined by')
    expect(container.textContent).toContain('Neighbor One')
    expect(container.textContent).not.toContain('Rate Seller')
  })

  it('shows "You declined <name>\'s request" text for a declined exchange from the seller\'s perspective', () => {
    const declined: HistoryExchange = { ...baseExchange, exchange_status: 'declined', buyer_id: 'them-2', seller_id: 'me', buyer: { username: 'them2', name: 'Neighbor Two' } }
    const { container } = render(
      <HistorySection exchanges={[declined]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    expect(container.textContent).toContain('You declined')
    expect(container.textContent).toContain('Neighbor Two')
    expect(container.textContent).toContain("request")
  })

  it('excludes a declined exchange the current user has hidden on their own side', () => {
    const hidden: HistoryExchange = { ...baseExchange, exchange_status: 'declined', buyer_hidden: true }
    const { container } = render(
      <HistorySection exchanges={[hidden]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    expect(container.textContent).toContain('No completed exchanges yet')
  })
})

describe('HistorySection — auto-completed tag and unread highlight', () => {
  let hideExchangeHistory: ReturnType<typeof vi.fn>
  let submitReview: ReturnType<typeof vi.fn>

  beforeEach(() => {
    hideExchangeHistory = vi.fn(() => Promise.resolve())
    submitReview = vi.fn(() => Promise.resolve({ ok: true }))
  })

  it('shows an Auto-completed tag when completion_type is auto_timeout', () => {
    const autoCompleted = { ...baseExchange, id: 'convo-auto', completion_type: 'auto_timeout' }
    const { container } = render(
      <HistorySection exchanges={[autoCompleted]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    expect(container.textContent).toContain('Auto-completed')
  })

  it('does not show the tag for a normal completion', () => {
    const { container } = render(
      <HistorySection exchanges={[baseExchange]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    expect(container.textContent).not.toContain('Auto-completed')
  })

  it('highlights a row whose conversation id is in unreadConversationIds', () => {
    const { container } = render(
      <HistorySection exchanges={[baseExchange]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview}
        unreadConversationIds={['convo-1']} />
    )
    expect(container.querySelector('[data-testid="history-row-highlighted"]')).not.toBeNull()
  })

  it('does not highlight a row not in unreadConversationIds', () => {
    const { container } = render(
      <HistorySection exchanges={[baseExchange]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview}
        unreadConversationIds={['some-other-convo']} />
    )
    expect(container.querySelector('[data-testid="history-row-highlighted"]')).toBeNull()
  })
})
