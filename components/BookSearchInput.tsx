'use client'

import { useState, useRef, useEffect } from 'react'
import type { BookSuggestion } from '@/lib/openLibrary'
import { searchBooks } from '@/lib/actions/openLibrary'

type Props = {
  name: string
  value: string
  onChange: (value: string) => void
  onSelect: (book: BookSuggestion) => void
  placeholder?: string
  required?: boolean
  className?: string
  style?: React.CSSProperties
  search?: (query: string) => Promise<BookSuggestion[]>
}

const DEBOUNCE_MS = 300

export default function BookSearchInput({
  name, value, onChange, onSelect, placeholder, required, className, style,
  search = searchBooks,
}: Props) {
  const [suggestions, setSuggestions] = useState<BookSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  function handleChange(next: string) {
    onChange(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (next.trim().length < 2) {
      requestIdRef.current++ // invalidate any in-flight request so a late response can't repopulate the dropdown
      setSuggestions([])
      setOpen(false)
      return
    }
    const thisRequest = ++requestIdRef.current
    debounceRef.current = setTimeout(async () => {
      const results = await search(next)
      if (thisRequest !== requestIdRef.current) return // a newer keystroke superseded this request
      setSuggestions(results)
      setOpen(results.length > 0)
    }, DEBOUNCE_MS)
  }

  function handleSelect(book: BookSuggestion) {
    setSuggestions([])
    setOpen(false)
    onSelect(book)
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        name={name}
        value={value}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => setOpen(suggestions.length > 0)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        required={required}
        className={className}
        autoComplete="off"
        style={style}
      />
      {open && (
        <ul
          role="listbox"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
            background: '#fff', border: '2px solid #fed7aa', borderRadius: 12,
            marginTop: 4, maxHeight: 260, overflowY: 'auto', listStyle: 'none',
            padding: 4, boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
          }}
        >
          {suggestions.map(s => (
            <li key={s.workKey}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()} // keep focus so onBlur doesn't close the list before onClick fires
                onClick={() => handleSelect(s)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '6px 8px', background: 'none', border: 'none', cursor: 'pointer',
                  textAlign: 'left', fontFamily: 'inherit', borderRadius: 8,
                }}
              >
                {s.coverUrl ? (
                  <img src={s.coverUrl} alt="" style={{ width: 26, height: 38, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} />
                ) : (
                  <span style={{ width: 26, height: 38, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>📖</span>
                )}
                <span style={{ fontSize: 13 }}>
                  <strong>{s.title}</strong>
                  {s.author && <span style={{ color: '#888' }}> — {s.author}</span>}
                  {s.year && <span style={{ color: '#bbb' }}> ({s.year})</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
