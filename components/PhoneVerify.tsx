'use client'

import { useState } from 'react'

type Props = {
  phone: string
  onPhoneChange?: (value: string) => void
  phoneVerified: boolean
  sendPhoneOtp: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
  verifyPhoneOtp: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
  onVerified: () => void
}

export default function PhoneVerify({ phone, onPhoneChange, phoneVerified, sendPhoneOtp, verifyPhoneOtp, onVerified }: Props) {
  const [step, setStep] = useState<'idle' | 'code_sent'>('idle')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (phoneVerified) return null

  if (step === 'idle') {
    return (
      <button
        type="button"
        onClick={() => setStep('code_sent')}
        className="font-extrabold text-[12px]"
        style={{ background: 'none', border: 'none', color: '#059669', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}
      >
        Verify Phone
      </button>
    )
  }

  return (
    <div className="mt-2 flex flex-col" style={{ gap: 6 }}>
      {onPhoneChange && (
        <input
          type="tel" value={phone} onChange={e => onPhoneChange(e.target.value)}
          className="border-2 border-[#a7f3d0] rounded-lg px-2 py-1.5 font-bold text-[12px]"
        />
      )}
      <button
        type="button"
        onClick={async () => {
          const fd = new FormData()
          fd.set('phone', phone)
          const res = await sendPhoneOtp(fd)
          setError(res.ok ? null : (res.error ?? 'Failed to send code.'))
        }}
        className="font-extrabold text-[12px] self-start"
        style={{ background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
      >
        Send code
      </button>
      <input
        type="text" placeholder="Enter 6-digit code" value={code} onChange={e => setCode(e.target.value)}
        className="border-2 border-[#a7f3d0] rounded-lg px-2 py-1.5 font-bold text-[12px]"
      />
      <button
        type="button"
        onClick={async () => {
          const fd = new FormData()
          fd.set('phone', phone)
          fd.set('token', code)
          const res = await verifyPhoneOtp(fd)
          if (res.ok) {
            setStep('idle'); setError(null); setCode('')
            onVerified()
          } else {
            setError(res.error ?? 'Invalid code.')
          }
        }}
        className="font-extrabold text-[12px] self-start"
        style={{ background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
      >
        Confirm code
      </button>
      {error && <p className="font-bold text-[11px]" style={{ color: '#e11d48' }}>{error}</p>}
    </div>
  )
}
