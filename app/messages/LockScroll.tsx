'use client'
import { useEffect } from 'react'

export default function LockScroll() {
  useEffect(() => {
    const prev = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => { document.documentElement.style.overflow = prev }
  }, [])
  return null
}
