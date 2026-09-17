'use client'

import { useState, useRef } from 'react'
import BookSearchInput from '@/components/BookSearchInput'
import type { BookSuggestion } from '@/lib/openLibrary'
import '../home.css'
import './postform.css'

const DESCRIPTION_MAX_LENGTH = 500

const GENRES = [
  { key: 'Fiction', label: 'Fiction' },
  { key: 'Non-Fiction', label: 'Non-Fiction' },
  { key: 'Mystery', label: 'Mystery / Thriller' },
  { key: 'Sci-Fi', label: 'Sci-Fi / Fantasy' },
  { key: 'Romance', label: 'Romance' },
  { key: "Children's", label: "Children's" },
  { key: 'Biography', label: 'Biography' },
  { key: 'Self-Help', label: 'Self-Help' },
  { key: 'History', label: 'History' },
  { key: 'Cooking', label: 'Cooking' },
  { key: 'Art', label: 'Art / Design' },
  { key: 'Other', label: 'Other' },
]

type Props = {
  city?: string
  action: (formData: FormData) => Promise<void>
  error?: string
  initialValues?: {
    title: string
    author: string
    condition: string
    genre: string
    format: string
    description: string | null
    pickup_description: string | null
    photo_url: string | null
    photo_url_2: string | null
    photo_url_3: string | null
    is_bundle?: boolean
    bundle_name?: string | null
    books?: { title: string; author: string; ol_work_key?: string | null; cover_url?: string | null }[]
    ol_work_key?: string | null
    cover_url?: string | null
    isbn?: string | null
  }
  submitLabel?: string
  search?: (query: string) => Promise<BookSuggestion[]>
}

function BookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  )
}

function ImageIcon({ size = 20 }: { size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M21 17l-5-4-4 3-3-2-6 5" />
    </svg>
  )
}

function CoinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v10M9 9.5c0-1.4 1.3-2.5 3-2.5s3 1 3 2.2c0 2.8-6 1.5-6 4.3 0 1.2 1.3 2.2 3 2.2s3-1.1 3-2.5" />
    </svg>
  )
}

function SectionHeading({ title }: { title: string }) {
  return <div className="pf-section-h">{title}</div>
}

function SelectedBookCard({
  title, author, coverUrl, onChangeBook,
}: {
  title: string
  author: string
  coverUrl: string | null
  onChangeBook: () => void
}) {
  return (
    <div className="pf-book-card">
      {coverUrl ? (
        <img src={coverUrl} alt="Cover preview" className="cover" />
      ) : (
        <span className="cover-fallback"><BookIcon /></span>
      )}
      <div className="info">
        <p className="t">{title}</p>
        <p className="a">{author}</p>
      </div>
      <button type="button" onClick={onChangeBook} className="change">Change</button>
    </div>
  )
}

function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <label className="pf-f-label">
      {children}
      {optional && <span className="opt">(optional)</span>}
    </label>
  )
}

function PhotoUploadSlot({
  name, label, preview, onChange, size,
}: {
  name: string
  label: string
  preview: string | null
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  size: 'large' | 'small'
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const sizeClass = size === 'large' ? 'big' : 'small'

  return (
    <div className={`pf-photo-slot ${sizeClass}${preview ? ' filled' : ''}`} onClick={() => inputRef.current?.click()}>
      {preview ? (
        <>
          <img src={preview} alt={`${label} preview`} />
          <div className="change-tag">Change</div>
        </>
      ) : (
        <>
          <ImageIcon size={size === 'large' ? 32 : 20} />
          <p className="cta"><span>Click to upload</span> {label}</p>
          {size === 'large' && <p className="note">JPG or PNG · Max 5MB</p>}
        </>
      )}
      <input ref={inputRef} name={name} type="file" accept="image/*" onChange={onChange} />
    </div>
  )
}

export default function PostForm({ city, action, error, initialValues, submitLabel, search }: Props) {
  const [genre, setGenre] = useState(initialValues?.genre ?? 'Fiction')
  const [format, setFormat] = useState(initialValues?.format ?? 'Paperback')
  const [title, setTitle] = useState(initialValues?.title ?? '')
  const [author, setAuthor] = useState(initialValues?.author ?? '')
  const [authorQuery, setAuthorQuery] = useState('')
  const [olWorkKey, setOlWorkKey] = useState(initialValues?.ol_work_key ?? '')
  const [coverUrl, setCoverUrl] = useState<string | null>(initialValues?.cover_url ?? null)
  const [isbn, setIsbn] = useState(initialValues?.isbn ?? '')
  const [condition, setCondition] = useState(initialValues?.condition ?? 'Good')
  const [description, setDescription] = useState(initialValues?.description ?? '')
  const [photoPreview, setPhotoPreview] = useState<string | null>(initialValues?.photo_url ?? null)
  const [photo2Preview, setPhoto2Preview] = useState<string | null>(initialValues?.photo_url_2 ?? null)
  const [photo3Preview, setPhoto3Preview] = useState<string | null>(initialValues?.photo_url_3 ?? null)
  const [isBundle, setIsBundle] = useState(initialValues?.is_bundle ?? false)
  const [bundleName, setBundleName] = useState(initialValues?.bundle_name ?? '')
  const [books, setBooks] = useState<{ title: string; author: string; ol_work_key: string; cover_url: string | null; authorQuery: string }[]>(
    initialValues?.books?.map(b => ({ ...b, ol_work_key: b.ol_work_key ?? '', cover_url: b.cover_url ?? null, authorQuery: '' })) ?? []
  )

  const MAX_BUNDLE_BOOKS = 20

  function selectBook(book: BookSuggestion) {
    setTitle(book.title)
    setAuthor(book.author)
    setOlWorkKey(book.workKey)
    setCoverUrl(book.coverUrl)
    if (book.genre) setGenre(book.genre)
    setIsbn(book.isbn ?? '')
  }

  function clearMainSelection() {
    setTitle('')
    setAuthor('')
    setAuthorQuery('')
    setOlWorkKey('')
    setCoverUrl(null)
    setIsbn('')
  }

  function toggleBundle() {
    setIsBundle(b => {
      const next = !b
      if (!next) { setBooks([]); setBundleName('') }
      return next
    })
  }
  function updateBook(i: number, next: Partial<{ title: string; author: string; ol_work_key: string; cover_url: string | null; authorQuery: string }>) {
    setBooks(prev => prev.map((b, idx) => (idx === i ? { ...b, ...next } : b)))
  }
  function addBook() {
    setBooks(prev => (prev.length >= MAX_BUNDLE_BOOKS ? prev : [...prev, { title: '', author: '', ol_work_key: '', cover_url: null, authorQuery: '' }]))
  }
  function removeBook(i: number) {
    setBooks(prev => prev.filter((_, idx) => idx !== i))
  }

  const mainMatched = !!olWorkKey
  const bundleMatched = books.every(b => !!b.ol_work_key)
  const canSubmit = mainMatched && (!isBundle || bundleMatched)

  function makePhotoHandler(setPreview: (url: string | null) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) { setPreview(null); return }
      setPreview(URL.createObjectURL(file))
    }
  }

  return (
    <form action={action}>
      <input type="hidden" name="genre" value={genre} />
      <input type="hidden" name="format" value={format} />
      <input type="hidden" name="price" value="1" />
      <input type="hidden" name="is_bundle" value={isBundle ? 'true' : 'false'} />
      <input type="hidden" name="book_rows" value={books.length} />
      <input type="hidden" name="title" value={title} />
      <input type="hidden" name="author" value={author} />
      <input type="hidden" name="ol_work_key" value={olWorkKey} />
      <input type="hidden" name="cover_url" value={coverUrl ?? ''} />

      <div className="pf-card">
        {/* Book Info */}
        <SectionHeading title="Book Info" />

        <div className="pf-f-group">
          <FieldLabel>Book</FieldLabel>
          {olWorkKey ? (
            <SelectedBookCard title={title} author={author} coverUrl={coverUrl} onChangeBook={clearMainSelection} />
          ) : (
            <>
              <BookSearchInput
                name="title_search"
                value={title}
                onChange={v => { setTitle(v); setAuthor(''); setOlWorkKey(''); setCoverUrl(null) }}
                onSelect={selectBook}
                placeholder="e.g. The Great Gatsby"
                className="pf-input"
                search={search}
              />
              <p className="pf-divider">or search by author</p>
              <BookSearchInput
                name="author_search"
                value={authorQuery}
                onChange={setAuthorQuery}
                onSelect={book => { selectBook(book); setAuthorQuery('') }}
                placeholder="e.g. Agatha Christie"
                className="pf-input"
                search={search}
              />
              <p className="pf-hint">
                Search and select your book — title, author, and cover come from Open Library, so every listing stays spelled right.
              </p>
            </>
          )}
        </div>

        <div className="pf-two-col">
          <div>
            <FieldLabel>Format</FieldLabel>
            <div className="pf-pill-row">
              {['Paperback', 'Hardcover'].map(f => (
                <button key={f} type="button" onClick={() => setFormat(f)} className={`pf-pill${format === f ? ' on' : ''}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div>
            <FieldLabel optional>Year</FieldLabel>
            <input name="year" type="number" placeholder="e.g. 2019" min={1800} max={2026} className="pf-input" />
          </div>
        </div>

        {/* Bundle toggle */}
        <button type="button" onClick={toggleBundle} className="pf-bundle-toggle">
          <span className="lbl">List as a Bundle / Series</span>
          <span className={`pf-switch${isBundle ? ' on' : ''}`}><span className="knob" /></span>
        </button>

        {isBundle && (
          <div className="pf-bundle-details">
            <p className="eyebrow">Bundle Details</p>
            <div className="pf-f-group">
              <FieldLabel optional>Series / Bundle Name</FieldLabel>
              <input
                name="bundle_name"
                value={bundleName}
                onChange={e => setBundleName(e.target.value)}
                placeholder="e.g. Harry Potter Complete Series"
                className="pf-input"
              />
            </div>

            {books.map((book, i) => (
              <div key={i} className="pf-bundle-row">
                <div className="row-head">
                  <span className="n">Book {i + 2}</span>
                  <button type="button" onClick={() => removeBook(i)} className="rm">Remove</button>
                </div>
                {book.ol_work_key ? (
                  <SelectedBookCard
                    title={book.title}
                    author={book.author}
                    coverUrl={book.cover_url}
                    onChangeBook={() => updateBook(i, { title: '', author: '', ol_work_key: '', cover_url: null, authorQuery: '' })}
                  />
                ) : (
                  <>
                    <BookSearchInput
                      name={`book_title_search_${i + 1}`}
                      value={book.title}
                      onChange={v => updateBook(i, { title: v, author: '', ol_work_key: '', cover_url: null })}
                      onSelect={s => updateBook(i, { title: s.title, author: s.author, ol_work_key: s.workKey, cover_url: s.coverUrl })}
                      placeholder="Title in series"
                      className="pf-input"
                      search={search}
                    />
                    <p className="pf-divider">or search by author</p>
                    <BookSearchInput
                      name={`book_author_search_${i + 1}`}
                      value={book.authorQuery}
                      onChange={v => updateBook(i, { authorQuery: v })}
                      onSelect={s => updateBook(i, { title: s.title, author: s.author, ol_work_key: s.workKey, cover_url: s.coverUrl, authorQuery: '' })}
                      placeholder="Author in series"
                      className="pf-input"
                      search={search}
                    />
                  </>
                )}
                <input type="hidden" name={`book_title_${i + 1}`} value={book.title} />
                <input type="hidden" name={`book_author_${i + 1}`} value={book.author} />
                <input type="hidden" name={`book_ol_work_key_${i + 1}`} value={book.ol_work_key} />
                <input type="hidden" name={`book_cover_url_${i + 1}`} value={book.cover_url ?? ''} />
              </div>
            ))}

            {books.length < MAX_BUNDLE_BOOKS && (
              <button type="button" onClick={addBook} className="pf-add-book">
                + Add Another Book
              </button>
            )}

            <div className="pf-bundle-total">
              This bundle: {books.length + 1} book{books.length === 0 ? '' : 's'} · {books.length + 1} credit{books.length === 0 ? '' : 's'}
            </div>
          </div>
        )}

        {/* Genre */}
        <SectionHeading title="Genre" />
        <div className="pf-genre-grid">
          {GENRES.map(g => (
            <button
              key={g.key}
              type="button"
              onClick={() => setGenre(g.key)}
              className={`pf-genre-opt${genre === g.key ? ' on' : ''}`}
            >
              {g.label}
            </button>
          ))}
        </div>

        {/* Condition */}
        <SectionHeading title="Condition" />

        <div className="pf-f-group">
          <FieldLabel>Condition</FieldLabel>
          <select name="condition" value={condition} onChange={e => setCondition(e.target.value)} required className="pf-input">
            <option value="Good">Good — barely used</option>
            <option value="Fair">Fair — some wear</option>
            <option value="Well-Loved">Well-Loved — lots of character</option>
          </select>
        </div>

        {/* Pricing notice */}
        <div className="pf-pricing">
          <span className="icon"><CoinIcon /></span>
          <div>
            <p className="t">All books are listed at 1 credit</p>
            <p className="s">Credits cost $5 each — buyers use 1 credit to claim any book.</p>
          </div>
        </div>

        {/* Extra Details */}
        <SectionHeading title="Extra Details" />

        <div className="pf-f-group">
          <FieldLabel optional>Description</FieldLabel>
          <textarea
            name="description"
            rows={3}
            maxLength={DESCRIPTION_MAX_LENGTH}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Any notes — edition, highlighting, pickup preferences..."
            className="pf-input"
            style={{ resize: 'none' }}
          />
          <p className="pf-hint" style={{ textAlign: 'right' }}>
            {description.length}/{DESCRIPTION_MAX_LENGTH}
          </p>
        </div>

        <div className="pf-f-group">
          <FieldLabel optional>Pickup Spot for This Book</FieldLabel>
          <input
            name="pickup_description"
            type="text"
            defaultValue={initialValues?.pickup_description ?? ''}
            placeholder="e.g. front porch, side gate — overrides your profile default"
            className="pf-input"
          />
          <p className="pf-hint">
            Shared with the buyer after you approve their purchase. Overrides your profile pickup spot for this book only.
          </p>
        </div>

        <div className="pf-two-col" style={{ marginBottom: 4 }}>
          <div>
            <FieldLabel optional>ISBN</FieldLabel>
            <input name="isbn" type="text" value={isbn} onChange={e => setIsbn(e.target.value)} placeholder="978-..." maxLength={20} className="pf-input" />
          </div>
          <div>
            <FieldLabel optional>Language</FieldLabel>
            <select name="language" className="pf-input">
              <option>English</option>
              <option>Spanish</option>
              <option>French</option>
              <option>German</option>
              <option>Portuguese</option>
              <option>Other</option>
            </select>
          </div>
        </div>

        {/* Photo */}
        <SectionHeading title="Photo" />
        <p className="pf-hint" style={{ marginTop: -10, marginBottom: 14 }}>
          This won&apos;t be the main photo on Browse — that always shows the official cover art. It&apos;ll still appear on your listing&apos;s page.
        </p>

        <div style={{ marginBottom: 12 }}>
          <PhotoUploadSlot
            name="photo"
            label="a cover photo of your book"
            preview={photoPreview}
            onChange={makePhotoHandler(setPhotoPreview)}
            size="large"
          />
        </div>

        <div className="pf-photo-row">
          <PhotoUploadSlot
            name="photo_2"
            label="Photo 2"
            preview={photo2Preview}
            onChange={makePhotoHandler(setPhoto2Preview)}
            size="small"
          />
          <PhotoUploadSlot
            name="photo_3"
            label="Photo 3"
            preview={photo3Preview}
            onChange={makePhotoHandler(setPhoto3Preview)}
            size="small"
          />
        </div>

        {/* Preview */}
        <div className="pf-preview-box">
          <p className="lbl">Your listing will appear as:</p>
          <p className="line">
            {title || 'Your Book'} · {author || 'Author'} · {genre} · {format} · {condition} condition · <b>{isBundle ? `${books.length + 1} credit${books.length === 0 ? '' : 's'}` : '1 credit'}</b> · {city || 'your city'}
          </p>
        </div>

        {error && <div className="pf-error-box">{error}</div>}

        {!canSubmit && (
          <p className="pf-blocked-msg">
            {!mainMatched
              ? 'Search and select your book above to continue.'
              : 'Every book in the bundle needs to be selected from search results too.'}
          </p>
        )}
        <button type="submit" disabled={!canSubmit} className="pf-submit-btn">
          {submitLabel ?? 'Post My Book →'}
        </button>
      </div>
    </form>
  )
}
