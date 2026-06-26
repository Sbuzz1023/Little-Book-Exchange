'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const BOOKS = [
  {
    id: 'browse',
    href: '/listings',
    label: 'Browse books',
    left: '31%',
    color: 'rgba(34,197,94,0.3)',
    shadow: '0 10px 32px rgba(34,197,94,0.55)',
  },
  {
    id: 'post',
    href: '/post',
    label: 'List a book',
    left: '42%',
    color: 'rgba(234,179,8,0.35)',
    shadow: '0 10px 32px rgba(234,179,8,0.6)',
  },
  {
    id: 'how',
    href: '#how-it-works',
    label: 'How it works',
    left: '52%',
    color: 'rgba(239,68,68,0.3)',
    shadow: '0 10px 32px rgba(239,68,68,0.55)',
  },
  {
    id: 'guide',
    href: '#how-it-works',
    label: 'Site guide',
    left: '62%',
    color: 'rgba(168,85,247,0.3)',
    shadow: '0 10px 32px rgba(168,85,247,0.55)',
  },
]

export default function HeroBookshelf() {
  const [hovered, setHovered] = useState<string | null>(null)
  const [city, setCity] = useState('')
  const router = useRouter()

  function doSearch(e?: React.FormEvent) {
    if (e) e.preventDefault()
    router.push(city.trim() ? `/listings?city=${encodeURIComponent(city.trim())}` : '/listings')
  }

  return (
    <>
      <div className="relative mx-auto" style={{ maxWidth: 680 }}>
        {/* Ground shadow */}
        <div
          className="absolute pointer-events-none"
          style={{
            bottom: -18,
            left: '14%',
            right: '14%',
            height: 52,
            background: 'rgba(30,30,30,0.22)',
            filter: 'blur(28px)',
            borderRadius: '50%',
          }}
        />

        {/* Image */}
        <Image
          src="/hero-bg.jpeg"
          alt="Browse, list, and search books in your community"
          width={680}
          height={680}
          priority
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            mixBlendMode: 'multiply',
            position: 'relative',
          }}
        />

        {/* Clickable book overlays */}
        {BOOKS.map(book => (
          <Link
            key={book.id}
            href={book.href}
            aria-label={book.label}
            onMouseEnter={() => setHovered(book.id)}
            onMouseLeave={() => setHovered(null)}
            style={{
              position: 'absolute',
              left: book.left,
              top: '42%',
              width: '7%',
              height: '31%',
              borderRadius: 10,
              transformOrigin: 'center bottom',
              transition: 'transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease',
              transform: hovered === book.id
                ? 'scale(1.09) translateY(-10px)'
                : 'scale(1) translateY(0)',
              background: hovered === book.id ? book.color : 'transparent',
              boxShadow: hovered === book.id ? book.shadow : 'none',
            }}
          />
        ))}

        {/* Search book — clickable area where the search form used to live */}
        <button
          aria-label="Search books"
          onClick={doSearch}
          onMouseEnter={() => setHovered('search')}
          onMouseLeave={() => setHovered(null)}
          style={{
            position: 'absolute',
            left: '30%',
            top: '80%',
            width: '40%',
            height: '6%',
            borderRadius: 10,
            border: 'none',
            cursor: 'pointer',
            background: hovered === 'search' ? 'rgba(37,60,110,0.35)' : 'transparent',
            boxShadow: hovered === 'search' ? '0 8px 24px rgba(37,60,110,0.5)' : 'none',
            transition: 'background 0.15s ease, box-shadow 0.15s ease',
          }}
        />
      </div>

      {/* Search bar below the library */}
      <form
        onSubmit={doSearch}
        className="mt-6 max-w-[520px] mx-auto flex items-center gap-3 bg-white rounded-2xl px-4 py-[14px] border-2 border-[#fed7aa]"
        style={{ boxShadow: '0 4px 0 rgba(249,115,22,0.2)' }}
      >
        <span className="text-[20px] shrink-0">📍</span>
        <input
          value={city}
          onChange={e => setCity(e.target.value)}
          placeholder="Search books by city..."
          className="flex-1 bg-transparent font-bold focus:outline-none text-[15px]"
          style={{ border: 'none', minWidth: 0, color: '#2d2d2d' }}
        />
        <button
          type="submit"
          className="bg-bk-orange text-white font-extrabold text-[14px] rounded-xl shrink-0"
          style={{
            padding: '9px 18px',
            border: 'none',
            boxShadow: '0 3px 0 #c2410c',
            cursor: 'pointer',
          }}
        >
          Find Books
        </button>
      </form>
    </>
  )
}
