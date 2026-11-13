'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/toast'
import {
  VisitConfirmSheet,
  buildVisitIdempotencyKey,
  scheduledAtToIso,
  useSubmitGuard,
  type VisitBookPerson,
  type VisitResult,
} from '@/app/ops/tickets/visit-confirm-sheet'
import { lockPlannedVisitAction } from '@/app/ops/tickets/engagement-actions'
import { usePhrase } from '@/components/i18n/locale-provider'

type TicketOpt = {
  id: string
  label: string
  title: string
  spendBlock?: string | null
  category?: string | null
  status?: string | null
}
type VendorOpt = {
  id: string
  name: string
  specialties?: string
  coverage?: string[] | null
  phone?: string | null
}

export function StoreVisitDispatch({
  storeId,
  storeCode,
  city,
  region,
  tickets,
  vendors,
  professionals = [],
  companionIdsByTicket = {},
  initialSelectedIds = [],
}: {
  storeId: string
  storeCode: string
  city?: string | null
  region?: string | null
  tickets: TicketOpt[]
  vendors: VendorOpt[]
  professionals?: VisitBookPerson[]
  companionIdsByTicket?: Record<string, string[]>
  /** Pre-select these ticket ids (e.g. the ticket detail being viewed). */
  initialSelectedIds?: string[]
}) {
  const router = useRouter()
  const p = usePhrase()
  const toast = useToast()
  const [, startTransition] = useTransition()
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        initialSelectedIds.filter((id) =>
          tickets.some((ticket) => ticket.id === id && ticket.status !== 'engaged'),
        ),
      ),
  )
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [result, setResult] = useState<VisitResult | null>(null)
  const [includedSuggestionIds, setIncludedSuggestionIds] = useState<string[]>([])
  const [plannedTicketIds, setPlannedTicketIds] = useState<string[]>([])
  const { busy, run } = useSubmitGuard()

  const selectedList = useMemo(
    () => tickets.filter((t) => selected.has(t.id)),
    [tickets, selected],
  )
  const suggestions = useMemo(() => {
    const ids = new Set<string>()
    for (const ticket of selectedList) {
      for (const id of companionIdsByTicket[ticket.id] ?? []) {
        if (!selected.has(id) && tickets.some((row) => row.id === id)) ids.add(id)
      }
    }
    return tickets.filter((ticket) => ids.has(ticket.id))
  }, [selectedList, selected, tickets, companionIdsByTicket])

  function planTicketIds() {
    const selectedIds = selectedList.map((ticket) => ticket.id)
    const extra = includedSuggestionIds.filter(
      (id) => suggestions.some((row) => row.id === id) && !selectedIds.includes(id),
    )
    return [...selectedIds, ...extra]
  }

  function toggle(id: string) {
    const row = tickets.find((ticket) => ticket.id === id)
    if (row?.status === 'engaged') return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openSheet() {
    if (selectedList.length === 0) return
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
    const ids =
      opts?.retryFailedOnly && plannedTicketIds.length > 0
        ? plannedTicketIds
        : planTicketIds()
    if (ids.length === 0) throw new Error(p('אין תקלות לביקור'))
    setPlannedTicketIds(ids)
    const key = buildVisitIdempotencyKey({
      storeId,
      ticketIds: ids,
    })

    const res = await fetch('/api/ops/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        storeId,
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
        typeof data.error === 'string' ? data.error : p('תכנון הביקור נכשל'),
      )
    }
    const visit = data.visit as VisitResult | undefined
    if (!visit?.items) throw new Error(p('תשובה לא תקינה מהשרת'))
    return visit
  }

  async function planAndHandoff(input: {
    name: string
    phone: string
    amount: number
    scope: string
  }) {
    let line = p('השליחה לחנות נכשלה')
    let ok = false
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
        line = locked.line
        if (!locked.engagementLocked) {
          toast.push({ title: locked.line, tone: 'critical' })
          return
        }
        ok = true
        toast.push({
          title: locked.line,
          tone: locked.handoffOk ? 'success' : 'critical',
        })
        setSelected(new Set())
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
            title: p('שיגור חלקי · {n} נכשלו', { n: failed }),
            tone: 'critical',
          })
        }
        startTransition(() => router.refresh())
      } catch (error) {
        toast.push({
          title: error instanceof Error ? error.message : p('ניסיון חוזר נכשל'),
          tone: 'critical',
        })
      }
    })
  }

  return (
    <Panel elevated>
      <p className="t-section mb-1 text-ink">{p('תכנון ביקור')}</p>
      <p className="t-caption mb-3 text-ink-3">
        {p('סמנו תקלות בחנות זו. הזינו איש מקצוע; המחיר אופציונלי.')}
      </p>
      <ul className="mb-3 space-y-2">
        {tickets.map((t) => {
          const engaged = t.status === 'engaged'
          return (
          <li key={t.id}>
            <label
              className={`flex items-start gap-2 rounded-[var(--radius-sm)] px-1 py-1.5 hover:bg-surface-sunken/50 ${
                engaged ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
              }`}
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-[var(--tenant)]"
                checked={selected.has(t.id)}
                disabled={engaged}
                onChange={() => toggle(t.id)}
              />
              <span className="min-w-0">
                <span className="t-caption t-num font-semibold text-ink">
                  {t.label}
                </span>
                <span className="t-body block line-clamp-1 text-ink-2">
                  {t.title}
                </span>
                {engaged ? (
                  <span className="t-caption block font-semibold text-[var(--tenant)]">
                    {p('נשלח איש מקצוע לתיקון')}
                  </span>
                ) : null}
                {t.spendBlock ? (
                  <span className="t-caption block text-[var(--signal-critical)]">
                    {t.spendBlock}
                  </span>
                ) : null}
              </span>
            </label>
          </li>
          )
        })}
      </ul>
      {vendors.length === 0 ? (
        <p className="t-body mb-2 text-[var(--signal-warning)]" role="status">
          {p(
            'אין ספקים פעילים לשיגור אוטומטי — אפשר להזין איש מקצוע ידנית',
          )}
        </p>
      ) : null}
      <Button
        type="button"
        variant="primary"
        size="touch"
        className="w-full"
        disabled={selectedList.length === 0}
        onClick={openSheet}
      >
        <Truck className="h-4 w-4" aria-hidden />
        {p('תכנן ביקור')} ({selectedList.length})
      </Button>

      <VisitConfirmSheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setResult(null)
        }}
        title={`${p('ביקור')} · ${p('חנות')} #${storeCode}`}
        storeLabel={`${p('חנות')} #${storeCode}`}
        tickets={selectedList}
        vendors={vendors}
        city={city}
        region={region}
        category={selectedList[0]?.category}
        notes={notes}
        onNotesChange={setNotes}
        scheduledAt={scheduledAt}
        onScheduledAtChange={setScheduledAt}
        suggestions={suggestions}
        includedSuggestionIds={includedSuggestionIds}
        onIncludedSuggestionIdsChange={setIncludedSuggestionIds}
        professionals={professionals}
        busy={busy}
        canSubmit={selectedList.length > 0}
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
    </Panel>
  )
}
