'use client'

import Link from 'next/link'
import { OPEN_TICKET_STATUSES } from '@/modules/tickets/constants'
import type { TicketStatus } from '@/modules/tickets/constants'
import { Button } from '@/components/ui/button'
import { useLocale, usePhrase } from '@/components/i18n/locale-provider'
import { OperationalRow, Dot } from '@/components/ui/operational-row'
import { PhoneSwipeRow } from '@/components/mobile'
import { StatusLabel } from '@/components/ui/signal'
import { cn } from '@/lib/utils'
import { plainOpenForHe, plainStatus } from '@/components/ops/plain-labels'
import { ticketDecision } from '@/modules/decisions/queue'
import { ticketIsUrgent } from '@/modules/tickets/urgent'
import type { QueueTicket } from '@/modules/tickets/queue'
import { useVisitSelection } from './visit-selection-context'
import { TicketQueueNoteButton } from './ticket-queue-note-button'
import { TicketDeleteButton } from './ticket-delete-button'

function displayNum(t: QueueTicket): string {
  if (t.display_number?.trim()) return t.display_number
  if (t.number != null) return `OC-${t.number}`
  return t.id.slice(0, 8)
}

export function TicketQueueItem({
  ticket,
  assigneeLabel,
  selectable = false,
}: {
  ticket: QueueTicket
  view: 'open' | 'resolved'
  assigneeLabel: string
  selectable?: boolean
  canOverrideResolve?: boolean
}) {
  const { locale } = useLocale()
  const p = usePhrase()
  const visitSelection = useVisitSelection()
  const open = OPEN_TICKET_STATUSES.includes(ticket.status as TicketStatus)
  const openFor = plainOpenForHe(ticket.created_at, ticket, new Date(), locale)
  const selected = visitSelection?.selected.has(ticket.id) ?? false
  const decision = ticketDecision(ticket, new Date(), locale)
  const actionLabel = decision?.action || p('לטפל')
  const needsApproval =
    ticketIsUrgent(ticket) && ticket.status !== 'engaged'
  const title = ticket.title || ticket.description
  const href = `/ops/tickets/${ticket.id}`

  if (!open) {
    return (
      <OperationalRow
        href={href}
        priority={ticket.priority}
        leading={
          <span className="inline-flex items-center gap-2">
            <span className="t-num text-ink">{displayNum(ticket)}</span>
            <span aria-hidden className="text-ink-3">
              ·
            </span>
            <span>{ticket.stores?.name?.trim() || p('חנות')}</span>
          </span>
        }
        title={title}
        footer={
          <>
            <StatusLabel status={ticket.status} />
            <Dot />
            <span className="t-meta truncate text-ink-2">{assigneeLabel}</span>
          </>
        }
      />
    )
  }

  const row = (
    <article
      className={cn(
        'border-b border-border bg-surface last:border-b-0',
        'transition-colors duration-[var(--dur-1)] hover:bg-surface-sunken/40',
        openFor.overdue && 'edge edge-overdue',
        selected && 'bg-[var(--tenant-soft)]/40',
      )}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        {selectable && visitSelection ? (
          <label className="flex shrink-0 items-center self-center pt-1">
            <input
              type="checkbox"
              className="h-6 w-6 accent-[var(--tenant)]"
              checked={selected}
              onChange={() => visitSelection.toggle(ticket.id)}
              aria-label={`בחירה לביקור ${displayNum(ticket)}`}
            />
          </label>
        ) : null}

        <Link href={href} className="min-w-0 flex-1 space-y-1">
          <p className="t-body line-clamp-2 text-ink">{title}</p>
          <p className="t-meta text-ink-3">
            <span
              className={cn(
                openFor.overdue && 'font-semibold text-[var(--tenant)]',
              )}
            >
              {openFor.text}
            </span>
            <span aria-hidden className="text-ink-3">
              {' '}
              ·{' '}
            </span>
            <span
              className={cn(
                needsApproval ? 'font-semibold text-[var(--tenant)]' : 'text-ink-2',
              )}
            >
              {needsApproval
                ? p('דורשת אישור')
                : plainStatus(ticket.status, locale)}
            </span>
          </p>
        </Link>

        <div className="flex shrink-0 flex-col items-stretch gap-2 self-center">
          <TicketQueueNoteButton ticketId={ticket.id} ticketTitle={title} />
          {needsApproval ? (
            <Button asChild variant="primary" size="sm">
              <Link href={href}>{actionLabel}</Link>
            </Button>
          ) : (
            <Button asChild variant="secondary" size="sm">
              <Link href={href}>{p('לטפל')}</Link>
            </Button>
          )}
          <TicketDeleteButton
            ticketId={ticket.id}
            label={displayNum(ticket)}
            variant="ghost"
            redirectTo={null}
            iconOnly
            className="text-[var(--signal-critical)]"
          />
        </div>
      </div>
    </article>
  )

  return (
    <PhoneSwipeRow
      actions={
        <div className="flex h-full w-full">
          <Link
            href={href}
            className="flex flex-1 items-center justify-center bg-[var(--tenant)] px-2 text-center text-sm font-medium text-white"
          >
            {needsApproval ? actionLabel : p('לטפל')}
          </Link>
          <Link
            href={`${href}#ticket-actions`}
            className="flex flex-1 items-center justify-center bg-ink px-2 text-center text-sm font-medium text-canvas"
          >
            {p('שיבוץ')}
          </Link>
        </div>
      }
    >
      {row}
    </PhoneSwipeRow>
  )
}
