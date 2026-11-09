'use client'

import type { TicketPriority, TicketStatus } from '@/modules/tickets/constants'
import { plainStatus, plainUrgency } from '@/components/ops/plain-labels'
import { useLocale } from '@/components/i18n/locale-provider'
import { cn } from '@/lib/utils'

function statusClass(awaiting: boolean): string {
  if (awaiting) return 'font-semibold text-[var(--tenant)]'
  return 'text-ink-2'
}

export function PriorityText({
  priority,
  className,
}: {
  priority: TicketPriority | string
  className?: string
}) {
  const { locale } = useLocale()
  const label = plainUrgency(priority, locale)
  const strong = priority === 'critical' || priority === 'high'
  return (
    <span
      className={cn(
        't-body-strong inline-flex items-center gap-1.5',
        strong ? 'text-[var(--signal-critical)]' : 'text-ink',
        className,
      )}
    >
      {priority === 'critical' || priority === 'high' ? (
        <span
          aria-hidden
          className={cn(
            'h-2.5 w-[3px] rounded-full',
            priority === 'critical'
              ? 'bg-[var(--signal-critical)]'
              : 'bg-[var(--signal-critical)]/45',
          )}
        />
      ) : null}
      {label}
    </span>
  )
}

export function StatusLabel({
  status,
  awaiting = false,
  className,
}: {
  status: TicketStatus | string
  /** Waiting on a decision: clay type, no pill. Closed and routine stay ink-2. */
  awaiting?: boolean
  className?: string
}) {
  const { locale } = useLocale()
  const label = plainStatus(status, locale)
  return (
    <span className={cn('t-caption', statusClass(awaiting), className)}>
      {label}
    </span>
  )
}
