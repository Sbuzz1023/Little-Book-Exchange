'use client'

import { useState } from 'react'
import StateSelect from '@/components/StateSelect'
import BookSearchInput from '@/components/BookSearchInput'
import type { BookSuggestion } from '@/lib/openLibrary'

type Props = {
  addTbrEntry: (formData: FormData) => Promise<void>
  search?: (query: string) => Promise<BookSuggestion[]>
  // The signed-in user's city/state, so matches default to their own area.
  // Still editable: clearing them means "notify me wherever it's listed".
  defaultCity?: string
  defaultState?: string
}

export default function TbrAddForm({ addTbrEntry, search, defaultCity = '', defaultState = '' }: Props) {
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [olWorkKey, setOlWorkKey] = useState('')
  const [coverUrl, setCoverUrl] = useState<string | null>(null)

  function handleSelect(book: BookSuggestion) {
    setTitle(book.title)
    setAuthor(book.author)
    setOlWorkKey(book.workKey)
    setCoverUrl(book.coverUrl)
  }

  return (
    <form action={addTbrEntry} className="dash-tbr-form flex gap-2 flex-wrap items-start">
      <input type="hidden" name="ol_work_key" value={olWorkKey} />
      <input type="hidden" name="cover_url" value={coverUrl ?? ''} />
      {/* Title gets twice the share of the row. The search box must be able to
          shrink (minWidth 0) to make room for the cover thumbnail that appears after
          a book is picked; with its own 120px minimum it overflowed onto Author. */}
      <div style={{ flex: '2 1 0%', minWidth: 160, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        {coverUrl && (
          <img src={coverUrl} alt="Cover preview" className="dash-tbr-preview" />
        )}
        <div style={{ flex: '1 1 0%', minWidth: 0 }}>
          <BookSearchInput
            name="title"
            value={title}
            onChange={v => { setTitle(v); setOlWorkKey(''); setCoverUrl(null) }}
            onSelect={handleSelect}
            placeholder="Book title..."
            className="dash-tbr-input"
            style={{ minWidth: 0, width: '100%' }}
            search={search}
          />
        </div>
      </div>
      <input
        name="author"
        placeholder="Author (optional)..."
        value={author}
        onChange={e => { setAuthor(e.target.value); setOlWorkKey(''); setCoverUrl(null) }}
        className="dash-tbr-input flex-1"
        style={{ minWidth: 120 }}
      />
      <input name="city" placeholder="City (blank = anywhere)" defaultValue={defaultCity}
        className="dash-tbr-input flex-1"
        style={{ minWidth: 100 }} />
      <StateSelect name="state" placeholder="Any state" defaultValue={defaultState}
        className="dash-tbr-input flex-1"
        style={{ minWidth: 100 }} />
      <button type="submit" className="btn btn-primary dash-tbr-add">
        + Add
      </button>
    </form>
  )
}
