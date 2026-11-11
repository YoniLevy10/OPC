import type { ReactNode } from 'react'
import type { QueueTicket } from '@/modules/tickets/queue'
import type { RecommendationCardModel } from '@/modules/recommendations/present'
import { StoreGroupFolder } from './store-group-folder'

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
        return (
          <StoreGroupFolder
            key={key}
            title={name}
            code={code}
            count={tickets.length}
            countLabel={countLabel}
            defaultOpen={index === 0}
          >
            {tickets.map((ticket) => (
              <div key={ticket.id}>{renderRow(ticket)}</div>
            ))}
          </StoreGroupFolder>
        )
      })}
    </div>
  )
}
