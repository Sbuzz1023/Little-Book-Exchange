'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const AVATAR_COLORS = [
  '#f97316', '#0d9488', '#8b5cf6', '#ec4899', '#3b82f6', '#10b981',
]

function avatarColor(str: string) {
  const sum = str.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return AVATAR_COLORS[sum % AVATAR_COLORS.length]
}

function initial(name: string) {
  return (name ?? '?')[0].toUpperCase()
}

function timeAgo(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(diff / 86400000)
  if (days < 7) return `${days}d`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function ConversationSidebar({
  conversations,
  userId,
}: {
  conversations: any[]
  userId: string
}) {
  const pathname = usePathname()

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '2px solid #e5e7eb',
        background: '#fff',
        overflowY: 'auto',
      }}
    >
      {/* Sidebar header */}
      <div
        style={{
          padding: '20px 20px 14px',
          borderBottom: '2px solid #f3f4f6',
          flexShrink: 0,
        }}
      >
        <p className="font-display text-[22px] text-bk-orange">Messages</p>
      </div>

      {/* Conversation list */}
      {conversations.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-center px-6 py-10 font-bold" style={{ color: '#ccc' }}>
          <div>
            <div className="text-4xl mb-3">💬</div>
            <p className="text-[13px]">No conversations yet</p>
          </div>
        </div>
      ) : (
        conversations.map((convo, idx) => {
          const other = convo.buyer_id === userId ? convo.seller : convo.buyer
          const otherName = other?.name || other?.username || 'Neighbor'
          const msgs = (convo.messages ?? []).slice().sort(
            (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )
          const lastMsg = msgs[0]
          const isActive = pathname === `/messages/${convo.id}`
          const color = avatarColor(otherName)

          return (
            <Link
              key={convo.id}
              href={`/messages/${convo.id}`}
              scroll={false}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 16px',
                textDecoration: 'none',
                color: 'inherit',
                borderLeft: isActive ? '3px solid #f97316' : '3px solid transparent',
                background: isActive ? '#fff7ed' : 'transparent',
                borderBottom: '1px solid #f3f4f6',
                transition: 'background 0.12s',
              }}
            >
              {/* Avatar */}
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  color: '#fff',
                  fontWeight: 900,
                  fontSize: 17,
                  fontFamily: 'inherit',
                }}
              >
                {initial(otherName)}
              </div>

              {/* Text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, marginBottom: 2 }}>
                  <p
                    style={{
                      fontSize: 14,
                      fontWeight: 800,
                      color: '#1a1a1a',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {otherName}
                  </p>
                  {lastMsg && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#bbb', flexShrink: 0 }}>
                      {timeAgo(lastMsg.created_at)}
                    </span>
                  )}
                </div>
                <p
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: isActive ? '#f97316' : '#aaa',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginBottom: 2,
                  }}
                >
                  📚 {convo.listings?.title}
                </p>
                {lastMsg && (
                  <p
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#bbb',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {lastMsg.body}
                  </p>
                )}
              </div>
            </Link>
          )
        })
      )}
    </div>
  )
}
