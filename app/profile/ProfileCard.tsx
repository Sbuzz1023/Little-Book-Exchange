'use client'

import { useState } from 'react'
import ShareToggle from '@/components/ShareToggle'
import AddressAutofillField from '@/components/AddressAutofillField'
import PhoneVerify from '@/components/PhoneVerify'

type Props = {
  profile: {
    id?: string | null
    name?: string | null
    username?: string | null
    email?: string | null
    city?: string | null
    state?: string | null
    phone?: string | null
    phone_verified?: boolean | null
    address?: string | null
    address_unit?: string | null
    zip?: string | null
    share_address?: boolean | null
    pickup_description?: string | null
    share_pickup?: boolean | null
    notify_message?: boolean | null
    notify_purchase_request?: boolean | null
    notify_purchase_decision?: boolean | null
    notify_tbr_match?: boolean | null
    notify_pickup?: boolean | null
    created_at?: string | null
  } | null
  updateAction: (formData: FormData) => Promise<void>
  success?: boolean
  error?: string | null
  sendPhoneOtp: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
  verifyPhoneOtp: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
  onPhoneVerified: () => void
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 900, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px',
}

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 900, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12,
}

const inputClass = "w-full border-2 border-[#fed7aa] rounded-[12px] px-4 bg-cream font-bold text-[15px] focus:outline-none focus:border-bk-orange"

const staticValueStyle: React.CSSProperties = {
  padding: '12px 16px', borderRadius: 12, background: '#f3f4f6', border: '2px solid #e5e7eb',
  color: '#555', fontWeight: 700, fontSize: 15,
}

function Field({ label, value, full }: { label: string; value?: string | null; full?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 min-w-0 ${full ? 'col-span-2' : ''}`}>
      <span style={labelStyle}>{label}</span>
      <span className="font-black text-[18px] text-[#1a1a1a] break-words">{value || '—'}</span>
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

export default function ProfileCard({ profile, updateAction, success, error, sendPhoneOtp, verifyPhoneOtp, onPhoneVerified }: Props) {
  const [editing, setEditing] = useState(false)
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const phoneVerified = !!profile?.phone_verified
  const hasAddressInfo = !!(profile?.city || profile?.state || profile?.address || profile?.zip)

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

      {error && (
        <div className="bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-red-700 font-bold text-sm mb-4">
          {error}
        </div>
      )}

      {editing ? (
        <form action={updateAction} onSubmit={() => setEditing(false)}>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <EditLabel>Username</EditLabel>
              <input name="username" defaultValue={profile?.username ?? ''} type="text" required
                className={inputClass} style={{ padding: '12px 16px' }} />
            </div>

            <div>
              <EditLabel>Email</EditLabel>
              <div style={staticValueStyle}>{profile?.email || '—'}</div>
            </div>

            <div>
              <EditLabel>Phone</EditLabel>
              {phoneVerified ? (
                <div className="flex items-center gap-2">
                  <input name="phone" value={phone} readOnly type="tel"
                    style={staticValueStyle} className="flex-1" />
                  <span style={{ color: '#059669', fontWeight: 900, fontSize: 13 }}>✅ Verified</span>
                </div>
              ) : (
                <>
                  <input name="phone" value={phone} onChange={e => setPhone(e.target.value)} type="tel"
                    className={inputClass} style={{ padding: '12px 16px' }} />
                  <PhoneVerify
                    phone={phone}
                    phoneVerified={false}
                    sendPhoneOtp={sendPhoneOtp}
                    verifyPhoneOtp={verifyPhoneOtp}
                    onVerified={onPhoneVerified}
                  />
                </>
              )}
            </div>

            {/* Address section */}
            <div style={{ borderTop: '2px dashed #fed7aa', paddingTop: 16, marginTop: 4 }}>
              <p style={sectionHeaderStyle}>
                📍 Address
              </p>
              <div className="flex flex-col gap-4">
                <AddressAutofillField
                  defaultAddress={profile?.address ?? ''}
                  defaultCity={profile?.city ?? ''}
                  defaultState={profile?.state ?? ''}
                  defaultZip={profile?.zip ?? ''}
                  inputClassName={inputClass}
                  inputStyle={{ padding: '12px 16px' }}
                  labelStyle={{ fontSize: 12, fontWeight: 900, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}
                />
                <div>
                  <EditLabel>Apt / Unit #</EditLabel>
                  <input name="address_unit" defaultValue={profile?.address_unit ?? ''}
                    placeholder="e.g. Apt 2B"
                    className={inputClass} style={{ padding: '12px 16px' }} />
                </div>
                <ShareToggle
                  name="share_address"
                  defaultValue={profile?.share_address ?? true}
                  label="Share address after approval"
                  hint="🏠 Your street address is only revealed to a buyer after you approve their purchase request."
                />
              </div>
            </div>

            {/* Pickup section */}
            <div style={{ borderTop: '2px dashed #fed7aa', paddingTop: 16, marginTop: 4 }}>
              <p style={sectionHeaderStyle}>
                📦 Pickup Spot
              </p>
              <div className="flex flex-col gap-4">
                <div>
                  <EditLabel>Default Pickup Description</EditLabel>
                  <input name="pickup_description" defaultValue={profile?.pickup_description ?? ''}
                    placeholder="e.g. front porch, behind the garden gnome"
                    className={inputClass} style={{ padding: '12px 16px' }} />
                </div>
                <ShareToggle
                  name="share_pickup"
                  defaultValue={profile?.share_pickup ?? true}
                  label="Share pickup spot after approval"
                  hint="📦 Only revealed to a buyer after you approve their purchase."
                />
              </div>
            </div>

            {/* Notifications section */}
            <div style={{ borderTop: '2px dashed #fed7aa', paddingTop: 16, marginTop: 4 }}>
              <p style={sectionHeaderStyle}>
                🔔 Notifications
              </p>
              <div className="flex flex-col gap-3">
                <ShareToggle
                  name="notify_message"
                  defaultValue={profile?.notify_message ?? true}
                  label="New messages"
                  hint="Get notified when someone messages you about a listing."
                />
                <ShareToggle
                  name="notify_purchase_request"
                  defaultValue={profile?.notify_purchase_request ?? true}
                  label="Purchase requests"
                  hint="Get notified when someone requests one of your books."
                />
                <ShareToggle
                  name="notify_purchase_decision"
                  defaultValue={profile?.notify_purchase_decision ?? true}
                  label="Purchase decisions"
                  hint="Get notified when a seller confirms or declines your request."
                />
                <ShareToggle
                  name="notify_tbr_match"
                  defaultValue={profile?.notify_tbr_match ?? true}
                  label="TBR matches"
                  hint="Get notified when a book on your TBR list becomes available."
                />
                <ShareToggle
                  name="notify_pickup"
                  defaultValue={profile?.notify_pickup ?? true}
                  label="Pickup confirmations"
                  hint="Get notified when the other party marks a book picked up."
                />
              </div>
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
        <div className="flex flex-col" style={{ gap: 20 }}>
          <div className="grid grid-cols-2 gap-x-8 gap-y-5">
            <Field label="Username" value={profile?.username} />
            <Field label="Email" value={profile?.email} />
            <Field label="Phone" value={profile?.phone ? `${profile.phone}${phoneVerified ? ' ✅' : ''}` : null} />
            <Field label="Member Since" value={formatDate(profile?.created_at)} />
          </div>

          {hasAddressInfo && (
            <div style={{ borderTop: '2px dashed #fed7aa', paddingTop: 16 }}>
              <p style={sectionHeaderStyle}>📍 Address</p>
              <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                {profile?.address && (
                  <Field label="Address" value={[profile.address, profile.address_unit].filter(Boolean).join(' ')} full />
                )}
                <Field label="City" value={profile?.city} />
                <Field label="State" value={profile?.state} />
                {profile?.zip && <Field label="Zip" value={profile.zip} />}
              </div>
            </div>
          )}

          {profile?.pickup_description && (
            <div style={{ borderTop: '2px dashed #fed7aa', paddingTop: 16 }}>
              <p style={sectionHeaderStyle}>📦 Pickup Spot</p>
              <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                <Field label="Pickup Spot" value={profile.pickup_description} full />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
