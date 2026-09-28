'use client'
import { useRef, useState } from 'react'
import { resolveSnap } from '@/lib/sheetSnap'

// Movement (px) before a press on the header counts as a drag, not a tap.
const DRAG_THRESHOLD = 5

type Drag = { startY: number; startH: number; lastY: number; lastT: number; velocity: number; moved: boolean }

// Google Maps–style bottom sheet. `snaps` are visible heights (px, ascending)
// and the parent owns which one is active, so it can open/collapse the sheet
// itself (e.g. on selecting a pin). Drag the header to resize; release snaps
// to the nearest point (or the next one over, on a flick). A tap on the
// header's empty space steps to the next snap point.
export default function TrailSheet({ snaps, snapIndex, onSnapIndexChange, header, children }: {
  snaps: number[]
  snapIndex: number
  onSnapIndexChange: (i: number) => void
  header: React.ReactNode
  children: React.ReactNode
}) {
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const drag = useRef<Drag | null>(null)
  const height = dragHeight ?? snaps[snapIndex]

  function onPointerDown(e: React.PointerEvent) {
    // Let buttons/links in the header (Back, the search chip's ×) work normally.
    if ((e.target as HTMLElement).closest('button, a')) return
    // Keep receiving moves even once the pointer leaves the header (touch
    // does this implicitly; mouse doesn't).
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { startY: e.clientY, startH: height, lastY: e.clientY, lastT: e.timeStamp, velocity: 0, moved: false }
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    if (!d.moved) {
      if (Math.abs(e.clientY - d.startY) < DRAG_THRESHOLD) return
      d.moved = true
    }
    const dt = e.timeStamp - d.lastT
    if (dt > 0) d.velocity = (d.lastY - e.clientY) / dt
    d.lastY = e.clientY
    d.lastT = e.timeStamp
    const h = d.startH + (d.startY - e.clientY)
    setDragHeight(Math.min(Math.max(h, snaps[0]), snaps[snaps.length - 1]))
  }

  function onPointerUp() {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (!d.moved) {
      onSnapIndexChange((snapIndex + 1) % snaps.length)
      return
    }
    const target = resolveSnap(height, d.velocity, snaps)
    setDragHeight(null)
    onSnapIndexChange(snaps.indexOf(target))
  }

  return (
    <section
      aria-label="Locations"
      className={`trail-sheet${dragHeight !== null ? ' dragging' : ''}`}
      style={{ height }}
    >
      <div
        className="trail-sheet-header"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="trail-sheet-handle" />
        {header}
      </div>
      <div className="trail-sheet-body">{children}</div>
    </section>
  )
}
