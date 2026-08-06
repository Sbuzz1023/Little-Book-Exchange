'use client'

import { useState, useRef } from 'react'

const DESCRIPTION_MAX_LENGTH = 500

const GENRES = [
  { key: 'Fiction', label: '📚 Fiction' },
  { key: 'Non-Fiction', label: '🌍 Non-Fiction' },
  { key: 'Mystery', label: '🔍 Mystery / Thriller' },
  { key: 'Sci-Fi', label: '🚀 Sci-Fi / Fantasy' },
  { key: 'Romance', label: '💕 Romance' },
  { key: "Children's", label: "👶 Children's" },
  { key: 'Biography', label: '📖 Biography' },
  { key: 'Self-Help', label: '🧠 Self-Help' },
  { key: 'History', label: '🏛️ History' },
  { key: 'Cooking', label: '🍳 Cooking' },
  { key: 'Art', label: '🎨 Art / Design' },
  { key: 'Other', label: '✨ Other' },
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
    books?: { title: string; author: string }[]
  }
  submitLabel?: string
}

function SectionHeading({ emoji, title }: { emoji: string; title: string }) {
  return (
    <div
      className="font-display text-[15px] text-bk-orange flex items-center gap-2"
      style={{ margin: '28px 0 16px', paddingBottom: 8, borderBottom: '2px dashed #fed7aa' }}
    >
      <span>{emoji}</span> {title}
    </div>
  )
}

function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <label
      className="block mb-1.5"
      style={{ fontSize: 12, fontWeight: 900, color: '#444', textTransform: 'uppercase', letterSpacing: '0.5px' }}
    >
      {children}
      {optional && <span style={{ color: '#bbb', fontWeight: 600, fontSize: 11, textTransform: 'none', letterSpacing: 0, marginLeft: 4 }}>(optional)</span>}
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

  return (
    <div
      style={{
        border: `2.5px dashed ${preview ? '#0d9488' : '#fed7aa'}`,
        borderRadius: 14,
        padding: preview ? 0 : (size === 'large' ? 28 : 16),
        textAlign: 'center',
        cursor: 'pointer',
        background: preview ? '#000' : '#fffbf0',
        position: 'relative',
        overflow: 'hidden',
        minHeight: preview ? (size === 'large' ? 180 : 100) : undefined,
      }}
      onClick={() => inputRef.current?.click()}
    >
      {preview ? (
        <>
          <img
            src={preview}
            alt={`${label} preview`}
            style={{ width: '100%', maxHeight: size === 'large' ? 260 : 140, objectFit: 'contain', display: 'block' }}
          />
          <div style={{
            position: 'absolute', bottom: 8, right: 8,
            background: 'rgba(0,0,0,0.6)', color: '#fff',
            padding: '4px 10px', borderRadius: 999,
            fontSize: 11, fontWeight: 700,
          }}>
            📸 Change
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: size === 'large' ? 36 : 22, marginBottom: 8 }}>📸</div>
          <p className="text-[14px] font-bold" style={{ color: '#aaa' }}>
            <span style={{ color: '#f97316', fontWeight: 800 }}>Click to upload</span> {label}
          </p>
          {size === 'large' && (
            <p className="text-[12px] font-semibold mt-1.5" style={{ color: '#aaa' }}>JPG or PNG · Max 5MB</p>
          )}
        </>
      )}
      <input
        ref={inputRef}
        name={name}
        type="file"
        accept="image/*"
        onChange={onChange}
        className="absolute inset-0 opacity-0 cursor-pointer"
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}

const inputStyle = {
  width: '100%',
  border: '2px solid #fed7aa',
  borderRadius: 14,
  padding: '12px 16px',
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 700,
  background: '#fffbf0',
  color: '#2d2d2d',
  outline: 'none',
} as React.CSSProperties

export default function PostForm({ city, action, error, initialValues, submitLabel }: Props) {
  const [genre, setGenre] = useState(initialValues?.genre ?? 'Fiction')
  const [format, setFormat] = useState(initialValues?.format ?? 'Paperback')
  const [title, setTitle] = useState(initialValues?.title ?? '')
  const [author, setAuthor] = useState(initialValues?.author ?? '')
  const [condition, setCondition] = useState(initialValues?.condition ?? 'Good')
  const [description, setDescription] = useState(initialValues?.description ?? '')
  const [photoPreview, setPhotoPreview] = useState<string | null>(initialValues?.photo_url ?? null)
  const [photo2Preview, setPhoto2Preview] = useState<string | null>(initialValues?.photo_url_2 ?? null)
  const [photo3Preview, setPhoto3Preview] = useState<string | null>(initialValues?.photo_url_3 ?? null)
  const [isBundle, setIsBundle] = useState(initialValues?.is_bundle ?? false)
  const [bundleName, setBundleName] = useState(initialValues?.bundle_name ?? '')
  const [books, setBooks] = useState<{ title: string; author: string }[]>(initialValues?.books ?? [])

  const MAX_BUNDLE_BOOKS = 20

  function toggleBundle() {
    setIsBundle(b => {
      const next = !b
      if (!next) { setBooks([]); setBundleName('') }
      return next
    })
  }
  function updateBook(i: number, next: { title: string; author: string }) {
    setBooks(prev => prev.map((b, idx) => (idx === i ? next : b)))
  }
  function addBook() {
    setBooks(prev => (prev.length >= MAX_BUNDLE_BOOKS ? prev : [...prev, { title, author }]))
  }
  function removeBook(i: number) {
    setBooks(prev => prev.filter((_, idx) => idx !== i))
  }

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

      <div
        className="bg-white border-2 border-gray-100 shadow-[0_8px_0_#e5e7eb] p-5 md:p-9"
        style={{ borderRadius: 28 }}
      >
        {/* Book Info */}
        <SectionHeading emoji="📖" title="Book Info" />

        <div style={{ marginBottom: 18 }}>
          <FieldLabel>Book Title *</FieldLabel>
          <input
            name="title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. The Great Gatsby"
            required
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: 18 }}>
          <FieldLabel>Author *</FieldLabel>
          <input
            name="author"
            value={author}
            onChange={e => setAuthor(e.target.value)}
            placeholder="e.g. F. Scott Fitzgerald"
            required
            style={inputStyle}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-[14px] mb-[18px]">
          <div>
            <FieldLabel>Format</FieldLabel>
            <div className="flex gap-2 flex-wrap">
              {['Paperback', 'Hardcover'].map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  style={{
                    padding: '9px 18px',
                    borderRadius: 999,
                    fontWeight: 800,
                    fontSize: 13,
                    border: '2px solid',
                    borderColor: format === f ? '#f97316' : '#e5e7eb',
                    background: format === f ? '#f97316' : '#fff',
                    color: format === f ? '#fff' : '#555',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'all 0.12s',
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div>
            <FieldLabel optional>Year</FieldLabel>
            <input
              name="year"
              type="number"
              placeholder="e.g. 2019"
              min={1800}
              max={2026}
              style={inputStyle}
            />
          </div>
        </div>

        {/* Bundle toggle */}
        <div style={{ marginBottom: 18 }}>
          <button
            type="button"
            onClick={toggleBundle}
            style={{
              width: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 18px',
              borderRadius: 14,
              border: `2px solid ${isBundle ? '#f97316' : '#e5e7eb'}`,
              background: isBundle ? '#fff7ed' : '#fff',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <span style={{ fontWeight: 900, fontSize: 14, color: isBundle ? '#c2410c' : '#555' }}>
              📚 List as a Bundle / Series
            </span>
            <span
              style={{
                width: 44, height: 26, borderRadius: 999,
                background: isBundle ? '#f97316' : '#e5e7eb',
                position: 'relative', transition: 'background 0.15s', flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: 'absolute', top: 3, left: isBundle ? 21 : 3,
                  width: 20, height: 20, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }}
              />
            </span>
          </button>
        </div>

        {isBundle && (
          <div style={{ marginBottom: 18, borderTop: '2px dashed #fed7aa', paddingTop: 16 }}>
            <p style={{ fontSize: 11, fontWeight: 900, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
              📚 Bundle Details
            </p>
            <div style={{ marginBottom: 18 }}>
              <FieldLabel optional>Series / Bundle Name</FieldLabel>
              <input
                name="bundle_name"
                value={bundleName}
                onChange={e => setBundleName(e.target.value)}
                placeholder="e.g. Harry Potter Complete Series"
                style={inputStyle}
              />
            </div>

            {books.map((book, i) => (
              <div key={i} style={{ marginBottom: 14, padding: 14, border: '2px solid #fed7aa', borderRadius: 14, background: '#fffbf0' }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 900, color: '#aaa', textTransform: 'uppercase' }}>Book {i + 2}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateBook(i, { title, author })}
                      style={{ background: 'none', border: 'none', color: '#f97316', fontWeight: 800, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      ✨ Auto-fill from Book 1
                    </button>
                    <button
                      type="button"
                      onClick={() => removeBook(i)}
                      style={{ background: 'none', border: 'none', color: '#e11d48', fontWeight: 800, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      ✕ Remove
                    </button>
                  </div>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <input
                    name={`book_title_${i + 1}`}
                    value={book.title}
                    onChange={e => updateBook(i, { title: e.target.value, author: book.author })}
                    placeholder="Book title"
                    style={inputStyle}
                  />
                </div>
                <input
                  name={`book_author_${i + 1}`}
                  value={book.author}
                  onChange={e => updateBook(i, { title: book.title, author: e.target.value })}
                  placeholder="Author"
                  style={inputStyle}
                />
              </div>
            ))}

            {books.length < MAX_BUNDLE_BOOKS && (
              <button
                type="button"
                onClick={addBook}
                style={{
                  width: '100%', padding: '10px', borderRadius: 12,
                  border: '2px dashed #fed7aa', background: '#fffbf0',
                  color: '#f97316', fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                  marginBottom: 14,
                }}
              >
                + Add Another Book
              </button>
            )}

            <div style={{ background: '#fff7ed', border: '2px solid #fed7aa', borderRadius: 12, padding: '10px 16px', fontWeight: 900, fontSize: 13, color: '#c2410c' }}>
              This bundle: {books.length + 1} book{books.length === 0 ? '' : 's'} · {books.length + 1} credit{books.length === 0 ? '' : 's'}
            </div>
          </div>
        )}

        {/* Genre */}
        <SectionHeading emoji="🏷️" title="Genre *" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 4 }}>
          {GENRES.map(g => (
            <button
              key={g.key}
              type="button"
              onClick={() => setGenre(g.key)}
              style={{
                padding: '8px 14px',
                borderRadius: 12,
                fontWeight: 800,
                fontSize: 12,
                border: '2px solid',
                borderColor: genre === g.key ? '#fed7aa' : '#e5e7eb',
                background: genre === g.key ? '#fff7ed' : '#fff',
                color: genre === g.key ? '#c2410c' : '#555',
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'center',
                transition: 'all 0.12s',
              }}
            >
              {g.label}
            </button>
          ))}
        </div>

        {/* Condition */}
        <SectionHeading emoji="📋" title="Condition" />

        <div style={{ marginBottom: 18 }}>
          <FieldLabel>Condition *</FieldLabel>
          <select
            name="condition"
            value={condition}
            onChange={e => setCondition(e.target.value)}
            required
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="Good">Good — barely used</option>
            <option value="Fair">Fair — some wear</option>
            <option value="Well-Loved">Well-Loved — lots of character</option>
          </select>
        </div>

        {/* Pricing notice */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14,
          background: '#fff7ed', border: '2px solid #fed7aa', borderRadius: 14,
          padding: '14px 18px', marginBottom: 18,
        }}>
          <span style={{ fontSize: 28 }}>🪙</span>
          <div>
            <p style={{ fontWeight: 900, fontSize: 14, color: '#c2410c', marginBottom: 2 }}>All books are listed at 1 credit</p>
            <p style={{ fontWeight: 600, fontSize: 12, color: '#aaa' }}>Credits cost $5 each — buyers use 1 credit to claim any book.</p>
          </div>
        </div>

        {/* Extra Details */}
        <SectionHeading emoji="📝" title="Extra Details" />

        <div style={{ marginBottom: 18 }}>
          <FieldLabel optional>Description</FieldLabel>
          <textarea
            name="description"
            rows={3}
            maxLength={DESCRIPTION_MAX_LENGTH}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Any notes — edition, highlighting, pickup preferences..."
            style={{ ...inputStyle, resize: 'none' }}
          />
          <p style={{ fontSize: 11, fontWeight: 700, color: '#bbb', textAlign: 'right', marginTop: 4 }}>
            {description.length}/{DESCRIPTION_MAX_LENGTH}
          </p>
        </div>

        <div style={{ marginBottom: 18 }}>
          <FieldLabel optional>Pickup Spot for This Book</FieldLabel>
          <input
            name="pickup_description"
            type="text"
            defaultValue={initialValues?.pickup_description ?? ''}
            placeholder="e.g. front porch, side gate — overrides your profile default"
            style={inputStyle}
          />
          <p style={{ fontSize: 11, color: '#bbb', fontWeight: 600, marginTop: 5 }}>
            🏠 Shared with the buyer after you approve their purchase. Overrides your profile pickup spot for this book only.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 4 }}>
          <div>
            <FieldLabel optional>ISBN</FieldLabel>
            <input name="isbn" type="text" placeholder="978-..." style={inputStyle} />
          </div>
          <div>
            <FieldLabel optional>Language</FieldLabel>
            <select name="language" style={{ ...inputStyle, cursor: 'pointer' }}>
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
        <SectionHeading emoji="📸" title="Photo" />

        <div style={{ marginBottom: 12 }}>
          <PhotoUploadSlot
            name="photo"
            label="a cover photo of your book"
            preview={photoPreview}
            onChange={makePhotoHandler(setPhotoPreview)}
            size="large"
          />
        </div>

        <div className="grid grid-cols-2 gap-3" style={{ marginBottom: 16 }}>
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
        <div
          style={{
            background: '#fff7ed',
            border: '2px solid #fed7aa',
            borderRadius: 14,
            padding: '16px 20px',
            marginBottom: 16,
          }}
        >
          <p className="text-[13px] font-bold mb-1" style={{ color: '#c2410c' }}>Your listing will appear as:</p>
          <p className="text-[12px] font-semibold" style={{ color: '#aaa' }}>
            {title || 'Your Book'} · {author || 'Author'} · {genre} · {format} · {condition} condition · <span style={{ color: '#f97316', fontWeight: 800 }}>{isBundle ? `${books.length + 1} credit${books.length === 0 ? '' : 's'}` : '1 credit'}</span> · {city || 'your city'}
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-red-700 font-bold text-sm mb-4">
            {error}
          </div>
        )}

        <button
          type="submit"
          className="w-full text-white font-black text-[17px] shadow-[0_5px_0_#c2410c] hover:shadow-[0_3px_0_#c2410c] hover:translate-y-0.5 transition-all"
          style={{
            background: '#f97316',
            padding: 16,
            borderRadius: 14,
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {submitLabel ?? 'Post My Book →'}
        </button>
      </div>
    </form>
  )
}
