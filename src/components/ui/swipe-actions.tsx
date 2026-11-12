'use client'

import { useCallback, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

const OPEN_PX = 148
const THRESHOLD = 56
const DRAG_LOCK_PX = 8

const INTERACTIVE_SELECTOR =
  'a, button, input, label, select, textarea, [role="button"], [contenteditable="true"]'

/**
 * Mail-style swipe-to-reveal. Mobile/touch only — desktop children render unchanged.
 * Actions sit under the row; no scale/bounce on the row itself.
 */
export function SwipeActions({
  actions,
  children,
  className,
  disabled,
}: {
  actions: React.ReactNode
  children: React.ReactNode
  className?: string
  disabled?: boolean
}) {
  const [offset, setOffset] = useState(0)
  const startX = useRef<number | null>(null)
  const startY = useRef<number | null>(null)
  const startOffset = useRef(0)
  const dragging = useRef(false)
  const locked = useRef(false)
  const captureEl = useRef<HTMLElement | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return
      // Desktop mouse must not capture — checkboxes / links need a normal click.
      if (e.pointerType === 'mouse') return
      const target = e.target as Element | null
      if (target?.closest(INTERACTIVE_SELECTOR)) return
      startX.current = e.clientX
      startY.current = e.clientY
      startOffset.current = offset
      dragging.current = true
      locked.current = false
      captureEl.current = e.currentTarget as HTMLElement
    },
    [disabled, offset],
  )

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || startX.current == null || startY.current == null) return
    const dx = startX.current - e.clientX
    const dy = e.clientY - startY.current
    if (!locked.current) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > DRAG_LOCK_PX) {
        // Vertical scroll — abandon swipe so the page can move.
        dragging.current = false
        startX.current = null
        startY.current = null
        return
      }
      if (Math.abs(dx) < DRAG_LOCK_PX) return
      locked.current = true
      captureEl.current?.setPointerCapture(e.pointerId)
    }
    // RTL: swipe content toward inline-end (leftward on screen) reveals actions.
    const next = Math.max(0, Math.min(OPEN_PX, startOffset.current + dx))
    setOffset(next)
  }, [])

  const onPointerUp = useCallback(() => {
    if (!dragging.current && !locked.current) return
    dragging.current = false
    locked.current = false
    startX.current = null
    startY.current = null
    captureEl.current = null
    setOffset((o) => (o >= THRESHOLD ? OPEN_PX : 0))
  }, [])

  return (
    <div
      dir="ltr"
      className={cn('relative overflow-hidden md:contents', className)}
    >
      <div
        className="absolute inset-y-0 right-0 z-0 flex w-[148px] md:hidden"
        aria-hidden={offset < THRESHOLD}
      >
        {actions}
      </div>
      <div
        dir="rtl"
        className="relative z-[1] bg-surface touch-pan-y md:!transform-none"
        style={{
          transform: offset ? `translateX(${-offset}px)` : undefined,
          transition: locked.current
            ? 'none'
            : 'transform var(--dur-2) var(--ease)',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {children}
      </div>
    </div>
  )
}
