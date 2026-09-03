import Link from 'next/link'
import './home.css'
import WelcomeBonusModal from '@/components/WelcomeBonusModal'
import { createClient } from '@/lib/supabase/server'
import { avatarInitials } from '@/lib/avatarInitials'

export const metadata = {
  title: 'Little Book Exchange — Local Used Books',
  description: 'A neighborly way to pass books along — buy, sell, or give them away. Starting in San Luis Obispo County.',
}

const SAMPLE_STATS = { readers: 2800, posted: 1200, exchanged: 430, requested: 'The Women', libraries: 18 }

const SAMPLE_BOOKS = [
  { id: 's1', title: 'Remarkably Bright Creatures', author: 'Shelby Van Pelt', city: 'San Luis Obispo', photo: null },
  { id: 's2', title: 'Less', author: 'Andrew Sean Greer', city: 'Arroyo Grande', photo: null },
  { id: 's3', title: 'The Berry Pickers', author: 'Amanda Peters', city: 'Morro Bay', photo: null },
  { id: 's4', title: 'Tomorrow, and Tomorrow, and Tomorrow', author: 'Gabrielle Zevin', city: 'Paso Robles', photo: null },
  { id: 's5', title: 'The House in the Cerulean Sea', author: 'TJ Klune', city: 'Los Osos', photo: null },
]

const COVER_COLORS = ['#3E6B8A', '#B5462F', '#386C5D', '#7E6A9B', '#6E7B3E']
const AVATAR_COLORS = ['#3E6B8A', '#B5462F', '#6E7B3E', '#C98A2E']

const SAMPLE_AVATARS = [
  { initials: 'SB', color: '#3E6B8A', name: '' },
  { initials: 'AR', color: '#B5462F', name: '' },
  { initials: 'JM', color: '#6E7B3E', name: '' },
  { initials: 'KP', color: '#C98A2E', name: '' },
]

type HomeBook = { id: string; title: string; author: string; city: string; photo: string | null }
type HomeAvatar = { initials: string; color: string; name: string }

async function getHomeData(): Promise<{
  stats: { readers: number; posted: number; exchanged: number; requested: string; libraries: number }
  books: HomeBook[]
  avatars: HomeAvatar[]
}> {
  try {
    const supabase = createClient()
    const [readers, posted, libraries, exchanged, requested, recent, topReaders] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('listings').select('id', { count: 'exact', head: true }),
      supabase.from('library_locations').select('id', { count: 'exact', head: true }).eq('type', 'lfl'),
      supabase.rpc('home_completed_exchanges'),
      supabase.rpc('home_most_requested_book'),
      supabase
        .from('listings')
        .select('id, title, author, city, photo_url, cover_url')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(5),
      supabase.rpc('home_top_readers'),
    ])

    const stats = {
      readers: readers.count ?? SAMPLE_STATS.readers,
      posted: posted.count ?? SAMPLE_STATS.posted,
      libraries: libraries.count ?? SAMPLE_STATS.libraries,
      exchanged: typeof exchanged.data === 'number' ? exchanged.data : SAMPLE_STATS.exchanged,
      requested:
        typeof requested.data === 'string' && requested.data.trim()
          ? requested.data.trim()
          : SAMPLE_STATS.requested,
    }

    const books: HomeBook[] =
      recent.data && recent.data.length
        ? (recent.data as { id: string; title: string; author: string; city: string | null; photo_url: string | null; cover_url: string | null }[]).map(b => ({
            id: b.id,
            title: b.title,
            author: b.author,
            city: b.city || '',
            // user's own photo first, then the Open Library cover, then a color block
            photo: b.photo_url || b.cover_url || null,
          }))
        : SAMPLE_BOOKS

    const topRows = (topReaders.data ?? []) as { username: string; city: string | null }[]
    const avatars: HomeAvatar[] = topRows.length
      ? topRows.slice(0, 4).map((r, i) => ({
          initials: avatarInitials(r.username) || r.username.slice(0, 2).toUpperCase(),
          color: AVATAR_COLORS[i % AVATAR_COLORS.length],
          name: r.username,
        }))
      : SAMPLE_AVATARS

    return { stats, books, avatars }
  } catch {
    return { stats: SAMPLE_STATS, books: SAMPLE_BOOKS, avatars: SAMPLE_AVATARS }
  }
}

function PinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12Z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  )
}

function ArrowRight() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  )
}

export default async function HomePage() {
  const { stats, books, avatars } = await getHomeData()

  return (
    <>
      <WelcomeBonusModal />

      <div className="home-v2">
        {/* ---------- HERO ---------- */}
        <section className="hero">
          <div className="wrap hero-grid">
            <div className="hero-copy">
              <h1>
                Good books<br />belong here
              </h1>
              <p className="sub">
                A neighborly way to pass books along &mdash; share them with your community. Starting in San Luis
                Obispo County, with more towns joining all the time.
              </p>
              <div className="cta-row">
                <Link className="btn btn-primary" href="/listings">Browse Books</Link>
                <Link className="btn btn-outline" href="/post">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z" />
                    <path d="M5 4a2 2 0 0 0-2 2v12a3 3 0 0 1 3-3h13" />
                  </svg>
                  Post a Book
                </Link>
              </div>
              <div className="proof">
                <div className="avatars">
                  {avatars.map((a, i) => (
                    <span key={i} style={{ background: a.color }} title={a.name || undefined}>
                      {a.initials}
                    </span>
                  ))}
                </div>
                <div className="proof-txt">
                  <span className="proof-num">{stats.readers.toLocaleString()}</span>
                  <p>Readers sharing stories.</p>
                </div>
              </div>
            </div>

            <div className="hero-art">
              <img
                src="/home/hero.jpg"
                alt="A painted little free library filled with books, surrounded by flowers, a sun and a rainbow"
              />
              <span className="eyebrow">
                Pass it on.<br />Read it forward.
              </span>
            </div>
          </div>
          <div className="hero-ground" aria-hidden="true" />
        </section>

        {/* ---------- STATS ---------- */}
        <section className="wrap stats">
          <div className="stats-card">
            <div className="stat">
              <img className="ico" src="/home/ic_posted.jpg" alt="" />
              <div className="txt">
                <div className="num">{stats.posted.toLocaleString()}</div>
                <div className="lbl">Books Posted</div>
              </div>
            </div>
            <div className="stat">
              <img className="ico" src="/home/ic_exchanged.jpg" alt="" />
              <div className="txt">
                <div className="num">{stats.exchanged.toLocaleString()}</div>
                <div className="lbl">Books Exchanged</div>
              </div>
            </div>
            <div className="stat">
              <img className="ico" src="/home/ic_requested.jpg" alt="" />
              <div className="txt">
                <div className="num">{stats.requested}</div>
                <div className="lbl">Most Requested</div>
              </div>
            </div>
            <div className="stat">
              <img className="ico" src="/home/ic_libraries.jpg" alt="" />
              <div className="txt">
                <div className="num">{stats.libraries.toLocaleString()}</div>
                <div className="lbl">Little Free Libraries</div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- RECENTLY ADDED ---------- */}
        <section className="wrap section recently">
          <div className="section-head">
            <div>
              <h2>Recently added</h2>
              <svg className="squiggle" width="120" height="12" viewBox="0 0 120 12" fill="none" aria-hidden="true">
                <path d="M3 7 Q 18 -1 33 7 T 63 7 T 93 7 T 117 6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </div>
          </div>
          <div className="recently-row">
            <div className="book-row">
              {books.map((b, i) => (
                <Link className="book" href={b.id.startsWith('s') ? '/listings' : `/listings/${b.id}`} key={b.id}>
                  {b.photo ? (
                    <div className="cover cover-photo" style={{ backgroundImage: `url(${b.photo})` }} role="img" aria-label={b.title} />
                  ) : (
                    <div className="cover" style={{ background: COVER_COLORS[i % COVER_COLORS.length] }}>
                      <span className="t">{b.title}</span>
                      <span className="a">{b.author.toUpperCase()}</span>
                    </div>
                  )}
                  <div className="meta">
                    <div className="bt">{b.title}</div>
                    {b.city && (
                      <div className="loc">
                        <PinIcon />
                        {b.city}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
            <div className="recently-aside">
              <span className="eyebrow">so many great reads nearby</span>
              <svg className="point-arrow" viewBox="0 0 120 94" fill="none" aria-hidden="true">
                <path d="M104 12 C 110 36 96 54 68 62 C 52 67 38 69 24 74" stroke="#1F5EA6" strokeWidth="6" strokeLinecap="round" />
                <path d="M24 74 L 44 60 M24 74 L 40 90" stroke="#1F5EA6" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </section>

        {/* ---------- JOURNEY ---------- */}
        <section className="band-sage">
          <div className="wrap section">
            <div className="journey">
              <div className="figure">
                <img src="/home/vignette.jpg" alt="A stack of books beside a mug and a vase of flowers" />
              </div>
              <div>
                <h2>Every book has a journey.</h2>
                <p>
                  One reader to the next &mdash; one chapter at a time. Follow a title from the shelf where it
                  started to the hands it lands in next.
                </p>
                <Link className="link-arrow" href="/#how-it-works">
                  See how it works
                  <ArrowRight />
                </Link>
                <div className="map-figure">
                  <img src="/home/map.jpg" alt="An illustrated map with location pins across the county" />
                  <div className="map-cap">
                    Serving Paso Robles, San Luis Obispo &amp; Arroyo Grande &mdash; and growing
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- FEATURES ---------- */}
        <section className="band-peach">
          <div className="wrap section">
            <div className="features">
              <div className="feature">
                <div className="fico">
                  <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="6" />
                    <path d="M20 20l-4.6-4.6" />
                  </svg>
                </div>
                <h3>Find a book</h3>
                <p>Search thousands of titles shared by readers near you.</p>
              </div>
              <div className="feature">
                <div className="fico">
                  <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="9" cy="8" r="3" />
                    <circle cx="16.5" cy="9.5" r="2.5" />
                    <path d="M3.5 19c0-3 2.5-5.2 5.5-5.2s5.5 2.2 5.5 5.2" />
                    <path d="M15.5 19c0-2.3 1.1-3.9 3.2-3.9" />
                  </svg>
                </div>
                <h3>Make a connection</h3>
                <p>Meet neighbors who love the same stories you do.</p>
              </div>
              <div className="feature">
                <div className="fico">
                  <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="9" width="16" height="11" rx="1" />
                    <path d="M4 13h16" />
                    <path d="M12 9v11" />
                    <path d="M12 9C9.5 9 8 7.2 8.8 5.7 9.6 4.2 12 6 12 9Z" />
                    <path d="M12 9c2.5 0 4-1.8 3.2-3.3C14.4 4.2 12 6 12 9Z" />
                  </svg>
                </div>
                <h3>Pass it on</h3>
                <p>Give a finished book a second life instead of a landfill.</p>
              </div>
              <div className="feature">
                <div className="fico">
                  <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12a8 8 0 0 1 13-6l2 2" />
                    <path d="M20 12a8 8 0 0 1-13 6l-2-2" />
                    <path d="M19 4v4h-4" />
                    <path d="M5 20v-4h4" />
                  </svg>
                </div>
                <h3>Keep the story going</h3>
                <p>Every swap keeps a book &mdash; and a community &mdash; in motion.</p>
              </div>
            </div>
            <div className="closing">
              <p className="big">Clear a shelf. Make someone&rsquo;s week.</p>
              <Link className="btn btn-primary" href="/auth/signup">Create your free account</Link>
              <span className="fine">Free to browse. Free to join.</span>
            </div>
          </div>
        </section>

        {/* ---------- FOOTER ---------- */}
        <footer className="site-foot">
          <div className="wrap">
            <div className="foot-grid">
              <div className="foot-brand">
                <div className="name">Little Book Exchange</div>
                <div className="tag">share books, build community</div>
              </div>
              <div className="foot-col">
                <h4>Explore</h4>
                <Link href="/listings">Browse Books</Link>
                <Link href="/locations">Libraries</Link>
                <Link href="/#how-it-works">How It Works</Link>
              </div>
              <div className="foot-col">
                <h4>Account</h4>
                <Link href="/auth/signin">Sign In</Link>
                <Link href="/auth/signup">Create Account</Link>
                <Link href="/post">Post a Book</Link>
              </div>
              <div className="foot-col">
                <h4>About</h4>
                <Link href="/locations">Community Map</Link>
                <Link href="/auth/signup">Get Started</Link>
                <Link href="/profile">Your Dashboard</Link>
              </div>
            </div>
            <div className="foot-bar">
              <span>&copy; {new Date().getFullYear()} Little Book Exchange &middot; San Luis Obispo County, California</span>
            </div>
          </div>
        </footer>
      </div>
    </>
  )
}
