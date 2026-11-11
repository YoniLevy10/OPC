import { OperationalRow, RowList, Dot } from '@/components/ui/operational-row'
import { SwipeActions } from '@/components/ui/swipe-actions'
import { cn } from '@/lib/utils'

/** Dense operational list surface for phone. */
export function PhoneList({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <RowList className={className}>{children}</RowList>
}

/** PhoneRow = OperationalRow (stable API for screen agents). */
export const PhoneRow = OperationalRow

export { Dot as PhoneDot }

/**
 * Optional swipe-to-reveal wrapper for queue rows.
 * Desktop renders children unchanged (SwipeActions uses md:contents).
 */
export function PhoneSwipeRow({
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
  return (
    <SwipeActions actions={actions} className={cn(className)} disabled={disabled}>
      {children}
    </SwipeActions>
  )
}
