'use client'

import { ClipboardList } from 'lucide-react'
import { PhoneList, PhoneRow, PhoneDot } from '@/components/mobile'
import { EmptyState, Panel } from '@/components/ui/primitives'
import { StatusLabel } from '@/components/ui/signal'
import { techHref } from '@/lib/tech-href'
import type { TechTicketRow } from '@/modules/tickets/tech'
import { OPEN_TICKET_STATUSES } from '@/modules/tickets/constants'
import { storeLabel } from '@/components/ops/plain-labels'

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
    <Panel flush elevated className="-mx-4 overflow-hidden sm:mx-0">
      <PhoneList>
        {sorted.map((t) => {
          const waiting =
            OPEN_TICKET_STATUSES.includes(t.status as never) &&
            t.status !== 'in_progress'
          const num =
            t.display_number ||
            (t.number != null ? `OC-${t.number}` : null)
          return (
            <PhoneRow
              key={t.id}
              href={techHref(`/tech/${t.id}`, techId)}
              priority={t.priority}
              leading={
                <span className="inline-flex items-center gap-2">
                  {num ? (
                    <span className="t-num text-ink" data-live="ticket-no">
                      {num}
                      <span className="mx-1.5 text-ink-3" aria-hidden>
                        ·
                      </span>
                    </span>
                  ) : null}
                  <span>{storeLabel(t.stores)}</span>
                </span>
              }
              title={t.description || t.title || 'תקלה'}
              footer={
                <>
                  <StatusLabel status={t.status} />
                  <PhoneDot />
                  <span className="t-meta text-ink-2">
                    {waiting
                      ? 'ממתינה'
                      : t.status === 'in_progress'
                        ? 'בטיפול'
                        : 'הסתיימה'}
                  </span>
                </>
              }
            />
          )
        })}
      </PhoneList>
    </Panel>
  )
}
