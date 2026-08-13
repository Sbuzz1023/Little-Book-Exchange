// app/admin/EmailsAdminTab.tsx
'use client'
import { useState } from 'react'
import EmailTemplatesEditor from './EmailTemplatesEditor'
import EmailComposeTab from './EmailComposeTab'
import EmailResendTool from './EmailResendTool'

type EmailUser = { id: string; username: string; email: string; city: string; state: string }
type SubTab = 'templates' | 'compose' | 'resend'

export default function EmailsAdminTab({ users }: { users: EmailUser[] }) {
  const [subTab, setSubTab] = useState<SubTab>('compose')

  const SUB_TABS: { id: SubTab; label: string }[] = [
    { id: 'compose', label: 'Compose' },
    { id: 'templates', label: 'Templates' },
    { id: 'resend', label: 'Resend' },
  ]

  return (
    <div>
      <div className="flex gap-2 mb-5">
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            className={`px-3 py-1.5 rounded-full font-extrabold text-[12px] border-2 transition-colors ${subTab === t.id ? 'bg-bk-orange border-bk-orange text-white' : 'bg-white border-[#e2e8f0] text-[#64748b]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'compose' && <EmailComposeTab users={users} />}
      {subTab === 'templates' && <EmailTemplatesEditor />}
      {subTab === 'resend' && <EmailResendTool users={users} />}
    </div>
  )
}
