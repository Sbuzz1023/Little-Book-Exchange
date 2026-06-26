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
  const router = useRouter()

  return (
    <div className="relative mx-auto" style={{ maxWidth: 680 }}>
      <style>{`#hero-search::placeholder { color: rgba(255,255,255,0.6); }`}</style>

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

      {/* Book overlays */}
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

      {/* Search bar — covers the blue search book */}
      <form
        action="/listings"
        method="get"
        className="absolute flex items-center gap-2"
        style={{
          left: '30%',
          top: '80%',
          width: '40%',
          height: '6%',
          background: '#253c6e',
          border: '2px solid rgba(255,255,255,0.55)',
          borderRadius: 10,
          padding: '0 8px 0 12px',
        }}
      >
        <span style={{ fontSize: 15, flexShrink: 0, opacity: 0.9 }}>🔍</span>
        <input
          name="title"
          type="text"
          id="hero-search"
          placeholder="Search books..."
          className="flex-1 bg-transparent font-bold focus:outline-none"
          style={{
            border: 'none',
            fontSize: 15,
            minWidth: 0,
            color: '#fff',
            caretColor: '#fff',
          }}
        />
        <button
          type="submit"
          className="font-extrabold shrink-0"
          style={{
            background: 'rgba(255,255,255,0.25)',
            border: '1.5px solid rgba(255,255,255,0.6)',
            borderRadius: 7,
            color: '#fff',
            fontSize: 14,
            cursor: 'pointer',
            padding: '3px 10px',
            fontFamily: 'inherit',
          }}
        >
          Go
        </button>
      </form>

    </div>
  )
}
