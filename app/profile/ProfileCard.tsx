'use client'

import { useState } from 'react'

type Props = {
  profile: {
    name?: string | null
    username?: string | null
    email?: string | null
    city?: string | null
    state?: string | null
    phone?: string | null
    created_at?: string | null
  } | null
  updateAction: (formData: FormData) => Promise<void>
  success?: boolean
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 900, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px',
}

const inputClass = "w-full border-2 border-[#fed7aa] rounded-[12px] px-4 bg-cream font-bold text-[15px] focus:outline-none focus:border-bk-orange"

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <span style={labelStyle}>{label}</span>
      <span className="font-black text-[18px] text-[#1a1a1a]">{value || '—'}</span>
    </div>
  )
}

function EditLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block mb-1.5" style={{ fontSize: 12, fontWeight: 900, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      {children}
    </label>
  )
}

function formatDate(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export default function ProfileCard({ profile, updateAction, success }: Props) {
  const [editing, setEditing] = useState(false)

  return (
    <div
      id="profile"
      className="bg-white border-2 border-gray-100 shadow-[0_6px_0_#e5e7eb]"
      style={{ borderRadius: 24, padding: 28 }}
    >
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-display text-[22px] text-bk-orange">Profile</h2>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="font-extrabold text-[13px] transition-colors hover:border-bk-orange hover:text-bk-orange"
            style={{
              border: '2px solid #e5e7eb',
              color: '#555',
              padding: '7px 16px',
              borderRadius: 999,
              background: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            ✏️ Edit
          </button>
        )}
      </div>

      {success && (
        <div className="bg-green-50 border-2 border-green-200 rounded-xl px-4 py-2 text-green-700 font-bold text-sm mb-4">
          Profile updated!
        </div>
      )}

      {editing ? (
        <form action={updateAction} onSubmit={() => setEditing(false)}>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <EditLabel>City</EditLabel>
              <input name="city" defaultValue={profile?.city ?? ''} required
                className={inputClass} style={{ padding: '12px 16px' }} />
            </div>
            <div>
              <EditLabel>State</EditLabel>
              <input name="state" defaultValue={profile?.state ?? ''} required
                className={inputClass} style={{ padding: '12px 16px' }} />
            </div>
            <div>
              <EditLabel>Phone</EditLabel>
              <input name="phone" defaultValue={profile?.phone ?? ''} type="tel"
                className={inputClass} style={{ padding: '12px 16px' }} />
            </div>
          </div>
          <div className="flex gap-2.5 mt-5">
            <button
              type="submit"
              className="text-white font-extrabold text-[15px] shadow-[0_3px_0_#c2410c]"
              style={{ background: '#f97316', padding: '12px 28px', borderRadius: 12, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Save Changes
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="font-extrabold text-[14px] hover:border-red-300 hover:text-red-400 transition-colors"
              style={{ border: '2px solid #e5e7eb', color: '#aaa', padding: '10px 20px', borderRadius: 12, background: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
          <Field label="Username" value={profile?.username} />
          <Field label="Email" value={profile?.email} />
          <Field label="City" value={profile?.city} />
          <Field label="State" value={profile?.state} />
          <Field label="Phone" value={profile?.phone} />
          <Field label="Member Since" value={formatDate(profile?.created_at)} />
        </div>
      )}
    </div>
  )
}
