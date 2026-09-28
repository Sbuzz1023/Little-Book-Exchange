'use client'

import { useState } from 'react'
import Image from 'next/image'

export default function PhotoGallery({
  photos, alt, children,
}: {
  photos: string[]
  alt: string
  children?: React.ReactNode
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const active = photos[activeIndex] ?? null

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

      {photos.length > 1 && (
        <div className="ld-thumbs">
          {photos.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => setActiveIndex(i)}
              className={`ld-thumb${i === activeIndex ? ' on' : ''}`}
              aria-label={`Show photo ${i + 1}`}
              aria-pressed={i === activeIndex}
            >
              <Image src={url} alt={`${alt} photo ${i + 1}`} fill className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </>
  )
}
