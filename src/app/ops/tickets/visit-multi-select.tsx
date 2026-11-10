'use client'

import { useMemo, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { VisitPlanSheet } from './visit-plan-sheet'
import {
  VisitSelectionProvider,
  useVisitSelection,
  type VisitSelectableTicket,
} from './visit-selection-context'

function VisitBarInner({ storeFilter }: { storeFilter?: string }) {
  const selection = useVisitSelection()
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<VisitSelectableTicket[] | null>(null)
  const [session, setSession] = useState(0)
  const selectedTickets = useMemo(() => {
    // Approval results and retries keep the original work scope after refresh.
    if (snapshot) return snapshot
    if (!selection) return []
    return [...selection.selected]
      .map((id) => selection.ticketsById.get(id))
      .filter((ticket): ticket is VisitSelectableTicket => Boolean(ticket))
  }, [selection, snapshot])

  if (!selection) return null
  if (selectedTickets.length === 0) {
    return (
      <p className="t-caption hidden text-ink-3 md:block">
        {storeFilter ? 'סמנו תקלות לתכנון ביקור בחנות זו' : 'סמנו תקלות לתכנון ביקור לפי מקצוע ומיקום'}
      </p>
    )
  }

  function clear() {
    selection?.clear()
    setSnapshot(null)
    setSession((current) => current + 1)
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--tenant-line)] bg-[var(--tenant-soft)] px-3 py-2.5">
        <p className="t-body flex-1 text-ink">נבחרו <span className="t-num font-semibold">{selectedTickets.length}</span> תקלות</p>
        <Button type="button" variant="ghost" size="sm" onClick={clear}>נקה</Button>
        <Button type="button" variant="primary" size="sm" onClick={() => { setSnapshot(selectedTickets); setOpen(true) }}>
          <ClipboardList className="h-3.5 w-3.5" aria-hidden />
          תכנון ביקור
        </Button>
      </div>
      <VisitPlanSheet
        key={session}
        open={open}
        tickets={selectedTickets}
        onDismiss={({ complete, hasApprovals }) => {
          setOpen(false)
          if (complete) clear()
          else if (!hasApprovals) setSnapshot(null)
        }}
      />
    </>
  )
}

type QueueProps = {
  tickets: VisitSelectableTicket[]
  storeFilter?: string
}

export function VisitMultiSelectBar({ tickets, storeFilter }: QueueProps) {
  return (
    <VisitSelectionProvider tickets={tickets}>
      <VisitBarInner storeFilter={storeFilter} />
    </VisitSelectionProvider>
  )
}

/** Shared shell so the bar and queue rows share one selection set. */
export function VisitQueueShell({ tickets, storeFilter, children }: QueueProps & { children: React.ReactNode }) {
  return (
    <VisitSelectionProvider tickets={tickets}>
      <div className="flex flex-col gap-3">
        <VisitBarInner storeFilter={storeFilter} />
        {children}
      </div>
    </VisitSelectionProvider>
  )
}
