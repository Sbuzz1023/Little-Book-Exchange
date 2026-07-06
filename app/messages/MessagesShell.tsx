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
    <div className="flex" style={{ height: 'calc(100vh - 68px)', overflow: 'hidden', background: '#fffbf0' }}>

      {/* Sidebar: full-screen on mobile at /messages, 300px column on desktop */}
      <div
        className={`${inThread ? 'hidden md:block' : 'block'} w-full md:w-[300px] md:shrink-0`}
        style={{ borderRight: '2px solid #e5e7eb', overflowY: 'auto', background: '#fff' }}
      >
        <ConversationSidebar conversations={conversations} userId={userId} />
      </div>

      {/* Thread pane */}
      <div
        className={`${inThread ? 'flex' : 'hidden md:flex'} flex-1 flex-col overflow-hidden`}
      >
        {children}
      </div>

    </div>
  )
}
