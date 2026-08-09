'use client'

import { useState } from 'react'
import StateSelect from '@/components/StateSelect'
import BookSearchInput from '@/components/BookSearchInput'
import type { BookSuggestion } from '@/lib/openLibrary'

type Props = {
  addTbrEntry: (formData: FormData) => Promise<void>
  search?: (query: string) => Promise<BookSuggestion[]>
}

export default function TbrAddForm({ addTbrEntry, search }: Props) {
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
    <form action={addTbrEntry} className="flex gap-2 mb-4 flex-wrap items-start">
      <input type="hidden" name="ol_work_key" value={olWorkKey} />
      <input type="hidden" name="cover_url" value={coverUrl ?? ''} />
      <div className="flex-1" style={{ minWidth: 120, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        {coverUrl && (
          <img src={coverUrl} alt="Cover preview" style={{ width: 28, height: 40, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
        )}
        <BookSearchInput
          name="title"
          value={title}
          onChange={v => { setTitle(v); setOlWorkKey(''); setCoverUrl(null) }}
          onSelect={handleSelect}
          placeholder="Book title..."
          className="flex-1 border-2 border-[#ddd6fe] rounded-[12px] font-bold text-[13px] bg-[#f5f3ff]"
          style={{ padding: '9px 12px', minWidth: 120, width: '100%' }}
          search={search}
        />
      </div>
      <input
        name="author"
        placeholder="Author (optional)..."
        value={author}
        onChange={e => { setAuthor(e.target.value); setOlWorkKey(''); setCoverUrl(null) }}
        className="flex-1 border-2 border-[#ddd6fe] rounded-[12px] font-bold text-[13px] bg-[#f5f3ff]"
        style={{ padding: '9px 12px', minWidth: 120 }}
      />
      <input name="city" placeholder="City (optional)..."
        className="flex-1 border-2 border-[#ddd6fe] rounded-[12px] font-bold text-[13px] bg-[#f5f3ff]"
        style={{ padding: '9px 12px', minWidth: 100 }} />
      <StateSelect name="state" placeholder="Any state"
        className="flex-1 border-2 border-[#ddd6fe] rounded-[12px] font-bold text-[13px] bg-[#f5f3ff]"
        style={{ padding: '9px 12px', minWidth: 100 }} />
      <button type="submit" className="text-white font-extrabold text-[13px]"
        style={{ background: '#7c3aed', padding: '9px 18px', borderRadius: 12, border: 'none', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
        + Add
      </button>
    </form>
  )
}
