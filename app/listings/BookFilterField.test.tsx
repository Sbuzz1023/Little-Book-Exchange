import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import BookFilterField from './BookFilterField'
import type { BookSuggestion } from '@/lib/openLibrary'

const DUNE: BookSuggestion = {
  title: 'Dune', author: 'Frank Herbert', year: 1965, isbn: null,
  coverUrl: 'https://covers.openlibrary.org/b/id/12345-M.jpg', workKey: '/works/OL893415W',
}

// BookSearchInput defaults to the real searchBooks server action (a live fetch to
// openlibrary.org) when no `search` prop is given. Tests below that don't care about
// Open Library suggestions get this no-op stub so the suite stays free of real network
// calls. Tests that specifically exercise selection pass their own mock `search`.
const noopSearch = vi.fn().mockResolvedValue([])

describe('BookFilterField', () => {
  it('renders a title input named "title" with the given default value', () => {
    render(<BookFilterField defaultValue="Dune" style={{}} search={noopSearch} />)
    expect(screen.getByRole('textbox')).toHaveValue('Dune')
  })

  it('leaves the hidden ol_work_key field empty by default', () => {
    const { container } = render(<BookFilterField defaultValue="" style={{}} search={noopSearch} />)
    expect(container.querySelector('input[name="ol_work_key"]')).toHaveValue('')
  })

  it('pre-fills the hidden ol_work_key field when defaultOlWorkKey is passed', () => {
    const { container } = render(
      <BookFilterField defaultValue="Dune" style={{}} search={noopSearch} defaultOlWorkKey="/works/OL893415W" />
    )
    expect(container.querySelector('input[name="ol_work_key"]')).toHaveValue('/works/OL893415W')
  })

  it('selecting a suggestion fills the hidden ol_work_key field', async () => {
    const search = vi.fn().mockResolvedValue([DUNE])
    const { container } = render(<BookFilterField defaultValue="" style={{}} search={search} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Dune' } })
    const option = await within(await screen.findByRole('listbox')).findByRole('button')
    fireEvent.click(option)
    expect(container.querySelector('input[name="ol_work_key"]')).toHaveValue('/works/OL893415W')
  })
})
