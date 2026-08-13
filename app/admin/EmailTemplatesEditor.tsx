'use client'
import { useState, useEffect } from 'react'
import { getEmailTemplates, updateEmailTemplate, type EmailTemplate, type EmailTemplateType } from '@/lib/actions/emailAdmin'

const LABELS: Record<EmailTemplateType, string> = {
  welcome_confirmation: 'Welcome / Confirm Email',
  password_reset: 'Password Reset',
}

export default function EmailTemplatesEditor() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [drafts, setDrafts] = useState<Record<string, { subject: string; body: string }>>({})
  const [savingType, setSavingType] = useState<EmailTemplateType | null>(null)
  const [savedType, setSavedType] = useState<EmailTemplateType | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getEmailTemplates().then(res => {
      if (res.ok && res.templates) {
        setTemplates(res.templates)
        const d: Record<string, { subject: string; body: string }> = {}
        for (const t of res.templates) d[t.type] = { subject: t.subject, body: t.body }
        setDrafts(d)
      } else {
        setError(res.error ?? 'Failed to load templates.')
      }
    })
  }, [])

  async function save(type: EmailTemplateType) {
    setSavingType(type)
    setSavedType(null)
    setError(null)
    const draft = drafts[type]
    const result = await updateEmailTemplate(type, draft.subject, draft.body)
    setSavingType(null)
    if (result.ok) setSavedType(type)
    else setError(result.error ?? 'Failed to save.')
  }

  return (
    <div className="space-y-6">
      <h2 className="font-display text-[22px] text-[#1e293b]">Email Templates</h2>
      <p className="text-[13px] font-semibold text-[#64748b]">
        Edit the wording sent automatically. Use <code className="bg-[#f1f5f9] px-1 rounded">{'{{username}}'}</code> and <code className="bg-[#f1f5f9] px-1 rounded">{'{{link}}'}</code> — they're filled in automatically for each user.
      </p>

      {error && (
        <div className="bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-red-700 font-bold text-sm">{error}</div>
      )}

      {templates.map(t => (
        <div key={t.type} className="bg-white rounded-2xl p-5 border border-[#f1f5f9] shadow-sm space-y-3">
          <h3 className="font-black text-[15px] text-[#1e293b]">{LABELS[t.type]}</h3>
          <div>
            <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Subject</label>
            <input
              value={drafts[t.type]?.subject ?? ''}
              onChange={e => setDrafts(d => ({ ...d, [t.type]: { ...d[t.type], subject: e.target.value } }))}
              className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange"
            />
          </div>
          <div>
            <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Body</label>
            <textarea
              value={drafts[t.type]?.body ?? ''}
              onChange={e => setDrafts(d => ({ ...d, [t.type]: { ...d[t.type], body: e.target.value } }))}
              rows={6}
              className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-semibold text-[13px] focus:outline-none focus:border-bk-orange resize-y"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => save(t.type)}
              disabled={savingType === t.type}
              className="bg-bk-orange text-white rounded-xl px-4 py-2 font-extrabold text-[13px] shadow-[0_3px_0_#c2410c] disabled:opacity-60"
            >
              {savingType === t.type ? 'Saving…' : 'Save'}
            </button>
            {savedType === t.type && <span className="text-[12px] font-bold text-[#059669]">✓ Saved</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
