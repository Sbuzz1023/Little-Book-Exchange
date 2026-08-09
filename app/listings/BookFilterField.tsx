'use client'

import { useState } from 'react'
import BookSearchInput from '@/components/BookSearchInput'
import type { BookSuggestion } from '@/lib/openLibrary'

type Props = {
  defaultValue: string
  style: React.CSSProperties
  search?: (query: string) => Promise<BookSuggestion[]>
}

export default function BookFilterField({ defaultValue, style, search }: Props) {
  const [title, setTitle] = useState(defaultValue)
  const [olWorkKey, setOlWorkKey] = useState('')

  return (
    <>
      <input type="hidden" name="ol_work_key" value={olWorkKey} />
      <BookSearchInput
        name="title"
        value={title}
        onChange={v => { setTitle(v); setOlWorkKey('') }}
        onSelect={b => { setTitle(b.title); setOlWorkKey(b.workKey) }}
        placeholder="e.g. Great Gatsby..."
        style={style}
        search={search}
      />
    </>
  )
}
