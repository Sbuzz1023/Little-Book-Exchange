'use client'

import { useState } from 'react'
import Image from 'next/image'

export default function PhotoGallery({
  photos, alt, gradient, children,
}: {
  photos: string[]
  alt: string
  gradient: string
  children?: React.ReactNode
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const active = photos[activeIndex] ?? null

  return (
    <>
      <div
        className="relative flex items-center justify-center text-[100px]"
        style={{ height: 280, background: gradient }}
      >
        {active ? (
          <Image src={active} alt={alt} fill className="object-contain" />
        ) : (
          <span>📚</span>
        )}
        {children}
      </div>

      {photos.length > 1 && (
        <div className="flex gap-2 px-5 py-3" style={{ background: '#fff', borderBottom: '2px solid #f3f4f6' }}>
          {photos.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => setActiveIndex(i)}
              className="relative shrink-0 overflow-hidden"
              style={{
                width: 56, height: 56, borderRadius: 10,
                border: i === activeIndex ? '2.5px solid #f97316' : '2.5px solid #e5e7eb',
                cursor: 'pointer', padding: 0, background: '#fff',
              }}
            >
              <Image src={url} alt={`${alt} photo ${i + 1}`} fill className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </>
  )
}
