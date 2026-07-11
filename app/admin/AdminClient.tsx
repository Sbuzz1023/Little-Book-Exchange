'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import LocationsAdminTab from './LocationsAdminTab'

const MOCK_REVIEWS = [
  { id:'rv1', reviewer:'Sarah M.',  book:'The Great Gatsby',       rating:5, text:'Beautiful prose, timeless story. The copy I got was in great shape!',     date:'2024-06-15', flagged:false },
  { id:'rv2', reviewer:'Priya N.',  book:'Dune',                   rating:5, text:'A sci-fi masterpiece. Highly recommend to anyone who loves world-building.', date:'2024-06-18', flagged:false },
  { id:'rv3', reviewer:'James K.',  book:'Twilight',               rating:2, text:'Not my thing but was in good condition.',                                   date:'2024-06-19', flagged:false },
  { id:'rv4', reviewer:'Tom B.',    book:'Harry Potter Sorcerer',  rating:1, text:'This is garbage, the seller is a scammer!!!',                              date:'2024-06-20', flagged:true  },
  { id:'rv5', reviewer:'Maria C.',  book:'Gone Girl',              rating:4, text:"Couldn't put it down. Book was in excellent condition.",                    date:'2024-06-21', flagged:false },
  { id:'rv6', reviewer:'Devon H.',  book:'Into the Wild',          rating:5, text:'One of my favorites. Glad to pass it along.',                               date:'2024-06-22', flagged:false },
]

const WEEKLY_ACTIVITY = [
  { week:'May 5',  posts:4,  signups:2, trades:3 },
  { week:'May 12', posts:7,  signups:3, trades:5 },
  { week:'May 19', posts:6,  signups:1, trades:4 },
  { week:'May 26', posts:9,  signups:4, trades:7 },
  { week:'Jun 2',  posts:11, signups:3, trades:8 },
  { week:'Jun 9',  posts:8,  signups:5, trades:6 },
  { week:'Jun 16', posts:14, signups:6, trades:10 },
  { week:'Jun 23', posts:12, signups:4, trades:9 },
]

const RECENT_ACTIVITY = [
  { id:1, type:'signup',  text:'Raj P. joined',                          time:'2h ago' },
  { id:2, type:'post',    text:'Lily T. posted "Charlotte\'s Web"',       time:'3h ago' },
  { id:3, type:'trade',   text:'Sarah M. & Devon H. completed a trade',   time:'5h ago' },
  { id:4, type:'report',  text:'Location report: Capitol Hill LFL',        time:'6h ago' },
  { id:5, type:'post',    text:'Maria C. posted "Gone Girl"',              time:'8h ago' },
  { id:6, type:'review',  text:'Tom B. left a flagged review',             time:'10h ago' },
  { id:7, type:'trade',   text:'Priya N. & James K. completed a trade',   time:'12h ago' },
  { id:8, type:'signup',  text:'Devon H. joined',                          time:'1d ago' },
]

const ADMIN_PASSCODE = '123890'

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = 'dashboard' | 'users' | 'locations' | 'reviews'
type User = {
  id: string
  username: string
  email: string
  joined: string
  booksPosted: number
  booksSold: number
  booksBought: number
  credits: number
  status: string
  city: string
  state: string
  bio: string
  reviews: number
  is_admin: boolean
}
type Review = typeof MOCK_REVIEWS[0]

// ─── Simple SVG bar chart ────────────────────────────────────────────────────

function ActivityChart({ data }: { data: typeof WEEKLY_ACTIVITY }) {
  const max = Math.max(...data.flatMap(d => [d.posts, d.signups, d.trades])) || 1
  const W = 560, H = 140, pad = 32
  const step = (W - pad * 2) / (data.length - 1)
  const bw = 10

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H + 44}`} className="w-full min-w-[340px]" style={{ fontFamily: 'Nunito, sans-serif' }}>
        {/* Grid lines */}
        {[0.25, 0.5, 0.75, 1].map(r => (
          <line key={r} x1={pad} x2={W - pad} y1={H - H * r} y2={H - H * r}
            stroke="#f1f5f9" strokeWidth="1" />
        ))}
        {/* Bars */}
        {data.map((d, i) => {
          const x = pad + i * step
          const ph = (d.posts   / max) * H
          const sh = (d.signups / max) * H
          const th = (d.trades  / max) * H
          return (
            <g key={d.week}>
              <rect x={x - bw * 1.5 - 1} y={H - ph} width={bw} height={ph} fill="#f97316" rx="2" opacity="0.9" />
              <rect x={x - bw * 0.5}      y={H - sh} width={bw} height={sh} fill="#0d9488" rx="2" opacity="0.9" />
              <rect x={x + bw * 0.5 + 1}  y={H - th} width={bw} height={th} fill="#8b5cf6" rx="2" opacity="0.9" />
              <text x={x} y={H + 16} textAnchor="middle" fontSize="9" fill="#94a3b8">{d.week}</text>
            </g>
          )
        })}
        {/* Legend */}
        {[['#f97316','Posts'],['#0d9488','Sign-ups'],['#8b5cf6','Trades']].map(([c,l],i) => (
          <g key={l} transform={`translate(${pad + i * 110}, ${H + 30})`}>
            <rect width="10" height="10" fill={c} rx="2" y="-1" />
            <text x="14" fontSize="10" fill="#64748b" dominantBaseline="middle" dy="4">{l}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

// ─── Stat card ───────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, color }: { icon: string; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-[#f1f5f9] shadow-sm flex items-start gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0`} style={{ background: color + '18' }}>
        {icon}
      </div>
      <div>
        <div className="text-[11px] font-bold text-[#94a3b8] uppercase tracking-wider mb-0.5">{label}</div>
        <div className="text-[26px] font-black text-[#1e293b] leading-none">{value}</div>
        {sub && <div className="text-[11px] font-semibold text-[#94a3b8] mt-1">{sub}</div>}
      </div>
    </div>
  )
}

// ─── Admin login ─────────────────────────────────────────────────────────────

function LoginGate({ onAuth }: { onAuth: () => void }) {
  const [err, setErr] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  function submit(e: React.FormEvent) {
    e.preventDefault()
    const val = inputRef.current?.value ?? ''
    if (val === ADMIN_PASSCODE) { onAuth() }
    else { setErr(true); if (inputRef.current) inputRef.current.value = '' }
  }
  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="bg-white rounded-3xl p-8 shadow-xl border border-[#f1f5f9] w-full max-w-[380px]">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🔐</div>
          <h1 className="font-display text-[26px] text-[#1e293b]">Admin Access</h1>
          <p className="text-[13px] font-semibold text-[#94a3b8] mt-1">Enter your admin passcode to continue</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <input
            ref={inputRef}
            type="text"
            autoComplete="off"
            onChange={() => setErr(false)}
            placeholder="Admin passcode"
            className="w-full border-2 border-[#e2e8f0] rounded-xl px-4 py-3 font-bold text-[15px] focus:outline-none focus:border-bk-orange text-center tracking-widest"
            autoFocus
          />
          {err && <p className="text-red-500 font-bold text-[13px] text-center">Incorrect passcode</p>}
          <button type="submit" className="w-full bg-bk-orange text-white font-extrabold text-[15px] rounded-xl py-3 shadow-[0_3px_0_#c2410c]">
            Enter Admin Panel
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── User Locations Chart ────────────────────────────────────────────────────

type LocationView = 'city' | 'state' | 'street'

function UserLocationsChart({ users }: { users: User[] }) {
  const [view, setView] = useState<LocationView>('city')

  const data = useMemo(() => {
    const counts: Record<string, number> = {}
    users.forEach(u => {
      let key = ''
      if (view === 'city') {
        key = u.city
      } else if (view === 'state') {
        const parts = u.city.split(', ')
        key = parts[1] ?? u.city
      } else {
        // street — mock: group by first word of city as a stand-in for neighbourhood
        key = u.city.split(',')[0]
      }
      counts[key] = (counts[key] ?? 0) + 1
    })
    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
  }, [users, view])

  const max = Math.max(...data.map(d => d.count), 1)
  const BAR_COLORS = ['#f97316','#0d9488','#8b5cf6','#3b82f6','#ec4899','#eab308','#14b8a6']

  return (
    <div className="bg-white rounded-2xl p-5 border border-[#f1f5f9] shadow-sm">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h3 className="font-black text-[15px] text-[#1e293b]">User Locations</h3>
        <div className="flex gap-1.5">
          {(['city','state','street'] as LocationView[]).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1 rounded-full text-[11px] font-extrabold border-2 capitalize transition-colors ${view === v ? 'bg-bk-orange border-bk-orange text-white' : 'bg-white border-[#e2e8f0] text-[#64748b] hover:border-bk-orange'}`}>
              {v === 'street' ? 'Neighbourhood' : v === 'city' ? 'City' : 'State'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2.5">
        {data.map(({ label, count }, i) => (
          <div key={label} className="flex items-center gap-3">
            <div className="w-[130px] text-[12px] font-bold text-[#334155] truncate shrink-0 text-right">{label}</div>
            <div className="flex-1 h-7 bg-[#f1f5f9] rounded-full overflow-hidden relative">
              <div
                className="h-full rounded-full transition-all duration-500 flex items-center"
                style={{ width: `${(count / max) * 100}%`, background: BAR_COLORS[i % BAR_COLORS.length] }}
              />
            </div>
            <div className="w-8 text-[13px] font-extrabold shrink-0" style={{ color: BAR_COLORS[i % BAR_COLORS.length] }}>
              {count}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-[#f1f5f9] flex items-center justify-between text-[11px] font-bold text-[#94a3b8]">
        <span>{users.length} total users</span>
        <span>{data.length} unique {view === 'state' ? 'states' : view === 'city' ? 'cities' : 'neighbourhoods'}</span>
      </div>
    </div>
  )
}

// ─── Dashboard tab ───────────────────────────────────────────────────────────

function Dashboard({ users, pendingLocationReports, reviews }: { users: User[]; pendingLocationReports: number; reviews: Review[] }) {
  const totalCredits = users.reduce((s, u) => s + u.credits, 0)
  const totalBooks   = users.reduce((s, u) => s + u.booksPosted, 0)
  const totalTrades  = users.reduce((s, u) => s + u.booksSold, 0)
  const pendingReports = pendingLocationReports
  const flaggedReviews = reviews.filter(r => r.flagged).length

  const activityIcon: Record<string, string> = { signup:'👤', post:'📚', trade:'🔄', report:'📍', review:'⭐' }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-[22px] text-[#1e293b] mb-4">Overview</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon="👥" label="Total Users"         value={users.length}   sub={`${users.filter(u=>u.status==='active').length} active`}      color="#0d9488" />
          <StatCard icon="📚" label="Books Posted"        value={totalBooks}      sub={`${totalTrades} traded`}                                       color="#f97316" />
          <StatCard icon="🪙" label="Credits in Circ."   value={totalCredits}    sub="across all users"                                              color="#8b5cf6" />
          <StatCard icon="⚠️" label="Needs Attention"    value={pendingReports + flaggedReviews} sub={`${pendingReports} reports · ${flaggedReviews} reviews`} color="#ef4444" />
        </div>
      </div>

      <div className="bg-white rounded-2xl p-5 border border-[#f1f5f9] shadow-sm">
        <h3 className="font-black text-[15px] text-[#1e293b] mb-4">Weekly Activity</h3>
        <ActivityChart data={WEEKLY_ACTIVITY} />
      </div>

      <UserLocationsChart users={users} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent activity */}
        <div className="bg-white rounded-2xl p-5 border border-[#f1f5f9] shadow-sm">
          <h3 className="font-black text-[15px] text-[#1e293b] mb-3">Recent Activity</h3>
          <div className="space-y-2">
            {RECENT_ACTIVITY.map(a => (
              <div key={a.id} className="flex items-center gap-3 py-1.5">
                <span className="text-[17px] w-7 text-center shrink-0">{activityIcon[a.type]}</span>
                <span className="font-semibold text-[13px] text-[#334155] flex-1">{a.text}</span>
                <span className="text-[11px] font-bold text-[#94a3b8] shrink-0">{a.time}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top users */}
        <div className="bg-white rounded-2xl p-5 border border-[#f1f5f9] shadow-sm">
          <h3 className="font-black text-[15px] text-[#1e293b] mb-3">Top Users by Credits</h3>
          <div className="space-y-2">
            {[...users].sort((a,b) => b.credits - a.credits).slice(0,6).map((u,i) => (
              <div key={u.id} className="flex items-center gap-3">
                <span className="w-6 text-[11px] font-extrabold text-[#94a3b8] text-right">{i+1}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-[13px] text-[#334155] truncate">{u.username}</div>
                  <div className="h-1.5 bg-[#f1f5f9] rounded-full mt-1 overflow-hidden">
                    <div className="h-full bg-bk-orange rounded-full" style={{ width: `${(u.credits / users[0].credits * 100).toFixed(0)}%` }} />
                  </div>
                </div>
                <span className="font-extrabold text-[13px] text-bk-orange shrink-0">{u.credits} cr</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Users tab ───────────────────────────────────────────────────────────────

function UsersTab({ users, setUsers, toggleAdmin }: { users: User[]; setUsers: React.Dispatch<React.SetStateAction<User[]>>; toggleAdmin: (id: string, current: boolean) => void }) {
  const [search, setSearch] = useState('')
  const [editTarget, setEditTarget] = useState<User | null>(null)
  const [form, setForm] = useState<User | null>(null)

  const filtered = useMemo(() =>
    users.filter(u =>
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.city.toLowerCase().includes(search.toLowerCase())
    ), [users, search])

  function openEdit(u: User) { setEditTarget(u); setForm({ ...u }) }

  function saveEdit() {
    if (!form) return
    setUsers(prev => prev.map(u => u.id === form.id ? form : u))
    setEditTarget(null)
  }

  function toggleStatus(u: User) {
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, status: x.status === 'active' ? 'suspended' : 'active' } : x))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="font-display text-[22px] text-[#1e293b]">Users <span className="text-[#94a3b8] font-bold text-[16px] ml-1">({users.length})</span></h2>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search users…"
          className="border-2 border-[#e2e8f0] rounded-xl px-3 py-2 font-bold text-[13px] focus:outline-none focus:border-bk-orange w-[220px]"
        />
      </div>

      <div className="bg-white rounded-2xl border border-[#f1f5f9] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#f1f5f9] bg-[#f8fafc]">
                {['User','City','State','Books','Sold','Bought','Credits','Reviews','Status','Admin',''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-extrabold text-[#94a3b8] uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} className="border-b border-[#f8fafc] hover:bg-[#fafafa] transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-black text-[13px] text-[#1e293b]">{u.username}</div>
                    <div className="text-[11px] text-[#94a3b8] font-semibold">{u.email}</div>
                    <div className="text-[10px] text-[#cbd5e1] font-semibold">Joined {u.joined}</div>
                  </td>
                  <td className="px-4 py-3 text-[12px] font-semibold text-[#64748b] whitespace-nowrap">{u.city}</td>
                  <td className="px-4 py-3 text-[12px] font-semibold text-[#64748b] whitespace-nowrap">{u.state}</td>
                  <td className="px-4 py-3 text-[13px] font-extrabold text-[#f97316] text-center">{u.booksPosted}</td>
                  <td className="px-4 py-3 text-[13px] font-extrabold text-[#0d9488] text-center">{u.booksSold}</td>
                  <td className="px-4 py-3 text-[13px] font-extrabold text-[#8b5cf6] text-center">{u.booksBought}</td>
                  <td className="px-4 py-3 text-[13px] font-extrabold text-[#f59e0b] text-center">{u.credits}</td>
                  <td className="px-4 py-3 text-[13px] font-semibold text-[#64748b] text-center">{u.reviews}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleStatus(u)}
                      className={`text-[11px] font-extrabold px-2.5 py-1 rounded-full ${u.status === 'active' ? 'bg-[#ecfdf5] text-[#059669]' : 'bg-[#fef2f2] text-[#dc2626]'}`}>
                      {u.status === 'active' ? '● Active' : '● Suspended'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleAdmin(u.id, u.is_admin)}
                      className={`text-[11px] font-extrabold px-2.5 py-1 rounded-full transition-colors ${u.is_admin ? 'bg-[#f97316] text-white' : 'bg-[#f1f5f9] text-[#94a3b8] hover:bg-[#fed7aa] hover:text-[#c2410c]'}`}>
                      {u.is_admin ? '★ Admin' : '○ User'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => openEdit(u)}
                      className="text-[12px] font-bold text-bk-orange hover:underline whitespace-nowrap">
                      Edit ✏️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="py-12 text-center text-[#94a3b8] font-bold text-[14px]">No users match your search</div>
          )}
        </div>
      </div>

      {/* Edit modal */}
      {editTarget && form && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-3xl w-full max-w-[480px] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-[20px] text-[#1e293b]">Edit User</h2>
              <button onClick={() => setEditTarget(null)} className="text-[#94a3b8] hover:text-[#475569] text-[22px] font-black leading-none">×</button>
            </div>

            <div className="space-y-4 mb-5">
              <div>
                <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Username</label>
                <input value={form.username} onChange={e => setForm(f => f && ({ ...f, username: e.target.value }))}
                  className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
              </div>
              <div>
                <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Email</label>
                <input value={form.email} onChange={e => setForm(f => f && ({ ...f, email: e.target.value }))}
                  className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
              </div>
              <div>
                <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">City</label>
                <input value={form.city} onChange={e => setForm(f => f && ({ ...f, city: e.target.value }))}
                  className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
              </div>
              <div>
                <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Bio</label>
                <textarea value={form.bio} onChange={e => setForm(f => f && ({ ...f, bio: e.target.value }))}
                  rows={2} className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-semibold text-[14px] focus:outline-none focus:border-bk-orange resize-none" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Credits 🪙</label>
                  <input type="number" value={form.credits} min={0} onChange={e => setForm(f => f && ({ ...f, credits: parseInt(e.target.value)||0 }))}
                    className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-black text-[15px] focus:outline-none focus:border-bk-orange text-[#8b5cf6]" />
                </div>
                <div>
                  <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Status</label>
                  <select value={form.status} onChange={e => setForm(f => f && ({ ...f, status: e.target.value }))}
                    className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange bg-white">
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>
            </div>

            {/* User stats */}
            <div className="bg-[#f8fafc] rounded-xl p-4 mb-5 grid grid-cols-4 gap-3 text-center">
              <div>
                <div className="text-[20px] font-black text-bk-orange">{form.booksPosted}</div>
                <div className="text-[10px] font-bold text-[#94a3b8] uppercase">Posted</div>
              </div>
              <div>
                <div className="text-[20px] font-black text-[#0d9488]">{form.booksSold}</div>
                <div className="text-[10px] font-bold text-[#94a3b8] uppercase">Sold</div>
              </div>
              <div>
                <div className="text-[20px] font-black text-[#8b5cf6]">{form.booksBought}</div>
                <div className="text-[10px] font-bold text-[#94a3b8] uppercase">Bought</div>
              </div>
              <div>
                <div className="text-[20px] font-black text-[#64748b]">{form.reviews}</div>
                <div className="text-[10px] font-bold text-[#94a3b8] uppercase">Reviews</div>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setEditTarget(null)}
                className="flex-1 border-2 border-[#e2e8f0] rounded-xl py-3 font-extrabold text-[14px] text-[#64748b]">Cancel</button>
              <button onClick={saveEdit}
                className="flex-1 bg-bk-orange text-white rounded-xl py-3 font-extrabold text-[14px] shadow-[0_3px_0_#c2410c]">Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Reviews tab ─────────────────────────────────────────────────────────────

function ReviewsTab({ reviews, setReviews }: { reviews: Review[]; setReviews: React.Dispatch<React.SetStateAction<Review[]>> }) {
  const [editTarget, setEditTarget] = useState<Review | null>(null)
  const [editText, setEditText] = useState('')
  const [filter, setFilter] = useState<'all' | 'flagged'>('all')

  function openEdit(r: Review) { setEditTarget(r); setEditText(r.text) }

  function saveEdit() {
    if (!editTarget) return
    setReviews(prev => prev.map(r => r.id === editTarget.id ? { ...r, text: editText, flagged: false } : r))
    setEditTarget(null)
  }

  function deleteReview(id: string) {
    setReviews(prev => prev.filter(r => r.id !== id))
  }

  function unflag(id: string) {
    setReviews(prev => prev.map(r => r.id === id ? { ...r, flagged: false } : r))
  }

  const shown = filter === 'flagged' ? reviews.filter(r => r.flagged) : reviews
  const flaggedCount = reviews.filter(r => r.flagged).length

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="font-display text-[22px] text-[#1e293b]">Reviews <span className="text-[#94a3b8] font-bold text-[16px] ml-1">({reviews.length})</span></h2>
        <div className="flex gap-2">
          {(['all','flagged'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full font-extrabold text-[12px] border-2 transition-colors ${filter === f ? 'bg-bk-orange border-bk-orange text-white' : 'bg-white border-[#e2e8f0] text-[#64748b]'}`}>
              {f === 'all' ? 'All' : `⚠️ Flagged (${flaggedCount})`}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {shown.map(r => (
          <div key={r.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${r.flagged ? 'border-[#fecaca]' : 'border-[#f1f5f9]'}`}>
            <div className={`px-5 py-3 flex items-center gap-3 border-b ${r.flagged ? 'bg-[#fef2f2] border-[#fecaca]' : 'bg-[#f8fafc] border-[#f1f5f9]'}`}>
              <div className="flex gap-0.5">
                {[1,2,3,4,5].map(s => (
                  <span key={s} className={s <= r.rating ? 'text-yellow-400' : 'text-[#e2e8f0]'} style={{ fontSize: 14 }}>★</span>
                ))}
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-black text-[13px] text-[#1e293b]">{r.reviewer}</span>
                <span className="text-[12px] text-[#94a3b8] font-semibold ml-2">on <span className="font-bold text-[#334155]">{r.book}</span></span>
              </div>
              {r.flagged && <span className="text-[11px] font-extrabold bg-[#fecaca] text-[#dc2626] px-2 py-0.5 rounded-full shrink-0">⚠️ Flagged</span>}
              <span className="text-[11px] text-[#94a3b8] font-semibold shrink-0">{r.date}</span>
            </div>
            <div className="px-5 py-3 flex items-start gap-4">
              <p className="flex-1 font-semibold text-[13px] text-[#334155] leading-relaxed">"{r.text}"</p>
              <div className="flex gap-2 shrink-0">
                {r.flagged && (
                  <button onClick={() => unflag(r.id)}
                    className="text-[11px] font-bold text-[#059669] bg-[#f0fdf4] border border-[#bbf7d0] px-2.5 py-1.5 rounded-lg hover:bg-green-100 transition-colors">
                    ✓ Unflag
                  </button>
                )}
                <button onClick={() => openEdit(r)}
                  className="text-[11px] font-bold text-[#64748b] bg-[#f8fafc] border border-[#e2e8f0] px-2.5 py-1.5 rounded-lg hover:bg-[#f1f5f9] transition-colors">
                  ✏️ Edit
                </button>
                <button onClick={() => deleteReview(r.id)}
                  className="text-[11px] font-bold text-[#dc2626] bg-[#fef2f2] border border-[#fecaca] px-2.5 py-1.5 rounded-lg hover:bg-red-100 transition-colors">
                  🗑️
                </button>
              </div>
            </div>
          </div>
        ))}
        {shown.length === 0 && (
          <div className="bg-white rounded-2xl border border-[#f1f5f9] p-12 text-center">
            <div className="text-4xl mb-3">✅</div>
            <p className="font-black text-[16px] text-[#1e293b]">No flagged reviews</p>
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editTarget && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-3xl w-full max-w-[460px] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-[20px] text-[#1e293b]">Edit Review</h2>
              <button onClick={() => setEditTarget(null)} className="text-[#94a3b8] text-[22px] font-black leading-none">×</button>
            </div>
            <div className="bg-[#f8fafc] rounded-xl p-3 mb-4 text-[12px] font-semibold text-[#64748b]">
              <span className="font-black text-[#334155]">{editTarget.reviewer}</span> · {editTarget.book}
            </div>
            <textarea
              value={editText}
              onChange={e => setEditText(e.target.value)}
              rows={4}
              className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-semibold text-[14px] focus:outline-none focus:border-bk-orange resize-none mb-4"
            />
            <div className="flex gap-3">
              <button onClick={() => setEditTarget(null)}
                className="flex-1 border-2 border-[#e2e8f0] rounded-xl py-3 font-extrabold text-[14px] text-[#64748b]">Cancel</button>
              <button onClick={saveEdit}
                className="flex-1 bg-bk-orange text-white rounded-xl py-3 font-extrabold text-[14px] shadow-[0_3px_0_#c2410c]">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main AdminClient ────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id:'dashboard', label:'Dashboard',  icon:'📊' },
  { id:'users',     label:'Users',      icon:'👥' },
  { id:'locations', label:'Locations',  icon:'📍' },
  { id:'reviews',   label:'Reviews',    icon:'⭐' },
]

export default function AdminClient() {
  const [authed, setAuthed] = useState<'loading' | 'yes' | 'no'>('loading')
  const [tab, setTab] = useState<Tab>('dashboard')
  const [users, setUsers] = useState<User[]>([])
  const [pendingLocationReports, setPendingLocationReports] = useState(0)
  const [reviews, setReviews] = useState(MOCK_REVIEWS)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    try {
      const k = localStorage.getItem('lbe_admin_auth')
      setAuthed(k === 'lbe_admin_2024' ? 'yes' : 'no')
    } catch { setAuthed('no') }
  }, [])

  useEffect(() => {
    if (authed !== 'yes') return
    const supabase = createClient()
    supabase
      .from('profiles')
      .select('id, username, email, city, state, created_at, is_admin')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!data) return
        setUsers(data.map(p => ({
          id: p.id,
          username: p.username || p.email || 'Unknown',
          email: p.email || '',
          joined: p.created_at ? p.created_at.slice(0, 10) : '',
          booksPosted: 0,
          booksSold: 0,
          booksBought: 0,
          credits: 0,
          status: 'active',
          city: p.city || '',
          state: p.state || '',
          bio: '',
          reviews: 0,
          is_admin: p.is_admin || false,
        })))
      })
  }, [authed])

  async function toggleAdmin(userId: string, current: boolean) {
    const supabase = createClient()
    const { error } = await supabase
      .from('profiles')
      .update({ is_admin: !current })
      .eq('id', userId)
    if (!error) {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_admin: !current } : u))
    }
  }

  function handleAuth() {
    try { localStorage.setItem('lbe_admin_auth', 'lbe_admin_2024') } catch {}
    setAuthed('yes')
  }

  function handleSignOut() {
    try { localStorage.removeItem('lbe_admin_auth') } catch {}
    setAuthed('no')
  }

  if (authed === 'loading') return <LoginGate onAuth={handleAuth} />
  if (authed === 'no') return <LoginGate onAuth={handleAuth} />

  const flaggedReviews = reviews.filter(r => r.flagged).length

  function badge(id: Tab) {
    if (id === 'locations') return pendingLocationReports
    if (id === 'reviews') return flaggedReviews
    return 0
  }

  return (
    <div className="flex min-h-[calc(100vh-68px)]">

      {/* Sidebar — desktop */}
      <aside className="hidden md:flex flex-col w-[220px] bg-[#1e293b] shrink-0">
        <div className="px-5 py-5 border-b border-white/10">
          <div className="font-display text-[17px] text-white">🔐 Admin Panel</div>
          <div className="text-[11px] text-white/40 font-semibold mt-0.5">LittleBookExchange</div>
        </div>
        <nav className="flex-1 py-3">
          {TABS.map(t => {
            const b = badge(t.id)
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors ${tab === t.id ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}`}>
                <span className="text-[17px]">{t.icon}</span>
                <span className="font-bold text-[14px] flex-1">{t.label}</span>
                {b > 0 && <span className="bg-red-500 text-white text-[10px] font-extrabold w-5 h-5 rounded-full flex items-center justify-center">{b}</span>}
              </button>
            )
          })}
        </nav>
        <div className="px-5 py-4 border-t border-white/10">
          <button onClick={handleSignOut} className="text-[12px] font-bold text-white/40 hover:text-white/70 transition-colors">
            🚪 Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile tab bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#1e293b] flex border-t border-white/10" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {TABS.map(t => {
          const b = badge(t.id)
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 flex flex-col items-center py-2 gap-0.5 relative transition-colors ${tab === t.id ? 'text-white' : 'text-white/40'}`}>
              <span className="text-[18px]">{t.icon}</span>
              <span className="text-[9px] font-extrabold uppercase">{t.label}</span>
              {b > 0 && <span className="absolute top-1 right-[20%] bg-red-500 text-white text-[9px] font-extrabold w-4 h-4 rounded-full flex items-center justify-center">{b}</span>}
            </button>
          )
        })}
      </div>

      {/* Main content */}
      <div className="flex-1 bg-[#f8fafc] overflow-auto">
        <div className="max-w-[1100px] mx-auto px-4 md:px-6 py-6 pb-24 md:pb-6">
          {tab === 'dashboard' && <Dashboard users={users} pendingLocationReports={pendingLocationReports} reviews={reviews} />}
          {tab === 'users'     && <UsersTab users={users} setUsers={setUsers} toggleAdmin={toggleAdmin} />}
          {tab === 'locations' && <LocationsAdminTab onPendingCountChange={setPendingLocationReports} />}
          {tab === 'reviews'   && <ReviewsTab reviews={reviews} setReviews={setReviews} />}
        </div>
      </div>
    </div>
  )
}
