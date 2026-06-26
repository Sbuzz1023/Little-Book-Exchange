'use client'

import { useState } from 'react'

type Props = {
  profile: { name: string; city: string } | null
  updateAction: (formData: FormData) => Promise<void>
  success?: boolean
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
        <h2 className="font-display text-[22px] text-bk-orange">Account</h2>
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
          <label
            className="block mb-1.5"
            style={{ fontSize: 12, fontWeight: 900, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}
          >
            Name
          </label>
          <input
            name="name"
            defaultValue={profile?.name}
            required
            className="w-full border-2 border-[#fed7aa] rounded-[12px] px-4 bg-cream font-bold text-[15px] focus:outline-none focus:border-bk-orange"
            style={{ padding: '12px 16px', marginBottom: 16 }}
          />
          <label
            className="block mb-1.5"
            style={{ fontSize: 12, fontWeight: 900, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}
          >
            City
          </label>
          <input
            name="city"
            defaultValue={profile?.city}
            required
            className="w-full border-2 border-[#fed7aa] rounded-[12px] px-4 bg-cream font-bold text-[15px] focus:outline-none focus:border-bk-orange"
            style={{ padding: '12px 16px', marginBottom: 16 }}
          />
          <div className="flex gap-2.5 mt-1">
            <button
              type="submit"
              className="text-white font-extrabold text-[15px] shadow-[0_3px_0_#c2410c]"
              style={{
                background: '#f97316',
                padding: '12px 28px',
                borderRadius: 12,
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Save Changes
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="font-extrabold text-[14px] hover:border-red-300 hover:text-red-400 transition-colors"
              style={{
                border: '2px solid #e5e7eb',
                color: '#aaa',
                padding: '10px 20px',
                borderRadius: 12,
                background: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex gap-7 flex-wrap">
          {[
            { label: 'Name', value: profile?.name || '—' },
            { label: 'City', value: profile?.city || '—' },
          ].map(s => (
            <div key={s.label} className="flex flex-col gap-1">
              <span
                style={{ fontSize: 11, fontWeight: 900, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px' }}
              >
                {s.label}
              </span>
              <span className="font-black text-[20px] text-[#1a1a1a]">{s.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
