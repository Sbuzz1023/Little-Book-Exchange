import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ShareToggle from './ShareToggle'

describe('ShareToggle', () => {
  it('renders ON by default', () => {
    render(<ShareToggle name="share_address" label="Share address" hint="Only shared after approval" />)
    expect(screen.getByRole('button')).toHaveTextContent('ON')
  })

  it('renders OFF when defaultValue is false', () => {
    render(<ShareToggle name="share_address" defaultValue={false} label="Share address" hint="hint" />)
    expect(screen.getByRole('button')).toHaveTextContent('OFF')
  })

  it('toggles to OFF when clicked once', () => {
    render(<ShareToggle name="share_address" label="Share address" hint="hint" />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button')).toHaveTextContent('OFF')
  })

  it('toggles back to ON when clicked twice', () => {
    render(<ShareToggle name="share_address" label="Share address" hint="hint" />)
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(btn).toHaveTextContent('ON')
  })

  it('hidden input has value "true" when ON', () => {
    const { container } = render(<ShareToggle name="share_address" label="Share address" hint="hint" />)
    const input = container.querySelector('input[name="share_address"]') as HTMLInputElement
    expect(input.value).toBe('true')
  })

  it('hidden input has value "false" when toggled OFF', () => {
    const { container } = render(<ShareToggle name="share_address" label="Share address" hint="hint" />)
    fireEvent.click(container.querySelector('button')!)
    const input = container.querySelector('input[name="share_address"]') as HTMLInputElement
    expect(input.value).toBe('false')
  })

  it('displays the hint text', () => {
    render(<ShareToggle name="share_address" label="Share address" hint="Revealed after approval" />)
    expect(screen.getByText('Revealed after approval')).toBeInTheDocument()
  })
})
