import type { ReactNode } from 'react'
import { Tx } from '@/components/i18n/tx'
import {
  normalizeTicketCategory,
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS_HE,
} from '@/modules/tickets/constants'
import type { QueueTicket } from '@/modules/tickets/queue'
import { ticketIsUrgent } from '@/modules/tickets/urgent'
import type { RecommendationCardModel } from '@/modules/recommendations/present'
import { StoreGroupFolder } from './store-group-folder'

const CATEGORY_ORDER = new Map(
  TICKET_CATEGORIES.map((key, index) => [key, index]),
)

function categoryRank(tickets: QueueTicket[]): number {
  const urgent = tickets.some(
    (ticket) => ticketIsUrgent(ticket) && ticket.status !== 'engaged',
  )
  if (urgent) return -1
  const key = normalizeTicketCategory(tickets[0]?.category || 'other')
  return CATEGORY_ORDER.get(key) ?? 99
}

export function TicketStoreGroups({
  rows,
  renderRow,
}: {
  rows: QueueTicket[]
  cards?: RecommendationCardModel[]
  renderRow: (ticket: QueueTicket) => ReactNode
}) {
  const groups = new Map<string, QueueTicket[]>()
  for (const ticket of rows) {
    const key = ticket.store_id || ticket.stores?.code || 'none'
    const list = groups.get(key) ?? []
    list.push(ticket)
    groups.set(key, list)
  }

  const entries = [...groups.entries()]

  return (
    <div className="store-stack p-2.5">
      {entries.map(([key, tickets], index) => {
        const sample = tickets[0]
        const name = sample?.stores?.name || sample?.stores?.code || 'בלי סניף'
        const code = sample?.stores?.code
        const countLabel = tickets.length === 1 ? 'פתוחה' : 'פתוחות'

        const byCategory = new Map<string, QueueTicket[]>()
        for (const ticket of tickets) {
          const category = normalizeTicketCategory(ticket.category || 'other')
          const list = byCategory.get(category) ?? []
          list.push(ticket)
          byCategory.set(category, list)
        }

        const categories = [...byCategory.entries()].sort((a, b) => {
          const rank = categoryRank(a[1]) - categoryRank(b[1])
          if (rank !== 0) return rank
          return a[0].localeCompare(b[0])
        })

        return (
          <StoreGroupFolder
            key={key}
            title={name}
            code={code}
            count={tickets.length}
            countLabel={countLabel}
            defaultOpen={index === 0}
          >
            {categories.map(([categoryKey, categoryTickets]) => {
              const heLabel =
                TICKET_CATEGORY_LABELS_HE[categoryKey] ?? categoryKey
              return (
                <section
                  key={categoryKey}
                  className="border-t border-border/80 first:border-t-0"
                >
                  <div className="flex items-center gap-3 px-4 py-2">
                    <h4 className="t-caption text-ink-3">
                      <Tx text={heLabel} />
                    </h4>
                    {categoryTickets.length > 1 ? (
                      <span className="t-caption t-num text-ink-3">
                        {categoryTickets.length}
                      </span>
                    ) : null}
                  </div>
                  {categoryTickets.map((ticket) => (
                    <div key={ticket.id}>{renderRow(ticket)}</div>
                  ))}
                </section>
              )
            })}
          </StoreGroupFolder>
        )
      })}
    </div>
  )
}
