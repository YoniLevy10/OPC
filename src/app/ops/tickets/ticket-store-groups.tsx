import type { ReactNode } from 'react'
import Link from 'next/link'
import { Tx } from '@/components/i18n/tx'
import {
  normalizeTicketCategory,
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS_HE,
} from '@/modules/tickets/constants'
import type { QueueTicket } from '@/modules/tickets/queue'
import { ticketIsUrgent } from '@/modules/tickets/urgent'
import type { RecommendationCardModel } from '@/modules/recommendations/present'
import { RecommendationList } from '@/app/ops/dashboard/recommendation-list'
import { StoreGroupFolder } from './store-group-folder'
import type { Locale } from '@/lib/i18n/locale'
import { phrase } from '@/lib/i18n/phrases'

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

function StoreRecommendStrip({ cards }: { cards: RecommendationCardModel[] }) {
  if (cards.length === 0) return null

  const interactive = cards.some((card) => card.request || card.spendId)
  if (interactive) {
    return (
      <div className="border-b border-border bg-surface-sunken/40 px-3 py-3">
        <p className="t-caption mb-2 text-ink-3">
          <Tx text="כדאי לאחד לביקור אחד בסניף" />
        </p>
        <RecommendationList cards={cards} notice={null} />
      </div>
    )
  }

  return (
    <div className="border-b border-border bg-surface-sunken/40 px-4 py-3">
      <p className="t-caption mb-2 text-ink-3">
        <Tx text="כדאי לאחד לביקור אחד בסניף" />
      </p>
      <ul className="flex flex-col gap-2">
        {cards.map((card) => (
          <li
            key={card.id}
            className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2.5"
          >
            <p className="t-body text-ink">{card.sentence}</p>
            {card.costLine ? (
              <p className="t-meta mt-1 text-ink-2">{card.costLine}</p>
            ) : null}
            {card.personLine ? (
              <p className="t-meta mt-0.5 text-ink-2">{card.personLine}</p>
            ) : null}
            {card.href ? (
              <Link
                href={card.href}
                className="t-caption mt-2 inline-flex text-[var(--brand)] underline-offset-2 hover:underline"
              >
                {card.actionLabel}
              </Link>
            ) : (
              <p className="t-caption mt-2 text-ink-3">
                <Tx text="לאחד לביקור אחד באותו סניף" />
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function TicketStoreGroups({
  rows,
  cards = [],
  renderRow,
  locale,
}: {
  rows: QueueTicket[]
  cards?: RecommendationCardModel[]
  renderRow: (ticket: QueueTicket) => ReactNode
  locale: Locale
}) {
  const groups = new Map<string, QueueTicket[]>()
  for (const ticket of rows) {
    const key = ticket.store_id || ticket.stores?.code || 'none'
    const list = groups.get(key) ?? []
    list.push(ticket)
    groups.set(key, list)
  }

  const cardsByStore = new Map<string, RecommendationCardModel[]>()
  for (const card of cards) {
    const list = cardsByStore.get(card.storeId) ?? []
    list.push(card)
    cardsByStore.set(card.storeId, list)
  }

  const entries = [...groups.entries()]

  return (
    <div className="store-stack p-2.5">
      {entries.map(([key, tickets], index) => {
        const sample = tickets[0]
        const name = sample?.stores?.name || sample?.stores?.code || 'בלי סניף'
        const code = sample?.stores?.code
        const countLabel =
          tickets.length === 1
            ? phrase(locale, 'פתוחה')
            : phrase(locale, 'פתוחות')
        const storeId = sample?.store_id || key
        const storeCards = cardsByStore.get(storeId) ?? []

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
            <StoreRecommendStrip cards={storeCards} />
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
