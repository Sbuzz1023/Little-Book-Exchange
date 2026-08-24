// app/admin/EmailsAdminTab.tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import EmailTemplatesEditor from './EmailTemplatesEditor'
import EmailComposeTab from './EmailComposeTab'
import EmailResendTool from './EmailResendTool'
import AdminInboxTab from './AdminInboxTab'

type EmailUser = { id: string; username: string; email: string; city: string; state: string }
type SubTab = 'templates' | 'compose' | 'resend' | 'inbox'

export default function EmailsAdminTab({
  users, messagePrefillUserId, onPrefillConsumed, onInboxUnreadCountChange, inboxUnreadCount: inboxUnreadCountProp = 0,
}: {
  users: EmailUser[]
  messagePrefillUserId?: string | null
  onPrefillConsumed?: () => void
  onInboxUnreadCountChange?: (count: number) => void
  // The parent's own standalone count — populated as soon as the admin panel
  // loads, well before Inbox is ever opened. Used for the pill badge until
  // AdminInboxTab's own richer, live count takes over once it mounts.
  inboxUnreadCount?: number
}) {
  const [subTab, setSubTab] = useState<SubTab>('compose')
  const [inboxUnreadCount, setInboxUnreadCount] = useState(inboxUnreadCountProp)
  const hasOwnInboxCount = useRef(false)

  useEffect(() => {
    if (!hasOwnInboxCount.current) setInboxUnreadCount(inboxUnreadCountProp)
  }, [inboxUnreadCountProp])

  function handleInboxUnreadCountChange(count: number) {
    hasOwnInboxCount.current = true
    setInboxUnreadCount(count)
    onInboxUnreadCountChange?.(count)
  }

  useEffect(() => {
    if (messagePrefillUserId) setSubTab('compose')
  }, [messagePrefillUserId])

  const SUB_TABS: { id: SubTab; label: string }[] = [
    { id: 'compose', label: 'Compose' },
    { id: 'templates', label: 'Templates' },
    { id: 'resend', label: 'Resend' },
    { id: 'inbox', label: 'Inbox' },
  ]

  return (
    <div>
      <div className="flex gap-2 mb-5">
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            className={`px-3 py-1.5 rounded-full font-extrabold text-[12px] border-2 transition-colors flex items-center gap-1.5 ${subTab === t.id ? 'bg-bk-orange border-bk-orange text-white' : 'bg-white border-[#e2e8f0] text-[#64748b]'}`}>
            {t.label}
            {t.id === 'inbox' && inboxUnreadCount > 0 && (
              <span className="bg-red-500 text-white text-[10px] font-extrabold w-5 h-5 rounded-full flex items-center justify-center">{inboxUnreadCount}</span>
            )}
          </button>
        ))}
      </div>

      {subTab === 'compose' && <EmailComposeTab users={users} prefillUserId={messagePrefillUserId} onPrefillConsumed={onPrefillConsumed} />}
      {subTab === 'templates' && <EmailTemplatesEditor />}
      {subTab === 'resend' && <EmailResendTool users={users} />}
      {subTab === 'inbox' && <AdminInboxTab onUnreadCountChange={handleInboxUnreadCountChange} />}
    </div>
  )
}
