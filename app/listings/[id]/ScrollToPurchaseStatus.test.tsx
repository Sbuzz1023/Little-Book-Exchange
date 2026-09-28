import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import ScrollToPurchaseStatus from './ScrollToPurchaseStatus'

describe('ScrollToPurchaseStatus', () => {
  let target: HTMLElement
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    target = document.createElement('div')
    target.id = 'purchase-status'
    target.scrollIntoView = scrollIntoView
    document.body.appendChild(target)
    scrollIntoView.mockClear()
  })
  afterEach(() => {
    target.remove()
    vi.useRealTimers()
  })

  it('scrolls the purchase status area into view after the page shows', () => {
    render(<ScrollToPurchaseStatus />)
    vi.runAllTimers()
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
  })

  it('does nothing if the status area is missing', () => {
    target.remove()
    render(<ScrollToPurchaseStatus />)
    expect(() => vi.runAllTimers()).not.toThrow()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
