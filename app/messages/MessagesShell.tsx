'use client'
import { usePathname } from 'next/navigation'
import ConversationSidebar from './ConversationSidebar'

export default function MessagesShell({
  conversations,
  userId,
  children,
}: {
  conversations: any[]
  userId: string
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const inThread = pathname !== '/messages'

  return (
    <div style={{ position: 'fixed', top: 68, left: 0, right: 0, bottom: 0, display: 'flex', overflow: 'hidden', zIndex: 10 }}>
      {/* Sidebar: full-screen on mobile when on /messages, hidden on mobile when in a thread */}
      <div className={`${inThread ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-[300px] md:flex-shrink-0`}>
        <ConversationSidebar conversations={conversations} userId={userId} />
      </div>
      {/* Content: full-screen on mobile when in thread, hidden on mobile when on index */}
      <div className={`${inThread ? 'flex' : 'hidden md:flex'} flex-1 flex-col overflow-hidden`}>
        {children}
      </div>
    </div>
  )
}
