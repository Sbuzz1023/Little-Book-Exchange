import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import BookSearchInput from './BookSearchInput'
import type { BookSuggestion } from '@/lib/openLibrary'

const DUNE: BookSuggestion = {
  title: 'Dune', author: 'Frank Herbert', year: 1965, isbn: null,
  coverUrl: 'https://covers.openlibrary.org/b/id/12345-M.jpg', workKey: '/works/OL893415W',
}

describe('BookSearchInput', () => {
  it('renders as a plain text input with the given value and placeholder', () => {
    render(<BookSearchInput name="title" value="Dune" onChange={() => {}} onSelect={() => {}} placeholder="e.g. Dune" />)
    expect(screen.getByPlaceholderText('e.g. Dune')).toHaveValue('Dune')
  })

  it('calls onChange as the user types, without waiting for the debounce', () => {
    const onChange = vi.fn()
    render(<BookSearchInput name="title" value="" onChange={onChange} onSelect={() => {}} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Du' } })
    expect(onChange).toHaveBeenCalledWith('Du')
  })

  it('does not call search for input shorter than 2 characters', async () => {
    const search = vi.fn().mockResolvedValue([])
    render(<BookSearchInput name="title" value="" onChange={() => {}} onSelect={() => {}} search={search} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'D' } })
    await new Promise(r => setTimeout(r, 350))
    expect(search).not.toHaveBeenCalled()
  })

  it('calls search after the debounce once 2+ characters are typed, and shows a suggestion', async () => {
    const search = vi.fn().mockResolvedValue([DUNE])
    render(<BookSearchInput name="title" value="" onChange={() => {}} onSelect={() => {}} search={search} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Dune' } })
    await waitFor(() => expect(search).toHaveBeenCalledWith('Dune'), { timeout: 1000 })
    expect(await screen.findByText(/Dune/)).toBeInTheDocument()
  })

  it('calls onSelect with the picked suggestion and closes the dropdown', async () => {
    const search = vi.fn().mockResolvedValue([DUNE])
    const onSelect = vi.fn()
    render(<BookSearchInput name="title" value="" onChange={() => {}} onSelect={onSelect} search={search} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Dune' } })
    const option = await screen.findByRole('button')
    expect(option).toHaveTextContent('Dune — Frank Herbert')
    fireEvent.click(option)
    expect(onSelect).toHaveBeenCalledWith(DUNE)
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  })

  it('shows nothing when search resolves with no results', async () => {
    const search = vi.fn().mockResolvedValue([])
    render(<BookSearchInput name="title" value="" onChange={() => {}} onSelect={() => {}} search={search} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Zzzznotabook' } })
    await waitFor(() => expect(search).toHaveBeenCalled())
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('ignores a stale in-flight search response if the input shrinks below 2 characters before it resolves', async () => {
    let resolveSearch: (books: BookSuggestion[]) => void
    const search = vi.fn().mockReturnValue(new Promise<BookSuggestion[]>(resolve => { resolveSearch = resolve }))
    render(<BookSearchInput name="title" value="" onChange={() => {}} onSelect={() => {}} search={search} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Du' } })
    await waitFor(() => expect(search).toHaveBeenCalledWith('Du'), { timeout: 1000 })

    // Shrink below the 2-char threshold while the search above is still in flight.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'D' } })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    // The stale search now resolves — it must not repopulate/reopen the dropdown.
    resolveSearch!([DUNE])
    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
