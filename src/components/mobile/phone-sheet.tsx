'use client'

import { BottomSheet, type SheetDetent } from '@/components/ui/overlay'

/**
 * PhoneKit contract over BottomSheet — same API, documents that open sheets
 * must sit above PhoneActionDock (CSS hides dock while [role=dialog] is open).
 */
export function PhoneSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  detent = 'full',
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description?: string
  children: React.ReactNode
  detent?: SheetDetent
}) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      detent={detent}
    >
      {children}
    </BottomSheet>
  )
}
