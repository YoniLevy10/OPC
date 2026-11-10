'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cancelEngagementAction, setUrgentAction } from '@/app/ops/tickets/engagement-actions'
import type { Engagement } from '@/modules/engagements/service'
import { isVisitPlannableStatus, type VisitPlanTicket } from '@/modules/visits/plan'
import { formatIls } from '@/modules/spend/true-cost'
import { Button } from '@/components/ui/button'
import { VisitHandoffList, VisitPlanSheet, type VisitHandoff } from '../visit-plan-sheet'

export function EngagementPanel({
  ticket,
  urgent,
  status,
  locked,
  companions,
  canApprove,
}: {
  ticket: VisitPlanTicket
  urgent: boolean
  status: string
  locked: Engagement | null
  companions: VisitPlanTicket[]
  canApprove: boolean
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [snapshot, setSnapshot] = useState<VisitPlanTicket[] | null>(null)
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState(0)
  const [retryResult, setRetryResult] = useState<{ id: string; handoffs: VisitHandoff[] } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const retryLock = useRef(false)
  const handoffs = locked && retryResult?.id === locked.id ? retryResult.handoffs : locked?.handoffs ?? []
  const planned = snapshot ?? [ticket, ...companions.filter((row) => selected.has(row.id))]

  if (status === 'closed' || status === 'cancelled') return null

  async function retryHandoff() {
    if (!locked || retryLock.current) return
    retryLock.current = true
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/ops/engagements', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry', ticketId: locked.ticketId }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.engagement?.id || !Array.isArray(data.handoffs)) {
        throw new Error(data?.error || 'העברת ההודעה לא הושלמה')
      }
      setRetryResult({ id: data.engagement.id, handoffs: data.handoffs })
      router.refresh()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'בדקו את החיבור ונסו שוב')
    } finally {
      retryLock.current = false
      setBusy(false)
    }
  }

  return (
    <>
      <section className="grid gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-4">
        {locked ? (
          <>
            <p className="t-body-strong text-ink">הטיפול אושר. מנהל החנות מתאם.</p>
            <p className="t-body text-ink-2">{locked.professionalName} · {locked.professionalPhone} · {formatIls(locked.approvedAmount)} לכל הביקור</p>
            <p className="t-meta text-ink-3">המחיר נעול. שינוי דורש ביטול וחזרה לתור.</p>
            {handoffs.length ? <VisitHandoffList handoffs={handoffs} /> : <p className="t-caption text-[var(--signal-warning)]">אין תיעוד העברה לחנות.</p>}
            {canApprove && !locked.closedAt && handoffs.some((handoff) => handoff.canRetry) ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void retryHandoff()}>{busy ? 'מעביר…' : 'נסה שוב להעביר לחנות'}</Button>
            ) : null}
            {error ? <p role="alert" className="t-caption text-[var(--signal-critical)]">{error}</p> : null}
            {canApprove && !locked.closedAt ? (
              <form action={cancelEngagementAction}>
                <input type="hidden" name="ticketId" value={ticket.id} />
                <Button type="submit" variant="ghost" size="sm" disabled={busy}>בטל אישור</Button>
              </form>
            ) : null}
          </>
        ) : canApprove && isVisitPlannableStatus(status) ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="t-body-strong text-ink">{urgent ? 'דחוף' : 'לא דחוף'}</p>
              <form action={setUrgentAction}>
                <input type="hidden" name="ticketId" value={ticket.id} />
                <input type="hidden" name="urgent" value={urgent ? '0' : '1'} />
                <Button type="submit" variant="ghost" size="sm">{urgent ? 'סמן כלא דחוף' : 'סמן כדחוף'}</Button>
              </form>
            </div>
            {companions.length ? (
              <details>
                <summary className="t-caption cursor-pointer py-2 text-ink-2">אפשר לצרף {companions.length} תקלות מאותו מקצוע ועיר</summary>
                <ul className="grid gap-2 pt-2">
                  {companions.map((row) => (
                    <li key={row.id}>
                      <label className="t-body flex items-start gap-2 text-ink">
                        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={selected.has(row.id)} onChange={() => setSelected((current) => {
                          const next = new Set(current)
                          if (next.has(row.id)) next.delete(row.id)
                          else next.add(row.id)
                          return next
                        })} />
                        <span>{row.label} · חנות #{row.storeCode} · {row.title}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <Button type="button" variant="primary" size="touch" onClick={() => { setSnapshot(planned); setOpen(true) }}>תכנון ביקור</Button>
          </>
        ) : <p className="t-body text-ink-2">{status === 'resolved'
          ? 'הטיפול ממתין לאישור מנהל החנות.'
          : canApprove
            ? 'התקלה כבר בתהליך טיפול. פרטי הטיפול וההעברה לחנות מופיעים בהיסטוריה.'
            : 'אישור המחיר והעברת הטיפול לחנות מתבצעים בידי ארי.'}</p>}
      </section>
      <VisitPlanSheet
        key={session}
        open={open}
        tickets={planned}
        onDismiss={({ complete, hasApprovals }) => {
          setOpen(false)
          if (complete) {
            setSelected(new Set())
            setSnapshot(null)
            setSession((current) => current + 1)
          } else if (!hasApprovals) setSnapshot(null)
        }}
      />
    </>
  )
}
