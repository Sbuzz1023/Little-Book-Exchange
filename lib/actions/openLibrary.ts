'use server'

import { normalizeSearchResults, type BookSuggestion } from '@/lib/openLibrary'

export async function searchBooks(query: string): Promise<BookSuggestion[]> {
  const trimmed = query.trim().slice(0, 100)
  if (trimmed.length < 2) return []

  const contact = process.env.OPEN_LIBRARY_CONTACT_EMAIL || 'contact@example.com'
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(trimmed)}&fields=title,author_name,first_publish_year,isbn,cover_i,key&limit=8`

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': `LittleBookExchange/1.0 (contact: ${contact})` },
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = await res.json()
    return normalizeSearchResults(data.docs ?? [])
  } catch (err) {
    console.error('Open Library search failed:', err)
    return []
  }
}
