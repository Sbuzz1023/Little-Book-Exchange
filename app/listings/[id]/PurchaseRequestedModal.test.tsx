import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import PurchaseRequestedModal from './PurchaseRequestedModal'

describe('PurchaseRequestedModal', () => {
  it('tells the buyer exchanges are managed in the Dashboard', () => {
    render(<PurchaseRequestedModal sellerName="buzz" />)
    const dialog = screen.getByRole('dialog', { name: 'Purchase request sent' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.textContent).toContain('buzz')
    expect(dialog.textContent).toContain('Exchanges tab')
  })

  it('links to Dashboard Exchanges and back to Browse', () => {
    render(<PurchaseRequestedModal sellerName="buzz" />)
    expect(screen.getByRole('link', { name: 'Go to Exchanges' })).toHaveAttribute('href', '/profile?tab=exchanges')
    expect(screen.getByRole('link', { name: 'Back to Browse' })).toHaveAttribute('href', '/listings')
  })

  it('puts focus on the Exchanges button when it opens', () => {
    render(<PurchaseRequestedModal sellerName="buzz" />)
    expect(screen.getByRole('link', { name: 'Go to Exchanges' })).toHaveFocus()
  })

  it('closes on Escape, leaving the listing page', () => {
    render(<PurchaseRequestedModal sellerName="buzz" />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes when the backdrop is tapped, but not the card', () => {
    render(<PurchaseRequestedModal sellerName="buzz" />)
    fireEvent.click(screen.getByRole('dialog'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('purchase-modal-backdrop'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
