import { describe, it, expect } from 'vitest'
import { listingPhotos, thumbnailUrl } from './listingPhotos'

describe('listingPhotos', () => {
  it('puts the book cover first, ahead of uploaded photos', () => {
    expect(listingPhotos({
      cover_url: 'cover.jpg', photo_url: 'a.jpg', photo_url_2: 'b.jpg', photo_url_3: null,
    })).toEqual(['cover.jpg', 'a.jpg', 'b.jpg'])
  })

  it('uses only uploaded photos when there is no cover', () => {
    expect(listingPhotos({
      cover_url: null, photo_url: 'a.jpg', photo_url_2: null, photo_url_3: 'c.jpg',
    })).toEqual(['a.jpg', 'c.jpg'])
  })

  it('uses only the cover when nothing was uploaded', () => {
    expect(listingPhotos({ cover_url: 'cover.jpg' })).toEqual(['cover.jpg'])
  })

  it('returns nothing when there is no cover or photo', () => {
    expect(listingPhotos({ cover_url: '', photo_url: null })).toEqual([])
  })

  it('drops an uploaded photo that repeats the cover', () => {
    expect(listingPhotos({
      cover_url: 'cover.jpg', photo_url: 'cover.jpg', photo_url_2: 'b.jpg',
    })).toEqual(['cover.jpg', 'b.jpg'])
  })
})

describe('thumbnailUrl', () => {
  it('uses the stock cover even when the seller uploaded a photo', () => {
    expect(thumbnailUrl({ cover_url: 'cover.jpg', photo_url: 'a.jpg' })).toBe('cover.jpg')
  })

  it("falls back to the seller's photo for listings with no cover", () => {
    expect(thumbnailUrl({ cover_url: null, photo_url: 'a.jpg' })).toBe('a.jpg')
  })

  it('returns null when there is neither', () => {
    expect(thumbnailUrl({ cover_url: '', photo_url: null })).toBeNull()
    expect(thumbnailUrl(null)).toBeNull()
  })
})
