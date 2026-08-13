import { unsubscribeFromMarketing } from '@/lib/actions/unsubscribe'

export default async function UnsubscribePage({ params, searchParams }: { params: { userId: string }; searchParams: { t?: string } }) {
  const result = await unsubscribeFromMarketing(params.userId, searchParams.t ?? '')

  return (
    <div className="flex items-center justify-center px-4 py-16" style={{ minHeight: 'calc(100vh - 68px)' }}>
      <div className="bg-white rounded-[28px] p-8 w-full max-w-[440px] border-2 border-gray-100 shadow-[0_8px_0_#e5e7eb] text-center">
        {result.ok ? (
          <>
            <h1 className="font-display text-[22px] text-bk-orange mb-2">You're unsubscribed</h1>
            <p className="text-[14px] font-bold" style={{ color: '#aaa' }}>
              You won't get announcement emails from Little Book Exchange anymore.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display text-[22px] text-bk-orange mb-2">Link expired</h1>
            <p className="text-[14px] font-bold" style={{ color: '#aaa' }}>
              This unsubscribe link is invalid or has expired.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
