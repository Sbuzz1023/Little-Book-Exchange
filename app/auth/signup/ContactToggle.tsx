'use client'

import { useState } from 'react'

const OPTIONS = [
  { value: 'email', label: '✉️ Email' },
  { value: 'phone', label: '📱 Phone' },
] as const

type Option = typeof OPTIONS[number]['value']

export default function ContactToggle() {
  const [selected, setSelected] = useState<Set<Option>>(new Set<Option>(['email', 'phone']))

  function toggle(val: Option) {
    setSelected(prev => {
      // Don't allow deselecting the last one
      if (prev.has(val) && prev.size === 1) return prev
      const next = new Set(prev)
      next.has(val) ? next.delete(val) : next.add(val)
      return next
    })
  }

  return (
    <div className="flex gap-2">
      {/* Pass each selected value as a hidden input */}
      {Array.from(selected).map(v => (
        <input key={v} type="hidden" name="contact_preference" value={v} />
      ))}

      {OPTIONS.map(opt => {
        const active = selected.has(opt.value)
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            className="flex-1 font-extrabold text-[13px] rounded-[12px] py-3 border-2 transition-all"
            style={{
              background:  active ? 'var(--pine)' : 'var(--ground)',
              borderColor: active ? 'var(--pine)' : 'var(--line)',
              color:       active ? '#fff'        : 'var(--ink-faint)',
              boxShadow:   'none',
              fontFamily:  'inherit',
              cursor:      'pointer',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
