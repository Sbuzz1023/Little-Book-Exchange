import { describe, it, expect } from 'vitest'
import { fitWithin, resizedName } from './resizeImage'

describe('fitWithin', () => {
  it('scales a landscape phone photo so its long side is the max', () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 })
  })

  it('scales a portrait photo by its height', () => {
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 })
  })

  it('leaves an image that already fits alone', () => {
    expect(fitWithin(1200, 900, 1600)).toEqual({ width: 1200, height: 900 })
  })

  it('rounds to whole pixels and never goes below 1', () => {
    expect(fitWithin(5000, 3, 1600)).toEqual({ width: 1600, height: 1 })
  })
})

describe('resizedName', () => {
  it('swaps the extension for .jpg', () => {
    expect(resizedName('IMG_1234.HEIC')).toBe('IMG_1234.jpg')
    expect(resizedName('shelf.photo.png')).toBe('shelf.photo.jpg')
  })

  it('adds .jpg when there is no extension', () => {
    expect(resizedName('image')).toBe('image.jpg')
  })
})
