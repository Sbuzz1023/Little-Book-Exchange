import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import WelcomeBonusModal from './WelcomeBonusModal'

const replaceMock = vi.fn()
let mockSearch = ''

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  useRouter: () => ({ replace: replaceMock }),
}))

describe('WelcomeBonusModal', () => {
  beforeEach(() => {
    replaceMock.mockClear()
    mockSearch = ''
  })

  it('renders nothing when the welcome param is absent', () => {
    render(<WelcomeBonusModal />)
    expect(screen.queryByText(/Welcome to Little Book Exchange/)).not.toBeInTheDocument()
  })

  it('shows the bonus explanation when ?welcome=1 is present', () => {
    mockSearch = 'welcome=1'
    render(<WelcomeBonusModal />)
    expect(screen.getByText(/Welcome to Little Book Exchange/)).toBeInTheDocument()
    expect(screen.getByText(/Verify email/)).toBeInTheDocument()
    expect(screen.getByText(/Verify phone/)).toBeInTheDocument()
    expect(screen.getByText(/[Pp]ost 3 books/)).toBeInTheDocument()
  })

  it('navigates to the wallet (replacing history, not pushing) when dismissed', () => {
    mockSearch = 'welcome=1'
    render(<WelcomeBonusModal />)
    fireEvent.click(screen.getByRole('button', { name: /Take me to my Wallet/ }))
    expect(replaceMock).toHaveBeenCalledWith('/profile?tab=wallet')
  })
})
