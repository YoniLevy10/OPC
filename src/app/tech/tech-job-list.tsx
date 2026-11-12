'use client'

import { ClipboardList } from 'lucide-react'
import { PhoneList, PhoneRow, PhoneDot } from '@/components/mobile'
import { EmptyState, Panel } from '@/components/ui/primitives'
import { StatusLabel } from '@/components/ui/signal'
import { techHref } from '@/lib/tech-href'
import type { TechTicketRow } from '@/modules/tickets/tech'
import { OPEN_TICKET_STATUSES } from '@/modules/tickets/constants'
import { storeLabel } from '@/components/ops/plain-labels'

function jobPhase(status: string): string {
  if (status === 'in_progress') return 'בטיפול'
  if (OPEN_TICKET_STATUSES.includes(status as never)) return 'ממתינה'
  return 'הסתיימה'
}

function placeLine(
  stores: TechTicketRow['stores'],
): string | null {
  if (!stores) return null
  const parts = [stores.city, stores.address].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}

export function TechJobList({
  tickets,
  techId,
}: {
  tickets: TechTicketRow[]
  techId: string | null
}) {
  // One list, newest first — no tabs/filters/search.
  const sorted = [...tickets].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )

  if (sorted.length === 0) {
    return (
      <Panel flush elevated className="overflow-hidden">
        <EmptyState
          title="אין עבודות כרגע"
          description="כשמשייכים לך תקלה — היא תופיע כאן."
          icon={ClipboardList}
          className="py-12"
        />
      </Panel>
    )
  }

  return (
    <Panel flush elevated className="overflow-hidden">
      <PhoneList>
        {sorted.map((t) => {
          const num =
            t.display_number ||
            (t.number != null ? `OC-${t.number}` : null)
          const place = placeLine(t.stores)
          return (
            <PhoneRow
              key={t.id}
              href={techHref(`/tech/${t.id}`, techId)}
              priority={t.priority}
              leading={
                <span className="inline-flex items-center gap-1.5">
                  {num ? (
                    <span className="t-num text-ink" data-live="ticket-no">
                      {num}
                    </span>
                  ) : null}
                  {num ? (
                    <span className="text-ink-3" aria-hidden>
                      ·
                    </span>
                  ) : null}
                  <span>{storeLabel(t.stores)}</span>
                </span>
              }
              title={t.description || t.title || 'תקלה'}
              subtitle={place}
              footer={
                <>
                  <StatusLabel status={t.status} />
                  <PhoneDot />
                  <span className="t-meta text-ink-2">{jobPhase(t.status)}</span>
                </>
              }
            />
          )
        })}
      </PhoneList>
    </Panel>
  )
}
