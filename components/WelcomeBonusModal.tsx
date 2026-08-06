'use client'

import { useRouter, useSearchParams } from 'next/navigation'

export default function WelcomeBonusModal() {
  const searchParams = useSearchParams()
  const router = useRouter()

  if (searchParams.get('welcome') !== '1') return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
    >
      <div
        className="bg-white max-w-[420px] w-full text-center"
        style={{ borderRadius: 24, padding: 32, border: '2px solid #fed7aa', boxShadow: '0 8px 0 #e5e7eb' }}
      >
        <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
        <h2 className="font-display text-[22px] text-bk-orange mb-2">Welcome to Little Book Exchange!</h2>
        <p className="font-semibold text-[14px] mb-5" style={{ color: '#666' }}>
          Earn your first free credit by completing three quick steps:
        </p>
        <div className="text-left font-bold text-[13px] flex flex-col mb-6" style={{ gap: 8, color: '#444' }}>
          <p>☐ Verify email</p>
          <p>☐ Verify phone</p>
          <p>☐ Post 3 books</p>
        </div>
        <button
          type="button"
          onClick={() => router.replace('/profile?tab=wallet')}
          className="block w-full text-white font-black text-[15px]"
          style={{ background: '#f97316', padding: 14, borderRadius: 14, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Take me to my Wallet →
        </button>
      </div>
    </div>
  )
}
