'use client'

import { useState } from 'react'
import Image from 'next/image'

export default function PhotoGallery({
  photos, stockUrl, alt, children,
}: {
  photos: string[]
  // The Open Library cover, if one is in `photos` — labelled so buyers don't
  // mistake it for a photo of the seller's actual copy.
  stockUrl?: string | null
  alt: string
  children?: React.ReactNode
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const active = photos[activeIndex] ?? null
  const hasStock = !!stockUrl && photos.includes(stockUrl)
  const sellerPhotos = photos.filter(url => url !== stockUrl)

  return (
    <>
      <div className="ld-cover">
        {active ? (
          <div className="ld-cover-img">
            <Image src={active} alt={alt} fill className="object-contain" />
          </div>
        ) : (
          // No photo or Open Library cover — show the title in its place.
          <span className="ld-cover-fallback">{alt}</span>
        )}
        {children}
      </div>

      {hasStock && active === stockUrl && (
        <p className="ld-stock-caption" data-testid="stock-caption">
          <strong>Stock cover image</strong> — {sellerPhotos.length > 0
            ? "tap the other photos to see the seller's copy."
            : "the seller hasn't added photos of their copy."}
        </p>
      )}

      {photos.length > 1 && (
        <div className="ld-thumbs">
          {photos.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => setActiveIndex(i)}
              className={`ld-thumb${i === activeIndex ? ' on' : ''}`}
              aria-label={url === stockUrl ? 'Show stock cover image' : `Show seller photo ${sellerPhotos.indexOf(url) + 1}`}
              aria-pressed={i === activeIndex}
            >
              <Image src={url} alt="" fill className="object-cover" />
              {url === stockUrl && <span className="ld-thumb-stock" aria-hidden="true">Stock</span>}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
