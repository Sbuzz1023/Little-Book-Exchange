import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import TbrAddForm from './TbrAddForm'
import type { BookSuggestion } from '@/lib/openLibrary'

const DUNE: BookSuggestion = {
  title: 'Dune', author: 'Frank Herbert', year: 1965, isbn: null,
  coverUrl: 'https://covers.openlibrary.org/b/id/12345-M.jpg', workKey: '/works/OL893415W', genre: null,
}

describe('TbrAddForm', () => {
  it('renders empty Title/Author/City fields and hidden Open Library fields', () => {
    const { container } = render(<TbrAddForm addTbrEntry={vi.fn()} search={vi.fn().mockResolvedValue([])} />)
    expect(screen.getByPlaceholderText('Book title...')).toHaveValue('')
    expect(screen.getByPlaceholderText('Author (optional)...')).toHaveValue('')
    expect(container.querySelector('input[name="ol_work_key"]')).toHaveValue('')
    expect(container.querySelector('input[name="cover_url"]')).toHaveValue('')
  })

  it('selecting a suggestion fills author and the hidden ol_work_key/cover_url fields', async () => {
    const search = vi.fn().mockResolvedValue([DUNE])
    const { container } = render(<TbrAddForm addTbrEntry={vi.fn()} search={search} />)
    fireEvent.change(screen.getByPlaceholderText('Book title...'), { target: { value: 'Dune' } })
    const option = await within(await screen.findByRole('listbox')).findByRole('button')
    fireEvent.click(option)

    expect(screen.getByPlaceholderText('Author (optional)...')).toHaveValue('Frank Herbert')
    expect(container.querySelector('input[name="ol_work_key"]')).toHaveValue('/works/OL893415W')
  })

  it('clears the resolved ol_work_key when the author is edited manually afterward', async () => {
    const search = vi.fn().mockResolvedValue([DUNE])
    const { container } = render(<TbrAddForm addTbrEntry={vi.fn()} search={search} />)
    fireEvent.change(screen.getByPlaceholderText('Book title...'), { target: { value: 'Dune' } })
    const option = await within(await screen.findByRole('listbox')).findByRole('button')
    fireEvent.click(option)
    fireEvent.change(screen.getByPlaceholderText('Author (optional)...'), { target: { value: 'Someone Else' } })

    expect(container.querySelector('input[name="ol_work_key"]')).toHaveValue('')
  })

  it("starts City and State from the signed-in user's profile", () => {
    const { container } = render(<TbrAddForm addTbrEntry={vi.fn()} search={vi.fn().mockResolvedValue([])} defaultCity="Arroyo Grande" defaultState="CA" />)
    expect(container.querySelector('input[name="city"]')).toHaveValue('Arroyo Grande')
    expect(container.querySelector('select[name="state"]')).toHaveValue('CA')
  })

  it('lets the user change or clear the pre-filled city', () => {
    const { container } = render(<TbrAddForm addTbrEntry={vi.fn()} search={vi.fn().mockResolvedValue([])} defaultCity="Arroyo Grande" defaultState="CA" />)
    const city = container.querySelector('input[name="city"]') as HTMLInputElement
    fireEvent.change(city, { target: { value: '' } })
    expect(city).toHaveValue('')
  })

  it('leaves City and State blank (anywhere) when the profile has none', () => {
    const { container } = render(<TbrAddForm addTbrEntry={vi.fn()} search={vi.fn().mockResolvedValue([])} />)
    expect(container.querySelector('input[name="city"]')).toHaveValue('')
    expect(container.querySelector('select[name="state"]')).toHaveValue('')
  })

  it('sizes the inputs to fit one row (title > author > city > state)', () => {
    const { container } = render(<TbrAddForm addTbrEntry={vi.fn()} search={vi.fn().mockResolvedValue([])} />)
    const basis = (el: Element) => parseInt((el as HTMLElement).style.flexBasis, 10)
    const titleWrap = container.querySelector('form > div')!
    const author = container.querySelector('input[name="author"]')!
    const city = container.querySelector('input[name="city"]')!
    const state = container.querySelector('select[name="state"]')!
    expect(basis(titleWrap)).toBeGreaterThan(basis(author))
    expect(basis(author)).toBeGreaterThan(basis(city))
    expect(basis(city)).toBeGreaterThanOrEqual(basis(state))
    expect(basis(titleWrap) + basis(author) + basis(city) + basis(state)).toBeLessThanOrEqual(560)
  })

  it('uses the house input and pine pill styles (no purple)', () => {
    const { container } = render(<TbrAddForm addTbrEntry={vi.fn()} search={vi.fn().mockResolvedValue([])} />)
    expect(screen.getByPlaceholderText('Author (optional)...')).toHaveClass('dash-tbr-input')
    expect(container.querySelector('select[name="state"]')).toHaveClass('dash-tbr-input')
    expect(screen.getByRole('button', { name: '+ Add' })).toHaveClass('btn-primary')
  })
})
