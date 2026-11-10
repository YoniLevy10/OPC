'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { BottomSheet } from '@/components/ui/overlay'
import { buildVisitPlan, type VisitPlanGroup, type VisitPlanTicket } from '@/modules/visits/plan'
import { formatIls } from '@/modules/spend/true-cost'

export type VisitHandoff = {
  storeId: string
  storeCode: string
  storeName?: string
  status: 'sent' | 'dry_run' | 'failed' | 'missing_contact'
  error?: string | null
  canRetry: boolean
}

type ApprovalResult = {
  engagement: { id: string; professionalName?: string; approvedAmount?: number }
  handoffs: VisitHandoff[]
}

type Terms = { name: string; phone: string; amount: string }
const EMPTY_TERMS: Terms = { name: '', phone: '', amount: '' }

function validTerms(terms: Terms) {
  const digits = terms.phone.replace(/\D/g, '')
  const amount = Number(terms.amount)
  return terms.name.trim().length >= 2 &&
    /^[+\d\s()-]+$/.test(terms.phone) && digits.length >= 9 && digits.length <= 15 &&
    Number.isFinite(amount) && amount > 0
}

function finished(result: ApprovalResult | undefined) {
  return Boolean(result && result.handoffs.length > 0 &&
    result.handoffs.every((handoff) => !handoff.canRetry &&
      (handoff.status === 'sent' || handoff.status === 'dry_run')))
}

function handoffLabel(handoff: VisitHandoff) {
  const store = handoff.storeName || `חנות #${handoff.storeCode}`
  switch (handoff.status) {
    case 'sent': return `הועבר לשליחה · ${store}`
    case 'dry_run': return `מצב הדגמה — לא נשלחה הודעה בפועל · ${store}`
    case 'missing_contact': return `חסר מספר טלפון להעברה לחנות · ${store}`
    default: return `העברת ההודעה לחנות נכשלה · ${store}`
  }
}

export function VisitHandoffList({ handoffs }: { handoffs: VisitHandoff[] }) {
  return (
    <ul className="grid gap-2" aria-label="מצב העברה לחנות">
      {handoffs.map((handoff) => (
        <li key={handoff.storeId} className="t-caption text-ink-2">
          <p>{handoffLabel(handoff)}</p>
          {handoff.error ? <p className="text-[var(--signal-critical)]">{handoff.error}</p> : null}
        </li>
      ))}
    </ul>
  )
}

/** Shared fault-first flow for the ticket queue and store page. */
export function VisitPlanSheet({
  open,
  tickets,
  onDismiss,
}: {
  open: boolean
  tickets: VisitPlanTicket[]
  onDismiss: (state: { complete: boolean; hasApprovals: boolean }) => void
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const groups = useMemo(() => buildVisitPlan(tickets), [tickets])
  const [drafts, setDrafts] = useState<Record<string, Terms>>({})
  const [results, setResults] = useState<Record<string, ApprovalResult>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<string | null>(null)
  const locked = useRef(false)
  const complete = groups.length > 0 && groups.every((group) => finished(results[group.id]))
  const hasApprovals = groups.some((group) => Boolean(results[group.id]))

  function dismiss(next: boolean) {
    if (!next && !locked.current) onDismiss({ complete, hasApprovals })
  }

  function updateTerms(group: VisitPlanGroup, field: keyof Terms, value: string) {
    setDrafts((current) => ({
      ...current,
      [group.id]: { ...(current[group.id] ?? EMPTY_TERMS), [field]: value },
    }))
  }

  async function approve(group: VisitPlanGroup, retry = false) {
    const terms = drafts[group.id] ?? EMPTY_TERMS
    if (locked.current || (!retry && (results[group.id] || !group.ready || !validTerms(terms)))) return
    locked.current = true
    setPending(group.id)
    setErrors((current) => ({ ...current, [group.id]: '' }))
    try {
      const response = await fetch('/api/ops/engagements', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retry ? {
          action: 'retry',
          ticketId: group.tickets[0].id,
        } : {
          ticketId: group.tickets[0].id,
          bundledTicketIds: group.tickets.slice(1).map((ticket) => ticket.id),
          professionalName: terms.name.trim(),
          professionalPhone: terms.phone.trim(),
          approvedAmount: Number(terms.amount),
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || 'האישור לא הושלם. אפשר לנסות שוב.')
      if (!data?.engagement?.id || !Array.isArray(data.handoffs)) {
        throw new Error('לא התקבל מצב אישור תקין. בדקו את התקלה לפני ניסיון נוסף.')
      }
      setResults((current) => ({ ...current, [group.id]: data as ApprovalResult }))
      startTransition(() => router.refresh())
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [group.id]: error instanceof Error ? error.message : 'לא ניתן להתחבר. בדקו את החיבור ונסו שוב.',
      }))
    } finally {
      locked.current = false
      setPending(null)
    }
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={dismiss}
      title="תכנון ביקור"
      description={`${tickets.length} תקלות · ${groups.length} ביקורים לפי מקצוע ומיקום`}
    >
      <div className="grid gap-4">
        <p className="t-body text-ink-2">
          {groups.length > 1
            ? 'הבחירה דורשת ביקורים נפרדים. כל ביקור כולל את התקלות שמפורטות בו ומאושר בנפרד.'
            : 'בדקו את התקלות והמקצוע, חפשו במידרג וסכמו זמינות ומחיר בשיחה.'}
        </p>
        {groups.map((group) => {
          const terms = drafts[group.id] ?? EMPTY_TERMS
          const result = results[group.id]
          const retryable = result?.handoffs.some((handoff) => handoff.canRetry)
          return (
            <section key={group.id} aria-label={`${group.tradeLabel} · ${group.locationLabel}`} className="grid gap-3 rounded-[var(--radius-md)] border border-border p-3">
              <h3 className="t-body-strong text-ink">{group.tradeLabel} · {group.locationLabel}</h3>
              <ul className="grid gap-2">
                {group.tickets.map((ticket) => (
                  <li key={ticket.id} className="t-caption text-ink-2">
                    <Link href={`/ops/tickets/${ticket.id}`} className="font-semibold text-ink underline">
                      {ticket.label} · חנות #{ticket.storeCode}
                    </Link>
                    {ticket.title ? <p>{ticket.title}</p> : null}
                  </li>
                ))}
              </ul>
              {result ? (
                <>
                  <p className="t-body-strong text-[var(--signal-resolved)]">ארי אישר את הטיפול</p>
                  <p className="t-caption text-ink-2">
                    {result.engagement.professionalName || terms.name} · {formatIls(result.engagement.approvedAmount ?? Number(terms.amount))} לכל הביקור
                  </p>
                  <p className="t-body text-ink-2">מנהל החנות מתאם ישירות מול איש המקצוע ומאשר בסיום שהתקלה סודרה.</p>
                  {result.handoffs.length === 0 ? (
                    <p className="t-body text-[var(--signal-warning)]">האישור נשמר. מצב ההודעה לחנות לא התקבל.</p>
                  ) : (
                    <VisitHandoffList handoffs={result.handoffs} />
                  )}
                  {retryable ? (
                    <Button type="button" variant="secondary" disabled={pending !== null} onClick={() => void approve(group, true)}>
                      {pending === group.id ? 'מעביר…' : 'נסה שוב להעביר לחנות'}
                    </Button>
                  ) : null}
                </>
              ) : !group.ready ? (
                <p className="t-body text-[var(--signal-warning)]">יש להשלים סיווג מקצוע ועיר חנות לפני בחירת איש מקצוע ואישור טיפול.</p>
              ) : (
                <>
                  <Button asChild variant="secondary" size="touch">
                    <a href={group.searchUrl!} target="_blank" rel="noreferrer">
                      חיפוש במידרג · {group.tradeLabel} · {group.locationLabel}
                    </a>
                  </Button>
                  {!group.preciseSearch ? <p className="t-caption text-[var(--signal-warning)]">יש לבחור את העיר במידרג; העיר הזו אינה כלולה בקישור.</p> : null}
                  <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void approve(group) }}>
                    <p className="t-caption text-ink-2">אחרי השיחה, הזינו את הפרטים והמחיר שסוכם לכל הביקור.</p>
                    <label className="grid gap-1">
                      <span className="t-caption text-ink-2">שם איש המקצוע</span>
                      <input required minLength={2} autoComplete="off" value={terms.name} onChange={(event) => updateTerms(group, 'name', event.target.value)} disabled={pending !== null} className="min-h-11 rounded-[var(--radius-md)] border border-border bg-surface px-3 text-base text-ink" />
                    </label>
                    <label className="grid gap-1">
                      <span className="t-caption text-ink-2">טלפון איש המקצוע</span>
                      <input required type="tel" autoComplete="off" dir="ltr" value={terms.phone} onChange={(event) => updateTerms(group, 'phone', event.target.value)} disabled={pending !== null} className="min-h-11 rounded-[var(--radius-md)] border border-border bg-surface px-3 text-base text-ink" />
                    </label>
                    <label className="grid gap-1">
                      <span className="t-caption text-ink-2">מחיר שסוכם לכל הביקור (₪)</span>
                      <input required type="number" inputMode="decimal" min="0.01" step="0.01" value={terms.amount} onChange={(event) => updateTerms(group, 'amount', event.target.value)} disabled={pending !== null} className="min-h-11 rounded-[var(--radius-md)] border border-border bg-surface px-3 text-base text-ink" />
                    </label>
                    <Button type="submit" variant="primary" size="touch" disabled={pending !== null || !validTerms(terms)}>
                      {pending === group.id ? 'מאשר ומעביר…' : 'אשר טיפול והעבר לחנות'}
                    </Button>
                  </form>
                </>
              )}
              {errors[group.id] ? <p role="alert" className="t-body text-[var(--signal-critical)]">{errors[group.id]}</p> : null}
            </section>
          )
        })}
        <Button type="button" variant="secondary" size="touch" disabled={pending !== null} onClick={() => dismiss(false)}>סגור</Button>
      </div>
    </BottomSheet>
  )
}
