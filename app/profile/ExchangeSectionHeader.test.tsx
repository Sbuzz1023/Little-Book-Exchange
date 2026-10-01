import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ExchangeSectionHeader from './ExchangeSectionHeader'

describe('ExchangeSectionHeader', () => {
  it('renders the section name and count as a plain heading with a description', () => {
    render(<ExchangeSectionHeader id="t1" title="Sold" count={2} description="Books you're handing off to a buyer" />)
    expect(screen.getByRole('heading', { level: 2, name: 'Sold · 2' })).toBeInTheDocument()
    expect(screen.getByText("Books you're handing off to a buyer")).toBeInTheDocument()
  })

  it('is not a button or link — it only labels the section', () => {
    render(<ExchangeSectionHeader id="t2" title="Bought" count={0} description="Books on their way to you" />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
