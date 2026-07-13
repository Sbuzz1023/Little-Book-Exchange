import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import PostForm from './PostForm'

describe('PostForm', () => {
  it('renders empty fields and the default submit label with no initialValues', () => {
    render(<PostForm action={vi.fn()} />)
    expect(screen.getByPlaceholderText('e.g. The Great Gatsby')).toHaveValue('')
    expect(screen.getByPlaceholderText('e.g. F. Scott Fitzgerald')).toHaveValue('')
    expect(screen.getByText('Post My Book →')).toBeInTheDocument()
  })

  it('pre-fills fields from initialValues', () => {
    render(
      <PostForm
        action={vi.fn()}
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
    render(<PostForm action={vi.fn()} submitLabel="Save Changes" />)
    expect(screen.getByText('Save Changes')).toBeInTheDocument()
    expect(screen.queryByText('Post My Book →')).not.toBeInTheDocument()
  })
})
