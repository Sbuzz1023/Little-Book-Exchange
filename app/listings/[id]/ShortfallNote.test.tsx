import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ShortfallNote from './ShortfallNote'

const text = () => screen.getByTestId('shortfall-note').textContent?.replace(/\s+/g, ' ').trim()

describe('ShortfallNote', () => {
  it('not enough credits overall', () => {
    render(<ShortfallNote shortfall={{ reason: 'balance', balance: 0, held: 0, pendingCount: 0, cost: 1 }} />)
    expect(text()).toBe("🪙 You don't have enough credits for this. It costs 1 credit and you have 0.")
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('credits held by pending requests, none left (buzz)', () => {
    render(<ShortfallNote shortfall={{ reason: 'pending', balance: 2, held: 2, pendingCount: 2, cost: 1 }} />)
    expect(text()).toBe(
      "🪙 You have 2 credits, but 2 are held for your 2 pending requests, so no credits are available for this one. " +
      "They will be processed after pickup or cancellation.View your pending requests →"
    )
    expect(screen.getByRole('link', { name: /View your pending requests/ })).toHaveAttribute('href', '/profile?tab=exchanges')
  })

  it('credits held, one free but the book costs more', () => {
    render(<ShortfallNote shortfall={{ reason: 'pending', balance: 8, held: 7, pendingCount: 1, cost: 2 }} />)
    expect(text()).toContain('You have 8 credits, but 7 are held for your 1 pending request, leaving 1 — this costs 2.')
  })

  it('falls back to the plain message when the reason is unknown (e.g. demo mode)', () => {
    render(<ShortfallNote shortfall={null} />)
    expect(text()).toBe("🪙 You don't have enough credits for this.")
  })
})
