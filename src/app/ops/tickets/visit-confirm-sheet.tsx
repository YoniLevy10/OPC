'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BottomSheet } from '@/components/ui/overlay'
import { buildMidragSearchUrl } from '@/modules/vendors/external-search'
import { visitPlaceLabel } from '@/modules/vendors/visit-pick'
import type { VisitPoolVendor } from '@/modules/vendors/visit-pick'

export type VisitConfirmTicket = {
  id: string
  label: string
  title?: string
  spendBlock?: string | null
}

export type VisitConfirmVendor = VisitPoolVendor

export type VisitItemResult = {
  ticket_id: string
  display_number: string | null
  status: string
  error: string | null
  can_retry: boolean
  needs_approval?: boolean
}

export type VisitResult = {
  id: string
  status: string
  items: VisitItemResult[]
  sms?: { ok: boolean; line: string } | null
}

export type VisitBookPerson = {
  id: string
  full_name: string
  phone: string | null
  trade: string | null
}

function statusLabel(status: string): string {
  switch (status) {
    case 'sent':
      return 'נשלח לספק'
    case 'labeled':
      return 'סומן לשיבוץ (אין ערוץ חי)'
    case 'ack':
      return 'אושר ע״י ספק'
    case 'failed':
      return 'נכשל'
    case 'blocked':
      return 'חסום — נדרש אישור'
    case 'queued':
      return 'בתכנון'
    case 'planned':
      return 'תוכנן'
    case 'partial':
      return 'חלקי'
    case 'dispatched':
      return 'שובץ'
    default:
      return status
  }
}

function statusTone(status: string): string {
  if (status === 'sent' || status === 'ack' || status === 'dispatched') {
    return 'text-[var(--signal-success)]'
  }
  if (status === 'labeled') return 'text-[var(--signal-warning)]'
  if (status === 'failed' || status === 'blocked' || status === 'partial') {
    return 'text-[var(--signal-critical)]'
  }
  return 'text-ink-2'
}

export function VisitConfirmSheet({
  open,
  onOpenChange,
  title,
  storeLabel,
  tickets,
  city,
  region,
  category,
  notes,
  onNotesChange,
  scheduledAt,
  onScheduledAtChange,
  suggestions = [],
  includedSuggestionIds = [],
  onIncludedSuggestionIdsChange,
  professionals = [],
  busy,
  canSubmit,
  result,
  onRetryFailed,
  onRetryTicket,
  onApprove,
  onLock,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  storeLabel: string
  tickets: VisitConfirmTicket[]
  /** Kept for callers that still pass a vendor pool; unused in the Ari handoff sheet. */
  vendors?: VisitConfirmVendor[]
  city?: string | null
  region?: string | null
  category?: string | null
  vendorId?: string
  onVendorIdChange?: (id: string) => void
  notes: string
  onNotesChange: (v: string) => void
  scheduledAt: string
  onScheduledAtChange: (v: string) => void
  suggestions?: VisitConfirmTicket[]
  includedSuggestionIds?: string[]
  onIncludedSuggestionIdsChange?: (ids: string[]) => void
  professionals?: VisitBookPerson[]
  busy: boolean
  canSubmit: boolean
  result: VisitResult | null
  onSubmit?: () => void
  onRetryFailed: () => void
  onRetryTicket: (ticketId: string) => void
  onApprove?: (ticketIds: string[]) => void
  onLock?: (input: {
    name: string
    phone: string
    amount: number
    scope: string
  }) => Promise<{ ok: boolean; line: string } | void>
  /** @deprecated Always uses the handoff form when onLock is set. */
  directLock?: boolean
}) {
  const placeName = visitPlaceLabel({ city, region })
  const midragUrl = buildMidragSearchUrl({ category: category || 'other', city })
  const [proName, setProName] = useState('')
  const [proPhone, setProPhone] = useState('')
  const [proScope, setProScope] = useState('')
  const [proPrice, setProPrice] = useState('')
  const [bookOpen, setBookOpen] = useState(false)
  const [lockLine, setLockLine] = useState<string | null>(null)
  const failed = result?.items.filter((i) => i.can_retry) ?? []
  const awaitingApproval =
    result?.items.filter((item) => item.needs_approval) ?? []
  const includedCount = suggestions.filter((row) =>
    includedSuggestionIds.includes(row.id),
  ).length
  const includedSuggestions = suggestions.filter((ticket) =>
    includedSuggestionIds.includes(ticket.id),
  )

  useEffect(() => {
    if (!open) return
    setProName('')
    setProPhone('')
    setProScope('')
    setProPrice('')
    setBookOpen(false)
    setLockLine(null)
  }, [open])

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={
        result
          ? `תוצאה · ${statusLabel(result.status)}`
          : `${storeLabel} · ${tickets.length + includedCount} תקלות`
      }
    >
      <div className="flex flex-col gap-4">
        {!result && onLock ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              const amount = Number(proPrice)
              void (async () => {
                const locked = await onLock({
                  name: proName,
                  phone: proPhone,
                  amount: Number.isFinite(amount) ? amount : 0,
                  scope: proScope,
                })
                if (locked?.line) setLockLine(locked.line)
              })()
            }}
          >
            <p className="t-body text-ink">
              חפשו במידרג, הזינו שם וטלפון, ושלחו למנהל החנות את איש המקצוע עם
              רשימת התקלות.
            </p>

            <dl className="t-caption grid gap-2 text-ink-2">
              <div className="flex justify-between gap-3">
                <dt>חנות</dt>
                <dd className="font-semibold text-ink">{storeLabel}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>מספר תקלות</dt>
                <dd className="t-num font-semibold text-ink">
                  {tickets.length + includedCount}
                </dd>
              </div>
            </dl>

            <ul className="t-caption max-h-36 space-y-1 overflow-y-auto rounded-[var(--radius-md)] border border-border bg-surface-sunken/30 px-3 py-2 text-ink-2">
              {tickets.map((t) => (
                <li key={t.id} className="flex flex-col gap-0.5">
                  <span className="font-semibold text-ink">{t.label}</span>
                  {t.title ? (
                    <span className="line-clamp-1">{t.title}</span>
                  ) : null}
                </li>
              ))}
              {includedSuggestions.map((ticket) => (
                <li key={ticket.id}>
                  <span className="font-semibold text-ink">{ticket.label}</span>
                  {ticket.title ? ` · ${ticket.title}` : ''}
                </li>
              ))}
            </ul>

            {suggestions.length > 0 ? (
              <fieldset className="grid gap-2">
                <legend className="t-caption text-ink-2">
                  אפשר לכלול באותו ביקור
                </legend>
                {suggestions.map((row) => {
                  const checked = includedSuggestionIds.includes(row.id)
                  return (
                    <label key={row.id} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-[var(--tenant)]"
                        checked={checked}
                        disabled={busy}
                        onChange={(event) => {
                          const next = new Set(includedSuggestionIds)
                          if (event.target.checked) next.add(row.id)
                          else next.delete(row.id)
                          onIncludedSuggestionIdsChange?.([...next])
                        }}
                      />
                      <span className="min-w-0">
                        <span className="t-caption font-semibold text-ink">
                          {row.label}
                        </span>
                        {row.title ? (
                          <span className="t-meta block line-clamp-2 text-ink-2">
                            {row.title}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  )
                })}
              </fieldset>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary" size="sm" className="min-w-0 flex-1">
                <a href={midragUrl} target="_blank" rel="noreferrer">
                  חיפוש במידרג{placeName ? ` · ${placeName}` : ''}
                </a>
              </Button>
              {professionals.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  disabled={busy}
                  aria-expanded={bookOpen}
                  onClick={() => setBookOpen((v) => !v)}
                >
                  מהספר ({professionals.length})
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${bookOpen ? 'rotate-180' : ''}`}
                    aria-hidden
                  />
                </Button>
              ) : null}
            </div>

            {professionals.length > 0 && bookOpen ? (
              <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-[var(--radius-md)] border border-border">
                {professionals.slice(0, 8).map((person) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start hover:bg-surface-sunken/50"
                      disabled={busy || !person.phone}
                      onClick={() => {
                        setProName(person.full_name)
                        if (person.phone) setProPhone(person.phone)
                        if (person.trade && !proScope.trim()) {
                          setProScope(person.trade)
                        }
                        setBookOpen(false)
                      }}
                    >
                      <span className="min-w-0">
                        <span className="t-body block truncate text-ink">
                          {person.full_name}
                        </span>
                        {person.trade ? (
                          <span className="t-meta block text-ink-3">
                            {person.trade}
                          </span>
                        ) : null}
                      </span>
                      <span className="t-caption shrink-0 text-ink-2">בחר</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="t-caption text-ink-2">שם איש המקצוע</span>
                <input
                  required
                  value={proName}
                  onChange={(e) => setProName(e.target.value)}
                  disabled={busy}
                  className="t-control min-h-[var(--tap)] rounded-[var(--radius-md)] border border-border bg-surface px-3 text-ink"
                  placeholder="אחרי השיחה במידרג"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="t-caption text-ink-2">טלפון</span>
                <input
                  required
                  inputMode="tel"
                  value={proPhone}
                  onChange={(e) => setProPhone(e.target.value)}
                  disabled={busy}
                  className="t-control min-h-[var(--tap)] rounded-[var(--radius-md)] border border-border bg-surface px-3 text-ink"
                  placeholder="המספר שסיכמתם"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="t-caption text-ink-2">העבודה שסוכמה</span>
                <input
                  value={proScope}
                  onChange={(e) => setProScope(e.target.value)}
                  disabled={busy}
                  className="t-control min-h-[var(--tap)] rounded-[var(--radius-md)] border border-border bg-surface px-3 text-ink"
                  placeholder="מה בעל המקצוע יעשה"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="t-caption text-ink-2">מחיר שסוכם (אופציונלי)</span>
                <input
                  inputMode="decimal"
                  value={proPrice}
                  onChange={(e) => setProPrice(e.target.value)}
                  disabled={busy}
                  className="t-control min-h-[var(--tap)] rounded-[var(--radius-md)] border border-border bg-surface px-3 text-ink"
                  placeholder="₪"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="t-caption text-ink-2">מועד מתוכנן (אופציונלי)</span>
                <input
                  type="datetime-local"
                  className="t-control min-h-[var(--tap)] rounded-[var(--radius-md)] border border-border bg-surface px-3 text-ink"
                  value={scheduledAt}
                  onChange={(e) => onScheduledAtChange(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="t-caption text-ink-2">הערה לחנות (אופציונלי)</span>
                <input
                  className="t-control min-h-[var(--tap)] rounded-[var(--radius-md)] border border-border bg-surface px-3 text-ink"
                  value={notes}
                  onChange={(e) => onNotesChange(e.target.value)}
                  disabled={busy}
                  placeholder="שעת הגעה, כניסה…"
                />
              </label>
            </div>

            {lockLine ? <p className="t-body text-ink">{lockLine}</p> : null}

            <Button
              type="submit"
              variant="primary"
              size="touch"
              className="w-full"
              disabled={busy || !canSubmit}
            >
              {busy ? 'שולח…' : 'תכנן ביקור ושלח לחנות'}
            </Button>
          </form>
        ) : result ? (
          <>
            {result.sms ? (
              <p
                className={`t-body font-semibold ${result.sms.ok ? 'text-[var(--signal-success)]' : 'text-[var(--signal-critical)]'}`}
              >
                {result.sms.line}
              </p>
            ) : null}
            <p className={`t-body font-semibold ${statusTone(result.status)}`}>
              {statusLabel(result.status)}
              {result.status === 'partial' ? ' — חלק מהתקלות לא שוגרו' : null}
            </p>
            <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
              {result.items.map((item) => (
                <li
                  key={item.ticket_id}
                  className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="t-caption t-num font-semibold text-ink">
                      {item.display_number || item.ticket_id.slice(0, 8)}
                    </p>
                    <p className={`t-caption ${statusTone(item.status)}`}>
                      {statusLabel(item.status)}
                    </p>
                    {item.error ? (
                      <p className="t-caption text-[var(--signal-critical)]">
                        {item.error}
                      </p>
                    ) : null}
                  </div>
                  {item.needs_approval && onApprove ? (
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      disabled={busy}
                      onClick={() => onApprove([item.ticket_id])}
                    >
                      אשר
                    </Button>
                  ) : item.can_retry ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => onRetryTicket(item.ticket_id)}
                    >
                      נסה שוב
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            {awaitingApproval.length > 0 && onApprove ? (
              <Button
                type="button"
                variant="primary"
                size="touch"
                className="w-full"
                disabled={busy}
                onClick={() =>
                  onApprove(awaitingApproval.map((item) => item.ticket_id))
                }
              >
                אשר ושלח ({awaitingApproval.length})
              </Button>
            ) : null}
            {failed.length > 0 ? (
              <Button
                type="button"
                variant={awaitingApproval.length > 0 ? 'secondary' : 'primary'}
                size="touch"
                className="w-full"
                disabled={busy}
                onClick={onRetryFailed}
              >
                נסה שוב את הכושלים ({failed.length})
              </Button>
            ) : awaitingApproval.length > 0 ? null : (
              <Button
                type="button"
                variant="secondary"
                size="touch"
                className="w-full"
                onClick={() => onOpenChange(false)}
              >
                סגור
              </Button>
            )}
          </>
        ) : (
          <p className="t-body text-ink-2">אין פעולת שליחה מוגדרת.</p>
        )}
      </div>
    </BottomSheet>
  )
}

/** Stable client idempotency key for a visit selection (survives double-click). */
export function buildVisitIdempotencyKey(input: {
  storeId: string
  vendorId?: string
  ticketIds: string[]
}): string {
  const tickets = [...input.ticketIds].sort().join(',')
  return `visit-client:${input.storeId}:plan:${tickets}`
}

export function scheduledAtToIso(localValue: string): string | null {
  if (!localValue.trim()) return null
  const d = new Date(localValue)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/** Keep one in-flight submit; ignore extra clicks while pending. */
export function useSubmitGuard() {
  const locked = useRef(false)
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<void>) {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    try {
      await fn()
    } finally {
      locked.current = false
      setBusy(false)
    }
  }

  return { busy, run }
}
