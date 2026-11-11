'use client'

import { cn } from '@/lib/utils'

/**
 * Fixed primary-action bar above the phone tab bar (or at the bottom when
 * there is no tab bar — technician / store). Extracted from TechShell.
 */
export function PhoneActionDock({
  children,
  className,
  label,
  aboveTabBar = false,
}: {
  children: React.ReactNode
  className?: string
  /** Accessible name for the dock region */
  label?: string
  /** When true, sits above PhoneTabBar (HQ). When false, flush to safe bottom (tech). */
  aboveTabBar?: boolean
}) {
  return (
    <div
      role="region"
      aria-label={label}
      className={cn(
        'phone-action-dock fixed inset-x-0 z-40 border-t border-border bg-background',
        aboveTabBar ? 'phone-action-dock--above-tab' : 'phone-action-dock--flush',
        className,
      )}
    >
      <div className="safe-x mx-auto w-full max-w-xl px-4 py-3">{children}</div>
    </div>
  )
}
