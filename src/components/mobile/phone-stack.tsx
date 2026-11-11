'use client'

import { cn } from '@/lib/utils'

/**
 * Narrow list→detail stack for inbox / similar panes.
 * On phone: show either list or detail. On md+: optional side-by-side.
 */
export function PhoneStack({
  list,
  detail,
  showDetail,
  className,
}: {
  list: React.ReactNode
  detail: React.ReactNode
  /** When true on phone, detail pane is shown instead of list */
  showDetail: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'phone-stack flex min-h-0 min-w-0 flex-1 flex-col md:flex-row',
        className,
      )}
    >
      <div
        className={cn(
          'min-h-0 min-w-0 flex-1 overflow-y-auto md:max-w-sm md:border-e md:border-border',
          showDetail ? 'hidden md:block' : 'block',
        )}
      >
        {list}
      </div>
      <div
        className={cn(
          'min-h-0 min-w-0 flex-1 overflow-y-auto',
          showDetail ? 'block' : 'hidden md:block',
        )}
      >
        {detail}
      </div>
    </div>
  )
}
