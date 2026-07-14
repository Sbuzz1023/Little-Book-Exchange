import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { StarRatingBadge, StarRatingPicker } from './StarRating'

describe('StarRatingBadge', () => {
  it('renders nothing when rating is null', () => {
    const { container } = render(<StarRatingBadge rating={null} />)
    expect(container.textContent).toBe('')
  })

  it('renders nothing when count is 0', () => {
    const { container } = render(<StarRatingBadge rating={{ average: 0, count: 0 }} />)
    expect(container.textContent).toBe('')
  })

  it('shows the average and count', () => {
    const { container } = render(<StarRatingBadge rating={{ average: 4.8, count: 12 }} />)
    expect(container.textContent).toContain('4.8')
    expect(container.textContent).toContain('12')
  })

  it('links to the seller reviews page when sellerId is given', () => {
    const { container } = render(<StarRatingBadge rating={{ average: 4.8, count: 12 }} sellerId="seller-1" />)
    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe('/sellers/seller-1/reviews')
  })

  it('renders without a link when sellerId is omitted', () => {
    const { container } = render(<StarRatingBadge rating={{ average: 4.8, count: 12 }} />)
    expect(container.querySelector('a')).toBeNull()
  })
})

describe('StarRatingPicker', () => {
  it('highlights stars up to the current value', () => {
    const { container } = render(<StarRatingPicker value={3} onChange={vi.fn()} />)
    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons).toHaveLength(5)
    expect(buttons[2].style.color).toBe('rgb(245, 158, 11)')
    expect(buttons[3].style.color).toBe('rgb(229, 231, 235)')
  })

  it('calls onChange with the clicked star value', () => {
    const onChange = vi.fn()
    const { container } = render(<StarRatingPicker value={3} onChange={onChange} />)
    const buttons = Array.from(container.querySelectorAll('button'))
    fireEvent.click(buttons[4])
    expect(onChange).toHaveBeenCalledWith(5)
  })
})
