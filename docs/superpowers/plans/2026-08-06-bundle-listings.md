# Bundle & Series Listings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a lister post multiple books as one listing — priced at 1 credit per book, itemized, bought and handed over as a single unit — building on the credit ledger's `book_count` column and credit-transfer trigger.

**Architecture:** `listings.title`/`author` stay "book 1" so every existing single-book listing and every piece of code that reads them is untouched. A new `listing_books` table holds only the *additional* books; a trigger keeps `listings.book_count` in sync with it automatically, so pricing, the onboarding "books posted" count, and Browse/detail rendering never need to join or count `listing_books` themselves. The anti-cheat mechanism is structural, not new infrastructure: the itemized list a lister submits is exactly the checklist a buyer holds up against the physical books before the credit transfer finalizes.

**Tech Stack:** Next.js 14 (App Router), Supabase (Postgres), TypeScript, Vitest + React Testing Library.

## Global Constraints

- Schema changes are applied by hand in the Supabase SQL Editor — no local migration tooling. Every schema task's "test" is a manual verification query, not an automated assertion.
- No server action (`'use server'` file) in this codebase has a unit test — that convention holds here too.
- `book_count` is derived-only: no task may have app code write it directly. It's computed exclusively by the `sync_listing_book_count` trigger from `listing_books` rows, and protected from direct client writes by a guard trigger (Task 1) — the same shape of protection the credit ledger's final review applied to `profiles.credits`, closing the exact gap that review flagged as this feature's responsibility.
- A bundle is bought and handed over as one atomic unit for its full credit cost — no partial/per-book purchase. Do not add any code path that lets a buyer purchase less than the whole bundle.
- Genre, Format, Condition, Description, and Photos remain single, shared fields describing the whole bundle — never per-book.
- The additional-books cap is 20 (21 total including book 1) — enforced in the UI (Task 3) and defensively on the server (Task 2), mirroring how `parseListingForm` already truncates `description` server-side regardless of what the client sends.
- `components/BookCard.tsx` is dead code (confirmed: no file in this repo imports it) — no task should modify it. The real Browse cards are inline JSX in `app/listings/page.tsx` (Task 5).

---

### Task 1: Database migration — bundle listings schema

**Files:**
- Modify: `supabase/schema.sql` (append new migration block at end of file)

**Interfaces:**
- Produces: `listings.is_bundle` (bool), `listings.bundle_name` (text, nullable), `listing_books` table (`id`, `listing_id`, `title`, `author`, `position`, `created_at`), `listings.book_count` kept in sync automatically and protected from direct writes — every later task reads/writes these.

- [ ] **Step 1: Append the migration block to `supabase/schema.sql`**

```sql
-- ── Migration: bundle & series listings ───────────────────────────────────────

ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_bundle boolean NOT NULL DEFAULT false;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS bundle_name text;

-- listings.title/author remain "book 1" — every existing single-book listing
-- and every piece of code that already reads listing.title/listing.author is
-- untouched. This table holds only the *additional* books in a bundle.
create table if not exists listing_books (
  id uuid default gen_random_uuid() primary key,
  listing_id uuid references listings(id) on delete cascade not null,
  title text not null,
  author text not null,
  position integer not null default 0,
  created_at timestamptz default now()
);

alter table listing_books enable row level security;
create policy "Listing books are viewable by everyone" on listing_books for select using (true);
create policy "Owners can manage their listing's books" on listing_books
  for all using (exists (select 1 from listings l where l.id = listing_id and l.user_id = auth.uid()));

-- Keep listings.book_count in sync automatically, so nothing downstream —
-- pricing, the credit-ledger onboarding "books posted" count, Browse/detail
-- rendering — ever needs to join or count listing_books itself.
create or replace function sync_listing_book_count()
returns trigger as $$
begin
  update listings set book_count = 1 + (select count(*) from listing_books where listing_id = coalesce(new.listing_id, old.listing_id))
  where id = coalesce(new.listing_id, old.listing_id);
  return null;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists on_listing_books_change on listing_books;
create trigger on_listing_books_change
  after insert or update or delete on listing_books
  for each row execute procedure sync_listing_book_count();

-- book_count is meant to be entirely derived from listing_books via the
-- trigger above — never written directly by app code (createListing/
-- updateListing never set it, per this feature's design). But "Users can
-- update own listings" (auth.uid() = user_id, no column scoping — RLS can't
-- scope to a column) lets a listing's owner PATCH book_count directly via the
-- REST API to any value, independent of how many listing_books rows actually
-- exist — letting a lister charge buyers for books that aren't itemized
-- anywhere. Same shape of problem, same fix, as prevent_credit_self_grant:
-- revert any direct (non-cascaded) write. The legitimate path is always
-- nested inside a listing_books trigger (depth 2+ by the time it reaches
-- this UPDATE); a raw client PATCH on listings hits this guard at depth 1.
-- Unlike prevent_credit_self_grant there's no legitimate depth-1 writer to
-- carve out here — nothing in this app ever sets book_count directly — so
-- no bypass flag is needed.
create or replace function prevent_book_count_self_edit()
returns trigger as $$
begin
  if pg_trigger_depth() = 1 then
    new.book_count := old.book_count;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists prevent_book_count_self_edit_trigger on listings;
create trigger prevent_book_count_self_edit_trigger before update on listings
  for each row execute procedure prevent_book_count_self_edit();
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Run the migration**

Paste the block into the Supabase SQL Editor and run it (in smaller pieces if needed — split at each `create` / `alter table` statement group). Expected: no errors.

- [ ] **Step 3: Manually verify the schema landed correctly**

```sql
select column_name from information_schema.columns where table_name = 'listings' and column_name in ('is_bundle', 'bundle_name');
```
Expected: 2 rows.

```sql
select count(*) from listing_books;
```
Expected: `0`, no error.

```sql
select proname from pg_proc where proname in ('sync_listing_book_count', 'prevent_book_count_self_edit');
select tgname from pg_trigger where tgname in ('on_listing_books_change', 'prevent_book_count_self_edit_trigger');
```
Expected: 2 rows each.

- [ ] **Step 4: Manually verify the sync trigger and the self-edit guard**

```sql
-- substitute a real listing id you own (or any existing listing id for a quick check)
insert into listing_books (listing_id, title, author, position) values ('<listing id>', 'Test Book 2', 'Test Author', 0);
select book_count from listings where id = '<listing id>';
-- expect 2

update listings set book_count = 999 where id = '<listing id>';
select book_count from listings where id = '<listing id>';
-- expect still 2 — the direct write should have been reverted by the guard

delete from listing_books where listing_id = '<listing id>';
select book_count from listings where id = '<listing id>';
-- expect back to 1
```

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: add bundle listings schema — listing_books, book_count sync + guard"
```

---

### Task 2: `parseBundleBooks` helper

**Files:**
- Modify: `lib/parseListingForm.ts`
- Test: `lib/parseListingForm.test.ts`

**Interfaces:**
- Produces: `parseBundleBooks(formData: FormData): { title: string; author: string }[]` — Task 4 (`createListing`) and Task 7 (`updateListing`) both call this.

- [ ] **Step 1: Write the failing tests**

Add to `lib/parseListingForm.test.ts`:

```ts
import { parseListingForm, parseBundleBooks } from './parseListingForm'

describe('parseBundleBooks', () => {
  it('returns an empty array when book_rows is absent', () => {
    const fd = makeFormData({})
    expect(parseBundleBooks(fd)).toEqual([])
  })

  it('parses the given number of rows', () => {
    const fd = new FormData()
    fd.set('book_rows', '2')
    fd.set('book_title_1', 'Chamber of Secrets')
    fd.set('book_author_1', 'J.K. Rowling')
    fd.set('book_title_2', 'Prisoner of Azkaban')
    fd.set('book_author_2', 'J.K. Rowling')
    expect(parseBundleBooks(fd)).toEqual([
      { title: 'Chamber of Secrets', author: 'J.K. Rowling' },
      { title: 'Prisoner of Azkaban', author: 'J.K. Rowling' },
    ])
  })

  it('trims whitespace and drops a row where both fields are empty', () => {
    const fd = new FormData()
    fd.set('book_rows', '2')
    fd.set('book_title_1', '  Chamber of Secrets  ')
    fd.set('book_author_1', '  J.K. Rowling  ')
    fd.set('book_title_2', '')
    fd.set('book_author_2', '')
    expect(parseBundleBooks(fd)).toEqual([
      { title: 'Chamber of Secrets', author: 'J.K. Rowling' },
    ])
  })

  it('keeps a row if only one of the two fields is filled in', () => {
    const fd = new FormData()
    fd.set('book_rows', '1')
    fd.set('book_title_1', 'Chamber of Secrets')
    fd.set('book_author_1', '')
    expect(parseBundleBooks(fd)).toEqual([{ title: 'Chamber of Secrets', author: '' }])
  })

  it('caps at 20 rows regardless of what book_rows claims', () => {
    const fd = new FormData()
    fd.set('book_rows', '25')
    for (let i = 1; i <= 25; i++) {
      fd.set(`book_title_${i}`, `Book ${i}`)
      fd.set(`book_author_${i}`, 'Author')
    }
    expect(parseBundleBooks(fd)).toHaveLength(20)
  })

  it('treats a non-numeric book_rows as zero', () => {
    const fd = new FormData()
    fd.set('book_rows', 'not-a-number')
    fd.set('book_title_1', 'Chamber of Secrets')
    fd.set('book_author_1', 'J.K. Rowling')
    expect(parseBundleBooks(fd)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/parseListingForm.test.ts -t "parseBundleBooks"`
Expected: FAIL — `parseBundleBooks` is not exported yet.

- [ ] **Step 3: Implement `parseBundleBooks`**

Add to `lib/parseListingForm.ts`:

```ts
const MAX_BUNDLE_BOOKS = 20

export function parseBundleBooks(formData: FormData): { title: string; author: string }[] {
  const rawCount = parseInt((formData.get('book_rows') as string) || '0', 10)
  const count = Math.min(Number.isFinite(rawCount) ? Math.max(rawCount, 0) : 0, MAX_BUNDLE_BOOKS)

  const books: { title: string; author: string }[] = []
  for (let i = 1; i <= count; i++) {
    const title = ((formData.get(`book_title_${i}`) as string) || '').trim()
    const author = ((formData.get(`book_author_${i}`) as string) || '').trim()
    if (title === '' && author === '') continue
    books.push({ title, author })
  }
  return books
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/parseListingForm.test.ts -t "parseBundleBooks"`
Expected: PASS.

- [ ] **Step 5: Run the full file**

Run: `npx vitest run lib/parseListingForm.test.ts`
Expected: all tests PASS (existing `parseListingForm` tests untouched by this change).

- [ ] **Step 6: Commit**

```bash
git add lib/parseListingForm.ts lib/parseListingForm.test.ts
git commit -m "feat: add parseBundleBooks helper for bundle listing form data"
```

---

### Task 3: Post form — bundle toggle, repeatable rows, edit-prefill support

**Files:**
- Modify: `app/post/PostForm.tsx`
- Test: `app/post/PostForm.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure client-side form UI).
- Produces: `Props.initialValues` gains optional `is_bundle?: boolean`, `bundle_name?: string | null`, `books?: { title: string; author: string }[]` — Task 7 passes real data through these when editing an existing bundle. Submitted field names: `is_bundle` (`'true'`/`'false'`), `bundle_name`, `book_rows`, `book_title_{i}`/`book_author_{i}` (1-indexed) — Task 4 and Task 7's server actions read these via `parseBundleBooks` (Task 2).

- [ ] **Step 1: Write the failing tests**

Add to `app/post/PostForm.test.tsx`:

```ts
describe('PostForm — bundle toggle', () => {
  it('does not show the Bundle Details section by default', () => {
    render(<PostForm action={vi.fn()} />)
    expect(screen.queryByText('Series / Bundle Name')).not.toBeInTheDocument()
  })

  it('reveals Bundle Details when the toggle is clicked, defaulting to a 1-book/1-credit total', () => {
    render(<PostForm action={vi.fn()} />)
    fireEvent.click(screen.getByText('📚 List as a Bundle / Series'))
    expect(screen.getByText('Series / Bundle Name')).toBeInTheDocument()
    expect(screen.getByText('This bundle: 1 book · 1 credit')).toBeInTheDocument()
  })

  it('adds a book row pre-filled from Book 1 when Add Another Book is clicked', () => {
    render(<PostForm action={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. The Great Gatsby'), { target: { value: 'Dune' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. F. Scott Fitzgerald'), { target: { value: 'Frank Herbert' } })
    fireEvent.click(screen.getByText('📚 List as a Bundle / Series'))
    fireEvent.click(screen.getByText('+ Add Another Book'))

    expect(screen.getByPlaceholderText('Book title')).toHaveValue('Dune')
    expect(screen.getByPlaceholderText('Author')).toHaveValue('Frank Herbert')
    expect(screen.getByText('This bundle: 2 books · 2 credits')).toBeInTheDocument()
  })

  it('removes a book row when its Remove button is clicked', () => {
    render(<PostForm action={vi.fn()} />)
    fireEvent.click(screen.getByText('📚 List as a Bundle / Series'))
    fireEvent.click(screen.getByText('+ Add Another Book'))
    fireEvent.click(screen.getByText('✕ Remove'))
    expect(screen.queryByPlaceholderText('Book title')).not.toBeInTheDocument()
    expect(screen.getByText('This bundle: 1 book · 1 credit')).toBeInTheDocument()
  })

  it('re-copies the current Book 1 title/author when Auto-fill is clicked again', () => {
    render(<PostForm action={vi.fn()} />)
    fireEvent.click(screen.getByText('📚 List as a Bundle / Series'))
    fireEvent.click(screen.getByText('+ Add Another Book'))
    fireEvent.change(screen.getByPlaceholderText('e.g. The Great Gatsby'), { target: { value: 'Dune Messiah' } })
    fireEvent.click(screen.getByText('✨ Auto-fill from Book 1'))
    expect(screen.getByPlaceholderText('Book title')).toHaveValue('Dune Messiah')
  })

  it('submits is_bundle=false and book_rows=0 hidden fields by default', () => {
    const { container } = render(<PostForm action={vi.fn()} />)
    expect(container.querySelector('input[name="is_bundle"]')).toHaveValue('false')
    expect(container.querySelector('input[name="book_rows"]')).toHaveValue('0')
  })

  it('submits is_bundle=true, book_rows, and indexed book fields once populated', () => {
    const { container } = render(<PostForm action={vi.fn()} />)
    fireEvent.click(screen.getByText('📚 List as a Bundle / Series'))
    fireEvent.click(screen.getByText('+ Add Another Book'))
    fireEvent.change(screen.getByPlaceholderText('Book title'), { target: { value: 'Chamber of Secrets' } })

    expect(container.querySelector('input[name="is_bundle"]')).toHaveValue('true')
    expect(container.querySelector('input[name="book_rows"]')).toHaveValue('1')
    expect(container.querySelector('input[name="book_title_1"]')).toHaveValue('Chamber of Secrets')
  })

  it('clears bundle data when the toggle is turned back off', () => {
    render(<PostForm action={vi.fn()} />)
    fireEvent.click(screen.getByText('📚 List as a Bundle / Series'))
    fireEvent.click(screen.getByText('+ Add Another Book'))
    fireEvent.click(screen.getByText('📚 List as a Bundle / Series'))
    expect(screen.queryByText('Series / Bundle Name')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('📚 List as a Bundle / Series'))
    expect(screen.getByText('This bundle: 1 book · 1 credit')).toBeInTheDocument()
  })

  it('hides Add Another Book once 20 additional books are added', () => {
    render(<PostForm action={vi.fn()} />)
    fireEvent.click(screen.getByText('📚 List as a Bundle / Series'))
    for (let i = 0; i < 20; i++) {
      fireEvent.click(screen.getByText('+ Add Another Book'))
    }
    expect(screen.queryByText('+ Add Another Book')).not.toBeInTheDocument()
    expect(screen.getByText('This bundle: 21 books · 21 credits')).toBeInTheDocument()
  })

  it('pre-fills bundle state from initialValues (edit mode)', () => {
    render(
      <PostForm
        action={vi.fn()}
        initialValues={{
          title: 'Sorcerer\'s Stone', author: 'J.K. Rowling', condition: 'Good', genre: 'Fiction', format: 'Paperback',
          description: null, pickup_description: null, photo_url: null, photo_url_2: null, photo_url_3: null,
          is_bundle: true, bundle_name: 'Harry Potter Series',
          books: [{ title: 'Chamber of Secrets', author: 'J.K. Rowling' }],
        }}
      />
    )
    expect(screen.getByDisplayValue('Harry Potter Series')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Chamber of Secrets')).toBeInTheDocument()
    expect(screen.getByText('This bundle: 2 books · 2 credits')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run app/post/PostForm.test.tsx -t "bundle toggle"`
Expected: FAIL — none of this UI exists yet.

- [ ] **Step 3: Extend `Props.initialValues` and add state**

In the `Props` type, extend `initialValues`:

```ts
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
```

In the component body, alongside the other `useState` calls:

```ts
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
```

- [ ] **Step 4: Add the hidden `is_bundle`/`book_rows` fields**

Find:

```tsx
      <input type="hidden" name="genre" value={genre} />
      <input type="hidden" name="format" value={format} />
      <input type="hidden" name="price" value="1" />
```

Replace with:

```tsx
      <input type="hidden" name="genre" value={genre} />
      <input type="hidden" name="format" value={format} />
      <input type="hidden" name="price" value="1" />
      <input type="hidden" name="is_bundle" value={isBundle ? 'true' : 'false'} />
      <input type="hidden" name="book_rows" value={books.length} />
```

- [ ] **Step 5: Insert the toggle and Bundle Details section**

Find (the end of the Format/Year grid, right before the Genre section):

```tsx
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
```

Replace with:

```tsx
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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run app/post/PostForm.test.tsx -t "bundle toggle"`
Expected: PASS.

- [ ] **Step 7: Run the full test file**

Run: `npx vitest run app/post/PostForm.test.tsx`
Expected: all tests PASS (existing tests untouched by these additions).

- [ ] **Step 8: Commit**

```bash
git add app/post/PostForm.tsx app/post/PostForm.test.tsx
git commit -m "feat: add bundle/series toggle and book rows to the post form"
```

---

### Task 4: `createListing` — bulk-insert bundle books

**Files:**
- Modify: `app/post/actions.ts`

**Interfaces:**
- Consumes: `parseBundleBooks` from Task 2, `is_bundle`/`bundle_name` fields from Task 3's form.

No automated test (server action, see Global Constraints). Verified manually.

- [ ] **Step 1: Import `parseBundleBooks`**

```ts
import { parseListingForm, parseBundleBooks } from '@/lib/parseListingForm'
```

- [ ] **Step 2: Parse the bundle fields and carry them into the listing insert**

Find:

```ts
    const fields = parseListingForm(formData)

    const { data: listing, error } = await supabase.from('listings').insert({
      user_id: user!.id,
      ...fields,
      photo_url,
      photo_url_2,
      photo_url_3,
      city: prof?.city ?? '',
    }).select('id').single()

    if (error) redirect(`/post?error=${encodeURIComponent(error.message || 'Failed to post listing')}`)
    if (!listing) redirect('/post?error=No+listing+returned')
    redirect(`/listings/${listing!.id}`)
```

Replace with:

```ts
    const fields = parseListingForm(formData)
    const isBundle = formData.get('is_bundle') === 'true'
    const bundleBooks = isBundle ? parseBundleBooks(formData) : []
    const bundleName = (formData.get('bundle_name') as string)?.trim() || null

    const { data: listing, error } = await supabase.from('listings').insert({
      user_id: user!.id,
      ...fields,
      photo_url,
      photo_url_2,
      photo_url_3,
      city: prof?.city ?? '',
      is_bundle: isBundle && bundleBooks.length > 0,
      bundle_name: isBundle && bundleBooks.length > 0 ? bundleName : null,
    }).select('id').single()

    if (error) redirect(`/post?error=${encodeURIComponent(error.message || 'Failed to post listing')}`)
    if (!listing) redirect('/post?error=No+listing+returned')

    if (isBundle && bundleBooks.length > 0) {
      const { error: booksError } = await supabase.from('listing_books').insert(
        bundleBooks.map((b, i) => ({ listing_id: listing!.id, title: b.title, author: b.author, position: i }))
      )
      if (booksError) console.error('Failed to insert bundle books:', booksError)
    }

    redirect(`/listings/${listing!.id}`)
```

(Per the spec: if `is_bundle` was submitted but `parseBundleBooks` returns zero valid rows, `is_bundle`/`bundle_name` are stored as `false`/`null` — the listing saves as a normal single-book listing, the toggle is silently ignored rather than surfacing a validation error for an empty/unused control.)

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "app/post/actions"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add app/post/actions.ts
git commit -m "feat: bulk-insert bundle books when creating a listing"
```

---

### Task 5: Browse display — bundle badge and headline

**Files:**
- Modify: `lib/types.ts`
- Modify: `app/listings/page.tsx`

**Interfaces:**
- Produces: `Listing.is_bundle?: boolean`, `Listing.bundle_name?: string | null`, `Listing.book_count?: number` — Task 6 also uses these on the same shared type.

No automated test (this page has no existing test file — pages aren't unit-tested in this codebase, only extracted pure functions/components are). Verified via `tsc`/build and manual reasoning.

- [ ] **Step 1: Extend the `Listing` type**

In `lib/types.ts`, find:

```ts
export type Listing = {
  id: string
  user_id: string
  title: string
  author: string
  condition: ListingCondition
  price: number | null
  description: string | null
  photo_url: string | null
  city: string
  status: ListingStatus
  genre?: string
  format?: string
  created_at: string
  profiles?: Profile
}
```

Replace with:

```ts
export type Listing = {
  id: string
  user_id: string
  title: string
  author: string
  condition: ListingCondition
  price: number | null
  description: string | null
  photo_url: string | null
  city: string
  status: ListingStatus
  genre?: string
  format?: string
  created_at: string
  profiles?: Profile
  is_bundle?: boolean
  bundle_name?: string | null
  book_count?: number
}
```

- [ ] **Step 2: Bundle-aware headline and badges in the Browse card**

`app/listings/page.tsx`'s `getListings` already does `select('*', ...)`, so `is_bundle`/`bundle_name`/`book_count` are fetched with no query change.

Find the card's top-right overlay badge:

```tsx
                    {avail === 'active' ? (
                      <span
                        className="absolute text-white font-black"
                        style={{ top: 8, right: 8, padding: '3px 10px', borderRadius: 999, fontSize: 11, background: '#f97316' }}
                      >
                        1 credit
                      </span>
                    ) : (
```

Replace with:

```tsx
                    {avail === 'active' ? (
                      <span
                        className="absolute text-white font-black"
                        style={{ top: 8, right: 8, padding: '3px 10px', borderRadius: 999, fontSize: 11, background: '#f97316' }}
                      >
                        {l.is_bundle ? `${l.book_count ?? 1} credits` : '1 credit'}
                      </span>
                    ) : (
```

Find the title line:

```tsx
                    <p className="font-black text-[13px] truncate mb-0.5">{l.title}</p>
```

Replace with:

```tsx
                    <p className="font-black text-[13px] truncate mb-0.5">{l.is_bundle ? (l.bundle_name || l.title) : l.title}</p>
```

Find the bottom condition/credit row:

```tsx
                      <span className="font-extrabold text-[10px]" style={{ color: '#f97316' }}>
                        🪙 1 credit
                      </span>
```

Replace with:

```tsx
                      <span className="font-extrabold text-[10px]" style={{ color: '#f97316' }}>
                        {l.is_bundle ? `📚 Bundle · ${l.book_count ?? 1} books · ${l.book_count ?? 1} credits` : '🪙 1 credit'}
                      </span>
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "lib/types|app/listings/page"`
Expected: no output beyond the pre-existing, unrelated `TS2802` error already in this file (Set-iteration issue, not introduced by this change — confirmed via `git stash` comparison if unsure).

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts app/listings/page.tsx
git commit -m "feat: show bundle badge and headline on Browse cards"
```

---

### Task 6: Listing detail page — itemized bundle display

**Files:**
- Modify: `app/listings/[id]/page.tsx`

**Interfaces:**
- Consumes: `Listing.is_bundle`/`bundle_name`/`book_count` from Task 5's type, `listing_books` table from Task 1.

No automated test (no existing test file for this page). No live Supabase access — Task 1's migration hasn't been run yet at the time this task is implemented, so this can only be verified statically (`tsc`, careful reading), not end-to-end.

- [ ] **Step 1: Fetch `listing_books` when the listing is a bundle**

Find:

```ts
    const [{ data: l }, { data: { user: u } }] = await Promise.all([
      supabase.from('listings').select('*, profiles(id, username, city)').eq('id', params.id).single(),
      supabase.auth.getUser(),
    ])
    listing = l
    user = u
```

Replace with:

```ts
    const [{ data: l }, { data: { user: u } }] = await Promise.all([
      supabase.from('listings').select('*, profiles(id, username, city)').eq('id', params.id).single(),
      supabase.auth.getUser(),
    ])
    listing = l
    user = u

    if (listing?.is_bundle) {
      const { data: books } = await supabase
        .from('listing_books').select('title, author').eq('listing_id', listing.id).order('position', { ascending: true })
      listing.books = books ?? []
    }
```

- [ ] **Step 2: Bundle-aware top badge**

Find:

```tsx
          <span
            className="absolute top-5 right-5 px-5 py-2 rounded-full text-base font-black"
            style={{
              background: '#f97316',
              color: '#fff',
            }}
          >
            1 credit
          </span>
```

Replace with:

```tsx
          <span
            className="absolute top-5 right-5 px-5 py-2 rounded-full text-base font-black"
            style={{
              background: '#f97316',
              color: '#fff',
            }}
          >
            {listing.is_bundle ? `${listing.book_count ?? 1} credits` : '1 credit'}
          </span>
```

- [ ] **Step 3: Bundle-aware headline**

Find:

```tsx
          <h1 className="font-display text-[30px] mb-1" style={{ color: '#1a1a1a' }}>{listing.title}</h1>
```

Replace with:

```tsx
          <h1 className="font-display text-[30px] mb-1" style={{ color: '#1a1a1a' }}>
            {listing.is_bundle ? (listing.bundle_name || listing.title) : listing.title}
          </h1>
```

- [ ] **Step 4: Render the itemized "Books in this Bundle" section**

Find:

```tsx
          {listing.description && (
            <p className="font-semibold leading-[1.7] mb-7 text-[15px] break-words" style={{ color: '#666' }}>
              {listing.description}
            </p>
          )}

          {/* Divider + footer */}
```

Replace with:

```tsx
          {listing.description && (
            <p className="font-semibold leading-[1.7] mb-7 text-[15px] break-words" style={{ color: '#666' }}>
              {listing.description}
            </p>
          )}

          {listing.is_bundle && (
            <div style={{ marginBottom: 28 }}>
              <p className="font-display text-[16px] text-bk-orange mb-3">📚 Books in this Bundle</p>
              <div className="flex flex-col" style={{ gap: 8 }}>
                <div style={{ padding: '10px 14px', borderRadius: 12, background: '#fff7ed', border: '2px solid #fed7aa' }}>
                  <span className="font-black text-[14px]">{listing.title}</span>
                  <span className="font-semibold text-[13px]" style={{ color: '#888' }}> — {listing.author}</span>
                </div>
                {(listing.books ?? []).map((b: { title: string; author: string }, i: number) => (
                  <div key={i} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff7ed', border: '2px solid #fed7aa' }}>
                    <span className="font-black text-[14px]">{b.title}</span>
                    <span className="font-semibold text-[13px]" style={{ color: '#888' }}> — {b.author}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Divider + footer */}
```

- [ ] **Step 5: Bundle-aware purchase button copy**

Find:

```tsx
                  <button
                    type="submit"
                    className="font-extrabold text-base text-white shadow-[0_4px_0_#0f766e] hover:shadow-[0_2px_0_#0f766e] hover:translate-y-0.5 transition-all"
                    style={{ background: '#0d9488', padding: '14px 32px', borderRadius: 999, border: 'none', cursor: 'pointer' }}
                  >
                    🪙 Purchase with 1 Credit
                  </button>
```

Replace with:

```tsx
                  <button
                    type="submit"
                    className="font-extrabold text-base text-white shadow-[0_4px_0_#0f766e] hover:shadow-[0_2px_0_#0f766e] hover:translate-y-0.5 transition-all"
                    style={{ background: '#0d9488', padding: '14px 32px', borderRadius: 999, border: 'none', cursor: 'pointer' }}
                  >
                    {listing.is_bundle ? `🪙 Purchase Bundle for ${listing.book_count ?? 1} Credits` : '🪙 Purchase with 1 Credit'}
                  </button>
```

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "listings/\[id\]/page"`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add "app/listings/[id]/page.tsx"
git commit -m "feat: show itemized bundle contents and bundle pricing on listing detail page"
```

---

### Task 7: Edit flow — wholesale-replace on save, prefill on open

**Files:**
- Modify: `app/post/actions.ts` (`updateListing`)
- Modify: `app/listings/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `parseBundleBooks` from Task 2, Task 3's `PostForm` `initialValues.is_bundle`/`bundle_name`/`books`.

No automated test (server action + page, no existing test precedent for either).

- [ ] **Step 1: `updateListing` replaces `listing_books` wholesale**

In `app/post/actions.ts`, find:

```ts
import { parseListingForm } from '@/lib/parseListingForm'
```

Replace with:

```ts
import { parseListingForm, parseBundleBooks } from '@/lib/parseListingForm'
```

Find:

```ts
    const fields = parseListingForm(formData)

    const { error } = await supabase.from('listings').update({
      ...fields,
      photo_url:   photo_url   ?? existing.photo_url,
      photo_url_2: photo_url_2 ?? existing.photo_url_2,
      photo_url_3: photo_url_3 ?? existing.photo_url_3,
    }).eq('id', listingId).eq('user_id', user.id)

    if (error) redirect(`/listings/${listingId}/edit?error=${encodeURIComponent(error.message)}`)
    redirect('/profile?tab=listings')
```

Replace with:

```ts
    const fields = parseListingForm(formData)
    const isBundle = formData.get('is_bundle') === 'true'
    const bundleBooks = isBundle ? parseBundleBooks(formData) : []
    const bundleName = (formData.get('bundle_name') as string)?.trim() || null

    const { error } = await supabase.from('listings').update({
      ...fields,
      photo_url:   photo_url   ?? existing.photo_url,
      photo_url_2: photo_url_2 ?? existing.photo_url_2,
      photo_url_3: photo_url_3 ?? existing.photo_url_3,
      is_bundle: isBundle && bundleBooks.length > 0,
      bundle_name: isBundle && bundleBooks.length > 0 ? bundleName : null,
    }).eq('id', listingId).eq('user_id', user.id)

    if (error) redirect(`/listings/${listingId}/edit?error=${encodeURIComponent(error.message)}`)

    await supabase.from('listing_books').delete().eq('listing_id', listingId)
    if (isBundle && bundleBooks.length > 0) {
      const { error: booksError } = await supabase.from('listing_books').insert(
        bundleBooks.map((b, i) => ({ listing_id: listingId, title: b.title, author: b.author, position: i }))
      )
      if (booksError) console.error('Failed to update bundle books:', booksError)
    }

    redirect('/profile?tab=listings')
```

(Delete-then-reinsert matches how `updateListing` already overwrites every other field unconditionally on every save — no new pattern introduced. The delete happens even for a non-bundle save, which correctly clears any stale `listing_books` rows if a listing is un-bundled during an edit.)

- [ ] **Step 2: Edit page fetches existing bundle books and passes them as `initialValues`**

In `app/listings/[id]/edit/page.tsx`, find:

```ts
  const { data: listing } = await supabase.from('listings').select('*').eq('id', params.id).single()
  if (!listing) notFound()
  if (listing.user_id !== user.id) redirect(`/listings/${params.id}`)
```

Replace with:

```ts
  const { data: listing } = await supabase.from('listings').select('*').eq('id', params.id).single()
  if (!listing) notFound()
  if (listing.user_id !== user.id) redirect(`/listings/${params.id}`)

  let bundleBooks: { title: string; author: string }[] = []
  if (listing.is_bundle) {
    const { data: books } = await supabase
      .from('listing_books').select('title, author').eq('listing_id', listing.id).order('position', { ascending: true })
    bundleBooks = books ?? []
  }
```

Find:

```tsx
        initialValues={{
          title: listing.title,
          author: listing.author,
          condition: listing.condition,
          genre: listing.genre ?? 'Fiction',
          format: listing.format ?? 'Paperback',
          description: listing.description,
          pickup_description: listing.pickup_description,
          photo_url: listing.photo_url,
          photo_url_2: listing.photo_url_2,
          photo_url_3: listing.photo_url_3,
        }}
```

Replace with:

```tsx
        initialValues={{
          title: listing.title,
          author: listing.author,
          condition: listing.condition,
          genre: listing.genre ?? 'Fiction',
          format: listing.format ?? 'Paperback',
          description: listing.description,
          pickup_description: listing.pickup_description,
          photo_url: listing.photo_url,
          photo_url_2: listing.photo_url_2,
          photo_url_3: listing.photo_url_3,
          is_bundle: listing.is_bundle ?? false,
          bundle_name: listing.bundle_name,
          books: bundleBooks,
        }}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "app/post/actions|listings/\[id\]/edit"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add app/post/actions.ts "app/listings/[id]/edit/page.tsx"
git commit -m "feat: replace bundle books wholesale on edit, prefill form when editing a bundle"
```

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1) ✓, post form toggle/rows/auto-fill/running-total/cap (Task 3) ✓, `createListing` bulk-insert (Task 4) ✓, `updateListing` wholesale-replace (Task 7) ✓, Browse badge/headline (Task 5) ✓, detail page itemized list/badge/purchase copy (Task 6) ✓, edit-mode prefill (Task 7) ✓. Anti-cheat (spec Section 5) requires no code beyond the itemized list itself, which Task 3/4/6 already produce — no separate task needed.
- **Deviation from spec, corrected:** the spec's Files Changed table named `components/BookCard.tsx` as the Browse card component; that file is unused dead code (verified: no importers anywhere in the repo). Task 5 targets the actual inline card JSX in `app/listings/page.tsx` instead.
- **Addition beyond the spec, justified:** Task 1 adds a `prevent_book_count_self_edit` guard trigger not present in the original spec text. This directly closes a gap the credit-ledger feature's final review explicitly flagged as "recommend the bundle-listings feature add [a guard] when it starts populating this column" (`book_count` is otherwise writable by any listing owner via the REST API, independent of actual `listing_books` contents) — this is in-scope guidance from the dependency this plan builds on, not scope creep.
- **Placeholder scan:** no TBD/TODO; every step has complete, real code.
- **Type consistency:** `parseBundleBooks(formData: FormData): { title: string; author: string }[]` matches between Task 2 (definition) and Tasks 4/7 (call sites). `Listing.is_bundle`/`bundle_name`/`book_count` match between Task 5 (type definition) and Tasks 5/6 (usage). Form field names (`is_bundle`, `bundle_name`, `book_rows`, `book_title_{i}`/`book_author_{i}`) match exactly between Task 3 (emitted) and Task 2/4/7 (parsed).
