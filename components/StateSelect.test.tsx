import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import StateSelect from './StateSelect'

describe('StateSelect', () => {
  it('renders every US state plus DC as an option, plus the placeholder', () => {
    render(<StateSelect name="state" placeholder="Select a state" />)
    // 51 states/DC + 1 placeholder option
    expect(screen.getAllByRole('option')).toHaveLength(52)
  })

  it('shows the placeholder text as the empty option', () => {
    render(<StateSelect name="state" placeholder="Any state" />)
    expect(screen.getByRole('option', { name: 'Any state' })).toHaveValue('')
  })

  it('preselects the defaultValue', () => {
    render(<StateSelect name="state" defaultValue="IL" placeholder="Select a state" />)
    expect(screen.getByRole('combobox')).toHaveValue('IL')
  })

  it('blocks submission on an empty value when required', () => {
    render(<StateSelect name="state" required placeholder="Select a state" />)
    expect(screen.getByRole('combobox')).toBeInvalid()
  })

  it('allows an empty value when not required, preserving "match any state"', () => {
    render(<StateSelect name="state" placeholder="Any state" />)
    expect(screen.getByRole('combobox')).toBeValid()
  })

  it('submits the selected state code under the given field name', () => {
    const { container } = render(
      <form>
        <StateSelect name="state" placeholder="Select a state" />
      </form>
    )
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'CA' } })
    const formData = new FormData(container.querySelector('form')!)
    expect(formData.get('state')).toBe('CA')
  })
})
