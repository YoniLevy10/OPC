'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { lockPlannedVisitAction } from './engagement-actions'
import {
  VisitConfirmSheet,
  buildVisitIdempotencyKey,
  scheduledAtToIso,
  useSubmitGuard,
  type VisitResult,
} from './visit-confirm-sheet'
import {
  VisitSelectionProvider,
  useVisitSelection,
  type VisitSelectableTicket,
} from './visit-selection-context'

type VendorOption = {
  id: string
  name: string
  specialties?: string
  coverage?: string[] | null
  phone?: string | null
}
type PersonOption = {
  id: string
  full_name: string
  phone: string | null
  trade: string | null
}

function VisitBarInner({
  vendors,
  professionals,
  storeFilter,
  companionIdsByTicket = {},
}: {
  vendors: VendorOption[]
  professionals: PersonOption[]
  storeFilter?: string
  companionIdsByTicket?: Record<string, string[]>
}) {
  const router = useRouter()
  const toast = useToast()
  const selection = useVisitSelection()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [result, setResult] = useState<VisitResult | null>(null)
  const [includedSuggestionIds, setIncludedSuggestionIds] = useState<string[]>([])
  const [plannedTicketIds, setPlannedTicketIds] = useState<string[]>([])
  const { busy, run } = useSubmitGuard()

  const selectedTickets = useMemo(() => {
    if (!selection) return [] as VisitSelectableTicket[]
    return [...selection.selected]
      .map((id) => selection.ticketsById.get(id))
      .filter((t): t is VisitSelectableTicket => Boolean(t))
  }, [selection])

  const storeIds = useMemo(
    () => [...new Set(selectedTickets.map((t) => t.storeId).filter(Boolean))],
    [selectedTickets],
  )
  const storeCodes = useMemo(
    () => [...new Set(selectedTickets.map((t) => t.storeCode).filter(Boolean))],
    [selectedTickets],
  )

  const sameStore = storeCodes.length === 1 && storeIds.length <= 1
  const hasStoreId = storeIds.length === 1
  const canChoosePerson = selectedTickets.length > 0 && sameStore
  const canOpen = canChoosePerson && hasStoreId
  const blockReason =
    selectedTickets.length === 0
      ? null
      : storeCodes.length > 1 || storeIds.length > 1
        ? 'בחרו תקלות מחנות אחת בלבד'
        : !hasStoreId
          ? 'לתקלות האלה חסר מזהה חנות — לא ניתן לתכנן ביקור'
          : null

  const suggestions = useMemo(() => {
    if (!selection || storeIds.length !== 1) return []
    const storeId = storeIds[0]
    const selected = new Set(selectedTickets.map((ticket) => ticket.id))
    const ids = new Set<string>()
    for (const ticket of selectedTickets) {
      for (const id of companionIdsByTicket[ticket.id] ?? []) {
        const row = selection.ticketsById.get(id)
        if (!row || row.storeId !== storeId || selected.has(id)) continue
        ids.add(id)
      }
    }
    return [...ids].flatMap((id) => {
      const row = selection.ticketsById.get(id)
      return row ? [{ id: row.id, label: row.label, title: row.title }] : []
    })
  }, [selection, selectedTickets, storeIds, companionIdsByTicket])

  function planTicketIds() {
    const selected = selectedTickets.map((ticket) => ticket.id)
    const extra = includedSuggestionIds.filter(
      (id) => suggestions.some((row) => row.id === id) && !selected.includes(id),
    )
    return [...selected, ...extra]
  }

  if (!selection) return null
  if (selectedTickets.length === 0 && !open) {
    return (
      <p className="t-caption hidden text-ink-3 md:block">
        {storeFilter
          ? 'סמנו תקלות לשיגור ביקור משולב לחנות זו'
          : 'סננו לפי חנות ואז סמנו תקלות לשיגור ביקור משולב'}
      </p>
    )
  }

  function openSheet() {
    if (!canOpen || storeIds.length !== 1) return
    const included = suggestions.map((row) => row.id)
    setIncludedSuggestionIds(included)
    setResult(null)
    setPlannedTicketIds([])
    setOpen(true)
  }

  async function createPlannedVisit(opts?: {
    retryFailedOnly?: boolean
    retryTicketIds?: string[]
  }) {
    if (!canOpen || storeIds.length !== 1) {
      throw new Error('יש לבחור תקלות מחנות אחת')
    }
    const ids =
      opts?.retryFailedOnly && plannedTicketIds.length > 0
        ? plannedTicketIds
        : planTicketIds()
    if (ids.length === 0) throw new Error('אין תקלות לביקור')
    setPlannedTicketIds(ids)
    const key = buildVisitIdempotencyKey({
      storeId: storeIds[0]!,
      ticketIds: ids,
    })

    const res = await fetch('/api/ops/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        storeId: storeIds[0],
        ticketIds: ids,
        notes: notes.trim() || undefined,
        scheduledAt: scheduledAtToIso(scheduledAt),
        idempotencyKey: key,
        retryFailedOnly: opts?.retryFailedOnly ?? false,
        retryTicketIds: opts?.retryTicketIds,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok && res.status !== 207) {
      throw new Error(
        typeof data.error === 'string' ? data.error : 'תכנון הביקור נכשל',
      )
    }
    const visit = data.visit as VisitResult | undefined
    if (!visit?.items) throw new Error('תשובה לא תקינה מהשרת')
    return visit
  }

  /** Plan the visit, then lock engagement and hand off to the store manager. */
  async function planAndHandoff(input: {
    name: string
    phone: string
    amount: number
    scope: string
  }) {
    let line = 'השליחה לחנות נכשלה'
    let ok = false
    if (!canOpen || storeIds.length !== 1) {
      toast.push({ title: 'יש לבחור תקלות מחנות אחת', tone: 'critical' })
      return { ok: false, line: 'יש לבחור תקלות מחנות אחת' }
    }
    await run(async () => {
      try {
        const ticketIds = planTicketIds()
        setPlannedTicketIds(ticketIds)
        await createPlannedVisit()
        const locked = await lockPlannedVisitAction({
          ticketIds,
          professionalName: input.name,
          professionalPhone: input.phone,
          approvedAmount: input.amount,
          scope: input.scope,
        })
        // Engagement is locked even when WhatsApp handoff is unverified (memory / no channel).
        ok = true
        line = locked.line
        toast.push({
          title: locked.line,
          tone: locked.ok ? 'success' : 'critical',
        })
        selection?.clear()
        setOpen(false)
        setResult(null)
        startTransition(() => router.refresh())
      } catch (error) {
        line = error instanceof Error ? error.message : line
        toast.push({ title: line, tone: 'critical' })
      }
    })
    return { ok, line }
  }

  async function retryVisit(opts: {
    retryFailedOnly?: boolean
    retryTicketIds?: string[]
  }) {
    await run(async () => {
      try {
        const visit = await createPlannedVisit(opts)
        setResult(visit)
        const failed = visit.items.filter((i) => i.can_retry).length
        if (failed > 0) {
          toast.push({
            title: `שיגור חלקי · ${failed} נכשלו`,
            tone: 'critical',
          })
        }
        startTransition(() => router.refresh())
      } catch (error) {
        toast.push({
          title: error instanceof Error ? error.message : 'ניסיון חוזר נכשל',
          tone: 'critical',
        })
      }
    })
  }

  return (
    <>
      {/* Keeps the last store rows clear of the fixed dock. */}
      <div
        className="pointer-events-none h-[4.5rem] shrink-0 max-md:h-[5.5rem]"
        aria-hidden
      />
      <div
        className="fixed inset-x-3 z-30 max-md:bottom-[calc(var(--bottomnav-h)+var(--bottomnav-gap)+var(--safe-b)+12px)] md:inset-x-auto md:bottom-4 md:start-[calc(var(--nav-w)+1rem)] md:end-4"
        role="status"
      >
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--tenant-line)] bg-[var(--tenant-soft)] px-3 py-2.5 shadow-[var(--shadow-1)]">
          <div className="min-w-0 flex-1">
            <p className="t-body text-ink">
              ביקור משולב · נבחרו{' '}
              <span className="t-num font-semibold">{selectedTickets.length}</span>
              {storeCodes[0] ? ` · חנות #${storeCodes[0]}` : ''}
            </p>
            {blockReason ? (
              <p className="t-caption mt-0.5 text-[var(--signal-critical)]">
                {blockReason}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => selection.clear()}
          >
            נקה
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!canOpen}
            title={blockReason ?? undefined}
            onClick={() => {
              if (!canOpen) return
              openSheet()
            }}
          >
            <Truck className="h-3.5 w-3.5" aria-hidden />
            תכנן ביקור
          </Button>
        </div>
      </div>

      <VisitConfirmSheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setResult(null)
        }}
        title="תכנון ביקור"
        storeLabel={storeCodes[0] ? `חנות #${storeCodes[0]}` : 'חנות'}
        tickets={selectedTickets.map((t) => ({
          id: t.id,
          label: t.label,
          title: t.title,
          spendBlock: t.spendBlock,
        }))}
        vendors={vendors}
        city={selectedTickets[0]?.city}
        region={selectedTickets[0]?.region}
        category={selectedTickets[0]?.category}
        notes={notes}
        onNotesChange={setNotes}
        scheduledAt={scheduledAt}
        onScheduledAtChange={setScheduledAt}
        suggestions={suggestions}
        includedSuggestionIds={includedSuggestionIds}
        onIncludedSuggestionIdsChange={setIncludedSuggestionIds}
        professionals={professionals}
        busy={busy}
        canSubmit={canOpen}
        result={result}
        onRetryFailed={() => void retryVisit({ retryFailedOnly: true })}
        onRetryTicket={(ticketId) =>
          void retryVisit({
            retryFailedOnly: true,
            retryTicketIds: [ticketId],
          })
        }
        onLock={planAndHandoff}
      />
    </>
  )
}

export function VisitMultiSelectBar({
  tickets,
  vendors,
  professionals = [],
  storeFilter,
  companionIdsByTicket = {},
}: {
  tickets: VisitSelectableTicket[]
  vendors: VendorOption[]
  professionals?: PersonOption[]
  storeFilter?: string
  companionIdsByTicket?: Record<string, string[]>
}) {
  return (
    <VisitSelectionProvider tickets={tickets}>
      <VisitBarInner
        vendors={vendors}
        professionals={professionals}
        storeFilter={storeFilter}
        companionIdsByTicket={companionIdsByTicket}
      />
    </VisitSelectionProvider>
  )
}

/** Shared shell so the bar and queue rows share one selection set. */
export function VisitQueueShell({
  tickets,
  vendors,
  professionals = [],
  storeFilter,
  companionIdsByTicket = {},
  children,
}: {
  tickets: VisitSelectableTicket[]
  vendors: VendorOption[]
  professionals?: PersonOption[]
  storeFilter?: string
  companionIdsByTicket?: Record<string, string[]>
  children: React.ReactNode
}) {
  return (
    <VisitSelectionProvider tickets={tickets}>
      <div className="flex flex-col gap-3">
        {children}
        <VisitBarInner
          vendors={vendors}
          professionals={professionals}
          storeFilter={storeFilter}
          companionIdsByTicket={companionIdsByTicket}
        />
      </div>
    </VisitSelectionProvider>
  )
}
