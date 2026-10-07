import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import CreditCoinShow from './CreditCoinShow'
import { planCreditShow, type UnseenCredit } from '@/lib/creditShow'

const markMock = vi.fn((_upTo: string) => Promise.resolve())
vi.mock('@/lib/actions/creditsSeen', () => ({ markCreditsSeen: (upTo: string) => markMock(upTo) }))

function setReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: reduce && q.includes('reduce'), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

const sale: UnseenCredit = { id: 's', amount: 1, reason: 'sale_earned', created_at: '2026-10-06T10:00:00Z', title: 'Dune' }
const buy: UnseenCredit = { id: 'b', amount: -1, reason: 'purchase_spent', created_at: '2026-10-06T11:00:00Z', title: 'Matilda' }

describe('CreditCoinShow', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); setReducedMotion(true) })
  afterEach(() => { vi.useRealTimers() })

  it('marks the plan seen once, with its newest created_at, when it starts', () => {
    const plan = planCreditShow([sale, buy], 5)!
    render(<CreditCoinShow plan={plan} onBalance={vi.fn()} onDone={vi.fn()} persist />)
    expect(markMock).toHaveBeenCalledTimes(1)
    expect(markMock).toHaveBeenCalledWith('2026-10-06T11:00:00Z')
  })

  it('does not mark anything seen in demo mode', () => {
    render(<CreditCoinShow plan={planCreditShow([sale], 4)!} onBalance={vi.fn()} onDone={vi.fn()} persist={false} />)
    expect(markMock).not.toHaveBeenCalled()
  })

  it('reduced motion: shows each caption in turn, walks the balance, then finishes once', async () => {
    const onBalance = vi.fn()
    const onDone = vi.fn()
    render(<CreditCoinShow plan={planCreditShow([sale, buy], 5)!} onBalance={onBalance} onDone={onDone} persist />)
    expect(onBalance).toHaveBeenNthCalledWith(1, 5)          // start: 5 − 1 + 1
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(screen.getByText('+1 credit · Dune was picked up')).toBeInTheDocument()
    expect(onBalance).toHaveBeenLastCalledWith(6)
    // Still coin holds 3s, then a 1s pause before the spend burst.
    await act(async () => { await vi.advanceTimersByTimeAsync(2800) })
    expect(screen.getByText('+1 credit · Dune was picked up')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(1400) })
    expect(screen.getByText('−1 credit · you got Matilda')).toBeInTheDocument()
    expect(onBalance).toHaveBeenLastCalledWith(5)
    await act(async () => { await vi.advanceTimersByTimeAsync(2700) })
    expect(onDone).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('the still (reduced-motion) coin is the gold coin image', async () => {
    const { container } = render(<CreditCoinShow plan={planCreditShow([sale], 4)!} onBalance={vi.fn()} onDone={vi.fn()} persist />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(container.querySelector('.ccs-still img')).toHaveAttribute('src', '/home/credit-coin.webp')
  })

  it('announces each burst in a polite live region', async () => {
    render(<CreditCoinShow plan={planCreditShow([sale], 4)!} onBalance={vi.fn()} onDone={vi.fn()} persist />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    const live = document.querySelector('[aria-live="polite"]')!
    expect(live).toHaveTextContent('You earned 1 credit for Dune.')
  })

  it('a click skips to the final balance and finishes exactly once, even as timers run out later', async () => {
    const onBalance = vi.fn()
    const onDone = vi.fn()
    const { container } = render(<CreditCoinShow plan={planCreditShow([sale, buy], 5)!} onBalance={onBalance} onDone={onDone} persist />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    fireEvent.click(container.querySelector('.ccs')!)
    expect(onBalance).toHaveBeenLastCalledWith(5)
    expect(onDone).toHaveBeenCalledTimes(1)
    onBalance.mockClear()
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(onBalance).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('Escape also skips', async () => {
    const onDone = vi.fn()
    render(<CreditCoinShow plan={planCreditShow([sale], 4)!} onBalance={vi.fn()} onDone={onDone} persist />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('stops quietly when unmounted mid-show (navigating away)', async () => {
    const onBalance = vi.fn()
    const onDone = vi.fn()
    const { unmount } = render(<CreditCoinShow plan={planCreditShow([sale, buy], 5)!} onBalance={onBalance} onDone={onDone} persist />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    unmount()
    onBalance.mockClear()
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(onBalance).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('motion path without Web Animations support still completes on timers', async () => {
    setReducedMotion(false)
    const onDone = vi.fn()
    const onBalance = vi.fn()
    render(<CreditCoinShow plan={planCreditShow([sale], 4)!} onBalance={onBalance} onDone={onDone} persist />)
    // Earn coin: 2s of spinning, then a 1.3s flight before it lands.
    await act(async () => { await vi.advanceTimersByTimeAsync(3200) })
    expect(onBalance).toHaveBeenLastCalledWith(3)
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(onBalance).toHaveBeenLastCalledWith(4)
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
