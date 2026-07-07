'use client'

import { useState } from 'react'

type Props = {
  name: string
  defaultValue?: boolean
  label: string
  hint: string
}

export default function ShareToggle({ name, defaultValue = true, label, hint }: Props) {
  const [on, setOn] = useState(defaultValue)

  return (
    <div>
      <input type="hidden" name={name} value={on ? 'true' : 'false'} />
      <button
        type="button"
        onClick={() => setOn(prev => !prev)}
        className="flex items-center gap-2 font-extrabold text-[13px] rounded-[12px] py-2.5 px-4 border-2 transition-all w-full"
        style={{
          background:  on ? '#f97316' : '#fffbf0',
          borderColor: on ? '#f97316' : '#fed7aa',
          color:       on ? '#fff'    : '#aaa',
          boxShadow:   on ? '0 3px 0 #c2410c' : '0 3px 0 #fde5c4',
          fontFamily:  'inherit',
          cursor:      'pointer',
          textAlign:   'left',
        }}
      >
        <span style={{ fontSize: 16 }}>{on ? '🔓' : '🔒'}</span>
        <span>{label}: <strong>{on ? 'ON' : 'OFF'}</strong></span>
      </button>
      <p style={{ fontSize: 11, color: '#bbb', fontWeight: 600, marginTop: 5 }}>{hint}</p>
    </div>
  )
}
