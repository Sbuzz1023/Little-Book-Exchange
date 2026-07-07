'use client'

import { useState, useRef } from 'react'

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

export default function PostForm({ city, action, error }: Props) {
  const [genre, setGenre] = useState('Fiction')
  const [format, setFormat] = useState('Paperback')
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [condition, setCondition] = useState('Good')
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) { setPhotoPreview(null); return }
    const url = URL.createObjectURL(file)
    setPhotoPreview(url)
  }

  return (
    <form action={action}>
      <input type="hidden" name="genre" value={genre} />
      <input type="hidden" name="format" value={format} />
      <input type="hidden" name="price" value="1" />

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
            placeholder="Any notes — edition, highlighting, pickup preferences..."
            style={{ ...inputStyle, resize: 'none' }}
          />
        </div>

        <div style={{ marginBottom: 18 }}>
          <FieldLabel optional>Pickup Spot for This Book</FieldLabel>
          <input
            name="pickup_description"
            type="text"
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

        <div
          style={{
            border: `2.5px dashed ${photoPreview ? '#0d9488' : '#fed7aa'}`,
            borderRadius: 14,
            padding: photoPreview ? 0 : 28,
            textAlign: 'center',
            cursor: 'pointer',
            background: photoPreview ? '#000' : '#fffbf0',
            marginBottom: 16,
            position: 'relative',
            overflow: 'hidden',
            minHeight: photoPreview ? 180 : undefined,
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          {photoPreview ? (
            <>
              <img
                src={photoPreview}
                alt="Book preview"
                style={{ width: '100%', maxHeight: 260, objectFit: 'contain', display: 'block' }}
              />
              <div style={{
                position: 'absolute', bottom: 8, right: 8,
                background: 'rgba(0,0,0,0.6)', color: '#fff',
                padding: '4px 10px', borderRadius: 999,
                fontSize: 11, fontWeight: 700,
              }}>
                📸 Change photo
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📸</div>
              <p className="text-[14px] font-bold" style={{ color: '#aaa' }}>
                <span style={{ color: '#f97316', fontWeight: 800 }}>Click to upload</span> a photo of your book
              </p>
              <p className="text-[12px] font-semibold mt-1.5" style={{ color: '#aaa' }}>JPG or PNG · Max 5MB</p>
            </>
          )}
          <input
            ref={fileInputRef}
            name="photo"
            type="file"
            accept="image/*"
            onChange={handlePhotoChange}
            className="absolute inset-0 opacity-0 cursor-pointer"
            style={{ width: '100%', height: '100%' }}
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
            {title || 'Your Book'} · {author || 'Author'} · {genre} · {format} · {condition} condition · <span style={{ color: '#f97316', fontWeight: 800 }}>1 credit</span> · {city || 'your city'}
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
          Post My Book →
        </button>
      </div>
    </form>
  )
}
