import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import PhotoGallery from './PhotoGallery'

const caption = () => screen.queryByTestId('stock-caption')?.textContent

describe('PhotoGallery stock cover labelling', () => {
  it('labels a lone stock cover and says the seller has no photos yet', () => {
    render(<PhotoGallery photos={['https://covers.test/c.jpg']} stockUrl="https://covers.test/c.jpg" alt="Dune" />)
    expect(caption()).toBe("Stock cover image — the seller hasn't added photos of their copy.")
  })

  it('points to the seller photos when there are some, and tags the stock thumbnail', () => {
    render(
      <PhotoGallery
        photos={['https://covers.test/c.jpg', 'https://photos.test/a.jpg']}
        stockUrl="https://covers.test/c.jpg"
        alt="Dune"
      />
    )
    expect(caption()).toBe("Stock cover image — tap the other photos to see the seller's copy.")
    const thumbs = screen.getAllByRole('button', { name: /Show/ })
    expect(thumbs[0]).toHaveAccessibleName('Show stock cover image')
    expect(thumbs[0]).toHaveTextContent('Stock')
    expect(thumbs[1]).toHaveAccessibleName('Show seller photo 1')
    expect(thumbs[1]).not.toHaveTextContent('Stock')
  })

  it("hides the caption while one of the seller's photos is showing", () => {
    render(
      <PhotoGallery
        photos={['https://covers.test/c.jpg', 'https://photos.test/a.jpg']}
        stockUrl="https://covers.test/c.jpg"
        alt="Dune"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show seller photo 1' }))
    expect(caption()).toBeUndefined()
  })

  it('shows no caption when there is no stock cover', () => {
    render(<PhotoGallery photos={['https://photos.test/a.jpg']} stockUrl={null} alt="Dune" />)
    expect(caption()).toBeUndefined()
  })
})
