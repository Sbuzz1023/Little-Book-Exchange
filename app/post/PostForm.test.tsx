import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import PostForm from './PostForm'
import type { BookSuggestion } from '@/lib/openLibrary'

// BookSearchInput defaults to the real searchBooks server action (a live fetch to
// openlibrary.org) when no `search` prop is given. Every pre-existing test below types
// into the Title field without caring about Open Library suggestions, so we stub it
// with a no-op to keep this suite free of real network calls. Tests that specifically
// exercise the Open Library integration pass their own mock `search`.
const noopSearch = vi.fn().mockResolvedValue([])

describe('PostForm', () => {
  it('renders empty fields and the default submit label with no initialValues', () => {
    render(<PostForm action={vi.fn()} search={noopSearch} />)
    expect(screen.getByPlaceholderText('e.g. The Great Gatsby')).toHaveValue('')
    expect(screen.getByPlaceholderText('e.g. F. Scott Fitzgerald')).toHaveValue('')
    expect(screen.getByText('Post My Book →')).toBeInTheDocument()
  })

  it('pre-fills fields from initialValues', () => {
    render(
      <PostForm
        action={vi.fn()}
        search={noopSearch}
        initialValues={{
          title: 'Dune',
          author: 'Frank Herbert',
          condition: 'Fair',
          genre: 'Sci-Fi',
          format: 'Hardcover',
          description: 'Great copy',
          pickup_description: 'side gate',
          photo_url: 'https://example.com/photo1.jpg',
          photo_url_2: null,
          photo_url_3: null,
        }}
      />
    )
    expect(screen.getByPlaceholderText('e.g. The Great Gatsby')).toHaveValue('Dune')
    expect(screen.getByPlaceholderText('e.g. F. Scott Fitzgerald')).toHaveValue('Frank Herbert')
    expect(screen.getByPlaceholderText(/Any notes/)).toHaveValue('Great copy')
    expect(screen.getByPlaceholderText(/overrides your profile default/)).toHaveValue('side gate')
    expect(screen.getByDisplayValue('Fair — some wear')).toBeInTheDocument()
    const photo1 = screen.getByAltText('a cover photo of your book preview') as HTMLImageElement
    expect(photo1.src).toBe('https://example.com/photo1.jpg')
  })

  it('uses a custom submit label when provided', () => {
    render(<PostForm action={vi.fn()} search={noopSearch} submitLabel="Save Changes" />)
    expect(screen.getByText('Save Changes')).toBeInTheDocument()
    expect(screen.queryByText('Post My Book →')).not.toBeInTheDocument()
  })
})

describe('PostForm — bundle toggle', () => {
  it('does not show the Bundle Details section by default', () => {
    render(<PostForm action={vi.fn()} search={noopSearch} />)
    expect(screen.queryByText('Series / Bundle Name')).not.toBeInTheDocument()
  })

  it('reveals Bundle Details when the toggle is clicked, defaulting to a 1-book/1-credit total', () => {
    render(<PostForm action={vi.fn()} search={noopSearch} />)
    fireEvent.click(screen.getByText('📚 List as a Bundle / Series'))
    expect(screen.getByText('Series / Bundle Name')).toBeInTheDocument()
    expect(screen.getByText('This bundle: 1 book · 1 credit')).toBeInTheDocument()
  })

  it('adds a book row with author pre-filled from Book 1, title left blank, when Add Another Book is clicked', () => {
    render(<PostForm action={vi.fn()} search={noopSearch} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. The Great Gatsby'), { target: { value: 'Dune' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. F. Scott Fitzgerald'), { target: { value: 'Frank Herbert' } })
    fireEvent.click(screen.getByText('📚 List as a Bundle / Series'))
    fireEvent.click(screen.getByText('+ Add Another Book'))

    expect(screen.getByPlaceholderText('Title in series')).toHaveValue('')
    expect(screen.getByPlaceholderText('Author')).toHaveValue('Frank Herbert')
    expect(screen.getByText('This bundle: 2 books · 2 credits')).toBeInTheDocument()
  })

  it('removes a book row when its Remove button is clicked', () => {
    render(<PostForm action={vi.fn()} search={noopSearch} />)
    fireEvent.click(screen.getByText('📚 List as a Bundle / Series'))
    fireEvent.click(screen.getByText('+ Add Another Book'))
    fireEvent.click(screen.getByText('✕ Remove'))
    expect(screen.queryByPlaceholderText('Title in series')).not.toBeInTheDocument()
    expect(screen.getByText('This bundle: 1 book · 1 credit')).toBeInTheDocument()
  })

  it('re-copies the current Book 1 author when Auto-fill is clicked, leaving the row\'s own title untouched', () => {
    render(<PostForm action={vi.fn()} search={noopSearch} />)
    fireEvent.click(screen.getByText('📚 List as a Bundle / Series'))
    fireEvent.click(screen.getByText('+ Add Another Book'))
    fireEvent.change(screen.getByPlaceholderText('Title in series'), { target: { value: 'Chamber of Secrets' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. F. Scott Fitzgerald'), { target: { value: 'J.K. Rowling' } })
    fireEvent.click(screen.getByText('✨ Auto-fill from Book 1'))
    expect(screen.getByPlaceholderText('Title in series')).toHaveValue('Chamber of Secrets')
    expect(screen.getByPlaceholderText('Author')).toHaveValue('J.K. Rowling')
  })

  it('submits is_bundle=false and book_rows=0 hidden fields by default', () => {
    const { container } = render(<PostForm action={vi.fn()} search={noopSearch} />)
    expect(container.querySelector('input[name="is_bundle"]')).toHaveValue('false')
    expect(container.querySelector('input[name="book_rows"]')).toHaveValue('0')
  })

  it('submits is_bundle=true, book_rows, and indexed book fields once populated', () => {
    const { container } = render(<PostForm action={vi.fn()} search={noopSearch} />)
    fireEvent.click(screen.getByText('📚 List as a Bundle / Series'))
    fireEvent.click(screen.getByText('+ Add Another Book'))
    fireEvent.change(screen.getByPlaceholderText('Title in series'), { target: { value: 'Chamber of Secrets' } })

    expect(container.querySelector('input[name="is_bundle"]')).toHaveValue('true')
    expect(container.querySelector('input[name="book_rows"]')).toHaveValue('1')
    expect(container.querySelector('input[name="book_title_1"]')).toHaveValue('Chamber of Secrets')
  })

  it('clears bundle data when the toggle is turned back off', () => {
    render(<PostForm action={vi.fn()} search={noopSearch} />)
    fireEvent.click(screen.getByText('📚 List as a Bundle / Series'))
    fireEvent.click(screen.getByText('+ Add Another Book'))
    fireEvent.click(screen.getByText('📚 List as a Bundle / Series'))
    expect(screen.queryByText('Series / Bundle Name')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('📚 List as a Bundle / Series'))
    expect(screen.getByText('This bundle: 1 book · 1 credit')).toBeInTheDocument()
  })

  it('hides Add Another Book once 20 additional books are added', () => {
    render(<PostForm action={vi.fn()} search={noopSearch} />)
    fireEvent.click(screen.getByText('📚 List as a Bundle / Series'))
    for (let i = 0; i < 20; i++) {
      fireEvent.click(screen.getByText('+ Add Another Book'))
    }
    expect(screen.queryByText('+ Add Another Book')).not.toBeInTheDocument()
    expect(screen.getByText('This bundle: 21 books · 21 credits')).toBeInTheDocument()
  })

  it('shows 1 credit in the preview line when the bundle toggle is off', () => {
    render(<PostForm action={vi.fn()} search={noopSearch} />)
    expect(screen.getByText('1 credit')).toBeInTheDocument()
  })

  it('shows the bundle total in the preview line while composing a bundle', () => {
    render(<PostForm action={vi.fn()} search={noopSearch} />)
    fireEvent.click(screen.getByText('📚 List as a Bundle / Series'))
    expect(screen.getByText('1 credit')).toBeInTheDocument()

    fireEvent.click(screen.getByText('+ Add Another Book'))
    fireEvent.click(screen.getByText('+ Add Another Book'))
    expect(screen.getByText('3 credits')).toBeInTheDocument()
    expect(screen.queryByText('1 credit')).not.toBeInTheDocument()
  })

  it('pre-fills bundle state from initialValues (edit mode)', () => {
    render(
      <PostForm
        action={vi.fn()}
        search={noopSearch}
        initialValues={{
          title: 'Sorcerer\'s Stone', author: 'J.K. Rowling', condition: 'Good', genre: 'Fiction', format: 'Paperback',
          description: null, pickup_description: null, photo_url: null, photo_url_2: null, photo_url_3: null,
          is_bundle: true, bundle_name: 'Harry Potter Series',
          books: [{ title: 'Chamber of Secrets', author: 'J.K. Rowling' }],
        }}
      />
    )
    expect(screen.getByDisplayValue('Harry Potter Series')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Chamber of Secrets')).toBeInTheDocument()
    expect(screen.getByText('This bundle: 2 books · 2 credits')).toBeInTheDocument()
  })
})

const DUNE: BookSuggestion = {
  title: 'Dune', author: 'Frank Herbert', year: 1965, isbn: null,
  coverUrl: 'https://covers.openlibrary.org/b/id/12345-M.jpg', workKey: '/works/OL893415W', genre: null,
}

describe('PostForm — Open Library integration', () => {
  it('selecting a suggestion fills author and the hidden ol_work_key/cover_url fields', async () => {
    const search = vi.fn().mockResolvedValue([DUNE])
    const { container } = render(<PostForm action={vi.fn()} search={search} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. The Great Gatsby'), { target: { value: 'Dune' } })
    const listbox = await screen.findByRole('listbox')
    const option = within(listbox).getByRole('button')
    expect(option).toHaveTextContent('Dune — Frank Herbert')
    fireEvent.click(option)

    expect(screen.getByPlaceholderText('e.g. F. Scott Fitzgerald')).toHaveValue('Frank Herbert')
    expect(container.querySelector('input[name="ol_work_key"]')).toHaveValue('/works/OL893415W')
    expect(container.querySelector('input[name="cover_url"]')).toHaveValue('https://covers.openlibrary.org/b/id/12345-M.jpg')
  })

  it('clears the resolved ol_work_key when the title is edited again after a selection', async () => {
    const search = vi.fn().mockResolvedValue([DUNE])
    const { container } = render(<PostForm action={vi.fn()} search={search} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. The Great Gatsby'), { target: { value: 'Dune' } })
    const listbox = await screen.findByRole('listbox')
    fireEvent.click(within(listbox).getByRole('button'))
    fireEvent.change(screen.getByPlaceholderText('e.g. The Great Gatsby'), { target: { value: 'Dune Messiah' } })

    expect(container.querySelector('input[name="ol_work_key"]')).toHaveValue('')
  })

  it('leaves ol_work_key/cover_url empty by default', () => {
    const { container } = render(<PostForm action={vi.fn()} search={noopSearch} />)
    expect(container.querySelector('input[name="ol_work_key"]')).toHaveValue('')
    expect(container.querySelector('input[name="cover_url"]')).toHaveValue('')
  })

  it('pre-fills ol_work_key/cover_url from initialValues (edit mode)', () => {
    const { container } = render(
      <PostForm
        action={vi.fn()}
        search={noopSearch}
        initialValues={{
          title: 'Dune', author: 'Frank Herbert', condition: 'Good', genre: 'Fiction', format: 'Paperback',
          description: null, pickup_description: null, photo_url: null, photo_url_2: null, photo_url_3: null,
          ol_work_key: '/works/OL893415W', cover_url: 'https://covers.openlibrary.org/b/id/12345-M.jpg',
        }}
      />
    )
    expect(container.querySelector('input[name="ol_work_key"]')).toHaveValue('/works/OL893415W')
    expect(screen.getByAltText('Cover preview')).toBeInTheDocument()
  })

  it('selecting a suggestion with a mapped genre pre-selects that Genre button', async () => {
    const SCI_FI_BOOK: BookSuggestion = {
      title: 'Dune', author: 'Frank Herbert', year: 1965, isbn: '9780441013593',
      coverUrl: null, workKey: '/works/OL893415W', genre: 'Sci-Fi',
    }
    const search = vi.fn().mockResolvedValue([SCI_FI_BOOK])
    render(<PostForm action={vi.fn()} search={search} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. The Great Gatsby'), { target: { value: 'Dune' } })
    const option = await within(await screen.findByRole('listbox')).findByRole('button')
    fireEvent.click(option)

    expect(screen.getByText('🚀 Sci-Fi / Fantasy').closest('button')).toHaveStyle({ background: '#fff7ed' })
  })

  it('selecting a suggestion with no genre match leaves the current Genre selection untouched', async () => {
    const UNMAPPED_BOOK: BookSuggestion = {
      title: 'Some Book', author: 'Someone', year: null, isbn: null,
      coverUrl: null, workKey: '/works/OL999W', genre: null,
    }
    const search = vi.fn().mockResolvedValue([UNMAPPED_BOOK])
    render(<PostForm action={vi.fn()} search={search} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. The Great Gatsby'), { target: { value: 'Some Book' } })
    const option = await within(await screen.findByRole('listbox')).findByRole('button')
    fireEvent.click(option)

    // Default genre ('Fiction') is untouched -- still selected, since UNMAPPED_BOOK.genre is null
    expect(screen.getByText('📚 Fiction').closest('button')).toHaveStyle({ background: '#fff7ed' })
  })

  it('selecting a suggestion fills the ISBN field', async () => {
    const search = vi.fn().mockResolvedValue([{
      title: 'Dune', author: 'Frank Herbert', year: 1965, isbn: '9780441013593',
      coverUrl: null, workKey: '/works/OL893415W', genre: null,
    }])
    render(<PostForm action={vi.fn()} search={search} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. The Great Gatsby'), { target: { value: 'Dune' } })
    const option = await within(await screen.findByRole('listbox')).findByRole('button')
    fireEvent.click(option)

    expect(screen.getByPlaceholderText('978-...')).toHaveValue('9780441013593')
  })
})

describe('PostForm — bundle row Open Library integration', () => {
  it('selecting a suggestion in a bundle row fills that row\'s author and hidden fields', async () => {
    const CHAMBER: BookSuggestion = {
      title: 'Chamber of Secrets', author: 'J.K. Rowling', year: 1998, isbn: null,
      coverUrl: 'https://covers.openlibrary.org/b/id/2-M.jpg', workKey: '/works/OL82586W', genre: null,
    }
    const search = vi.fn().mockResolvedValue([CHAMBER])
    const { container } = render(<PostForm action={vi.fn()} search={search} />)
    fireEvent.click(screen.getByText('📚 List as a Bundle / Series'))
    fireEvent.click(screen.getByText('+ Add Another Book'))
    fireEvent.change(screen.getByPlaceholderText('Title in series'), { target: { value: 'Chamber' } })
    const listbox = await screen.findByRole('listbox')
    const option = within(listbox).getByRole('button')
    fireEvent.click(option)

    expect(screen.getByPlaceholderText('Author')).toHaveValue('J.K. Rowling')
    expect(container.querySelector('input[name="book_ol_work_key_1"]')).toHaveValue('/works/OL82586W')
    expect(container.querySelector('input[name="book_cover_url_1"]')).toHaveValue('https://covers.openlibrary.org/b/id/2-M.jpg')
  })
})
