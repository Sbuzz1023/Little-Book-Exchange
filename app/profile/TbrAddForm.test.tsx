import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import TbrAddForm from './TbrAddForm'
import type { BookSuggestion } from '@/lib/openLibrary'

const DUNE: BookSuggestion = {
  title: 'Dune', author: 'Frank Herbert', year: 1965, isbn: null,
  coverUrl: 'https://covers.openlibrary.org/b/id/12345-M.jpg', workKey: '/works/OL893415W',
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
})
