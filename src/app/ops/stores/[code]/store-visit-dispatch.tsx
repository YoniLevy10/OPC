'use client'

import { useMemo, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/primitives'
import { VisitPlanSheet } from '@/app/ops/tickets/visit-plan-sheet'
import type { VisitPlanTicket } from '@/modules/visits/plan'

type TicketOpt = {
  id: string
  label: string
  title: string
  category?: string | null
}

export function StoreVisitDispatch({
  storeId,
  storeCode,
  city,
  region,
  tickets,
}: {
  storeId: string
  storeCode: string
  city?: string | null
  region?: string | null
  tickets: TicketOpt[]
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<VisitPlanTicket[] | null>(null)
  const [session, setSession] = useState(0)
  const selectedTickets = useMemo(
    () => snapshot ?? tickets.filter((ticket) => selected.has(ticket.id))
      .map((ticket) => ({ ...ticket, storeId, storeCode, city, region })),
    [snapshot, tickets, selected, storeId, storeCode, city, region],
  )

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Panel elevated>
      <p className="t-section mb-1 text-ink">תכנון ביקור</p>
      <p className="t-caption mb-3 text-ink-3">סמנו תקלות. המערכת תרכז אותן לפי המקצוע והמיקום לפני בחירת איש מקצוע.</p>
      <ul className="mb-3 space-y-2">
        {tickets.map((ticket) => (
          <li key={ticket.id}>
            <label className="flex cursor-pointer items-start gap-2 rounded-[var(--radius-sm)] px-1 py-1.5 hover:bg-surface-sunken/50">
              <input type="checkbox" aria-label={`בחירה לביקור ${ticket.label}`} className="mt-1 h-5 w-5 accent-[var(--tenant)]" checked={selected.has(ticket.id)} onChange={() => toggle(ticket.id)} />
              <span className="min-w-0">
                <span className="t-caption t-num font-semibold text-ink">{ticket.label}</span>
                <span className="t-body block line-clamp-1 text-ink-2">{ticket.title}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <Button type="button" variant="primary" size="touch" className="w-full" disabled={selectedTickets.length === 0} onClick={() => { setSnapshot(selectedTickets); setOpen(true) }}>
        <ClipboardList className="h-4 w-4" aria-hidden />
        תכנון ביקור ({selectedTickets.length})
      </Button>
      <VisitPlanSheet
        key={session}
        open={open}
        tickets={selectedTickets}
        onDismiss={({ complete, hasApprovals }) => {
          setOpen(false)
          if (complete) {
            setSelected(new Set())
            setSnapshot(null)
            setSession((current) => current + 1)
          } else if (!hasApprovals) setSnapshot(null)
        }}
      />
    </Panel>
  )
}
