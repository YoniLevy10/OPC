'use client'

import { useId, useState } from 'react'
import {
  cancelEngagementAction,
  lockEngagementAction,
  setUrgentAction,
} from '@/app/ops/tickets/engagement-actions'
import type { Engagement } from '@/modules/engagements/service'
import { formatIls } from '@/modules/spend/true-cost'
import type { MidragPro } from '@/modules/vendors/midrag/live-results'
import type { Professional } from '@/modules/professionals/types'
import { Button } from '@/components/ui/button'
import { MidragSearchAction } from '@/components/ops/midrag-search-action'
import { usePhrase } from '@/components/i18n/locale-provider'

export type CompanionChoice = {
  id: string
  storeName: string
  summary: string
}

export function EngagementPanel({
  ticketId,
  urgent,
  status,
  locked,
  book = [],
  pros,
  searchUrl,
  fallback,
  companions,
  category = 'other',
  city,
}: {
  ticketId: string
  urgent: boolean
  status: string
  locked: Engagement | null
  book?: Professional[]
  pros: MidragPro[]
  searchUrl: string
  fallback: boolean
  companions: CompanionChoice[]
  category?: string
  city?: string | null
}) {
  const p = usePhrase()
  const formId = useId()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [scope, setScope] = useState('')
  const [amount, setAmount] = useState('')
  const [pickedMidrag, setPickedMidrag] = useState('')
  const [pickedBookId, setPickedBookId] = useState('')

  function applyBookPro(pro: Professional) {
    setPickedBookId(pro.id)
    setPickedMidrag('')
    setName(pro.full_name)
    setPhone(pro.phone ?? '')
    setScope((prev) => prev.trim() || pro.trade || '')
  }

  function applyMidragPro(pro: MidragPro) {
    setPickedBookId('')
    setPickedMidrag(`${pro.id}::${encodeURIComponent(pro.name)}`)
    setName(pro.name)
    // Midrag does not expose a phone to third-party sites — leave for Ari after the call.
    setPhone('')
    setScope((prev) => prev.trim() || p('תיאום אחרי שיחה במידרג'))
    // Indicative range only — never lock Midrag min/max as the approved price.
    setAmount('')
    window.setTimeout(() => {
      document
        .getElementById(`${formId}-phone`)
        ?.focus()
    }, 0)
  }

  if (status === 'closed' || status === 'cancelled') return null

  if (locked && status === 'engaged') {
    return (
      <section className="grid gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-4">
        <p className="t-body-strong text-ink">{p('ארי יצא. מנהל החנות מתאם.')}</p>
        <p className="t-body text-ink-2">
          {locked.professionalName} · {locked.professionalPhone} ·{' '}
          {(locked.approvedAmount ?? 0) > 0
            ? formatIls(locked.approvedAmount ?? 0)
            : p('מחיר טרם סוכם')}
        </p>
        {locked.handoff ? (
          <p
            className={`t-meta ${locked.handoff.ok ? 'text-[var(--signal-resolved)]' : 'text-[var(--signal-critical)]'}`}
          >
            {locked.handoff.line}
          </p>
        ) : null}
        {locked.proSms ? (
          <p
            className={`t-meta ${locked.proSms.ok ? 'text-[var(--signal-resolved)]' : 'text-[var(--signal-critical)]'}`}
          >
            {locked.proSms.line}
            {locked.proSms.portalUrl ? (
              <>
                {' · '}
                <a
                  href={locked.proSms.portalUrl}
                  className="underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  קישור אישי
                </a>
              </>
            ) : null}
          </p>
        ) : null}
        <p className="t-meta text-ink-3">
          {p('המחיר נעול. שינוי דורש ביטול וחזרה לתור.')}
        </p>
        <form action={cancelEngagementAction}>
          <input type="hidden" name="ticketId" value={ticketId} />
          <Button type="submit" variant="secondary" size="sm">
            {p('בטל אישור')}
          </Button>
        </form>
      </section>
    )
  }

  return (
    <section className="grid gap-4 rounded-[var(--radius-lg)] border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="t-body-strong text-ink">
          {urgent ? p('דחוף') : p('לא דחוף')}
        </p>
        <form action={setUrgentAction}>
          <input type="hidden" name="ticketId" value={ticketId} />
          <input type="hidden" name="urgent" value={urgent ? '0' : '1'} />
          <Button type="submit" variant="secondary" size="sm">
            {urgent ? p('סמן כלא דחוף') : p('סמן כדחוף')}
          </Button>
        </form>
      </div>

      {urgent ? (
        <form action={lockEngagementAction} className="grid gap-3">
          <input type="hidden" name="ticketId" value={ticketId} />
          <input type="hidden" name="midrag" value={pickedMidrag} />
          <input type="hidden" name="professional_id" value={pickedBookId} />

          {book.length > 0 ? (
            <fieldset className="grid gap-2">
              <legend className="t-body-strong text-ink">
                {p('מאגר אנשי מקצוע')}
              </legend>
              <p className="t-meta text-ink-3">
                בחרו מאנשי מקצוע שכבר עבדו עם ארי — מידרג רק אם חסר במאגר.
              </p>
              <ul className="grid max-h-44 gap-2 overflow-y-auto sm:grid-cols-2">
                {book.map((pro) => (
                  <li
                    key={pro.id}
                    className="rounded-[var(--radius-md)] border border-border px-3"
                  >
                    <label className="flex min-h-[var(--tap)] cursor-pointer items-center gap-3 py-2">
                      <input
                        type="radio"
                        name="book_ui"
                        value={pro.id}
                        checked={pickedBookId === pro.id}
                        onChange={() => applyBookPro(pro)}
                        className="h-5 w-5 shrink-0 accent-[var(--tenant)]"
                      />
                      <span className="min-w-0">
                        <span className="t-body block truncate text-ink">
                          {pro.full_name}
                          {pro.trade ? ` · ${pro.trade}` : ''}
                        </span>
                        <span className="t-meta block truncate text-ink-3" dir="ltr">
                          {pro.phone || 'בלי טלפון'}
                          {pro.use_count > 0 ? ` · ${pro.use_count}×` : ''}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              asChild
              variant="secondary"
              size="sm"
              className="min-w-0 flex-1 sm:flex-none"
            >
              <a href={searchUrl} target="_blank" rel="noreferrer">
                {p('מידרג באזור')}
              </a>
            </Button>
            <MidragSearchAction
              category={category}
              city={city}
              compact
              mode="handoff"
              returnToId="ticket-actions"
              className="min-w-0 flex-1 sm:flex-none"
            />
          </div>

          {pros.length > 0 ? (
            <fieldset className="grid gap-2">
              <legend className="t-body-strong text-ink">{p('מידרג באזור')}</legend>
              <p className="t-meta text-ink-3">
                {p('טווח מידרג הוא לא המחיר שאושר.')}{' '}
                {p('בחירה ממלאת את השם — הטלפון אחרי השיחה.')}
              </p>
              <ul className="grid max-h-44 gap-2 overflow-y-auto sm:grid-cols-2">
                {pros.map((pro) => {
                  const value = `${pro.id}::${encodeURIComponent(pro.name)}`
                  return (
                    <li
                      key={pro.id}
                      className="rounded-[var(--radius-md)] border border-border px-3"
                    >
                      <label className="flex min-h-[var(--tap)] cursor-pointer items-center gap-3 py-2">
                        <input
                          type="radio"
                          name="midrag_ui"
                          value={value}
                          checked={pickedMidrag === value}
                          onChange={() => applyMidragPro(pro)}
                          className="h-5 w-5 shrink-0 accent-[var(--tenant)]"
                        />
                        <span className="min-w-0">
                          <span className="t-body block truncate text-ink">
                            {pro.name}
                            {pro.rating != null ? ` · ${pro.rating}` : ''}
                            {pro.reviews != null ? ` · ${pro.reviews}` : ''}
                          </span>
                          <span className="t-meta block truncate text-ink-3">
                            {pro.availability || p('זמינות לא צוינה')}
                            {pro.priceMin != null
                              ? ` · ${p('טווח')} ${formatIls(pro.priceMin)}${pro.priceMax != null ? `–${formatIls(pro.priceMax)}` : ''}`
                              : ''}
                          </span>
                          <a
                            className="t-meta text-ink underline"
                            href={pro.profileUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {p('דברו איתי במידרג')}
                          </a>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </fieldset>
          ) : (
            <p className="t-body text-ink-2">
              {fallback ? p('מידרג לא נפתח עכשיו. ') : p('אין תוצאות באזור. ')}
              {p('השתמשו בחיפוש הכללי או בחיפוש לפי מקצוע.')}
            </p>
          )}

          {companions.length > 0 ? (
            <fieldset className="grid gap-2">
              <legend className="t-body-strong text-ink">
                {p('לסגור באותו ביקור')}
              </legend>
              {companions.map((row) => (
                <label key={row.id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    name="bundle"
                    value={row.id}
                    defaultChecked
                  />
                  <span className="t-body text-ink">
                    {row.storeName} · {row.summary}
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="t-meta text-ink-2">{p('שם אחרי השיחה')}</span>
              <input
                name="professional_name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="min-h-11 rounded-[var(--radius-md)] border border-border bg-canvas px-3 text-base text-ink"
                placeholder={p('אם לא בחרת מהרשימה')}
              />
            </label>
            <label className="grid gap-1">
              <span className="t-meta text-ink-2">{p('טלפון')}</span>
              <input
                id={`${formId}-phone`}
                name="professional_phone"
                required
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="min-h-11 rounded-[var(--radius-md)] border border-border bg-canvas px-3 text-base text-ink"
                placeholder={p('המספר שארי קיבל')}
              />
            </label>
            <label className="grid gap-1">
              <span className="t-meta text-ink-2">{p('העבודה שסוכמה')}</span>
              <input
                name="scope"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="min-h-11 rounded-[var(--radius-md)] border border-border bg-canvas px-3 text-base text-ink"
                placeholder={p('מה בעל המקצוע יעשה')}
              />
            </label>
            <label className="grid gap-1">
              <span className="t-meta text-ink-2">
                {p('מחיר שסוכם (אופציונלי)')}
              </span>
              <input
                name="approved_amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="min-h-11 rounded-[var(--radius-md)] border border-border bg-canvas px-3 text-base text-ink"
                placeholder="₪"
              />
            </label>
          </div>
          <Button type="submit" variant="primary" className="max-md:w-full">
            אשר · WA למנהל + SMS לאיש מקצוע
          </Button>
        </form>
      ) : (
        <p className="t-body text-ink-2">
          {p(
            'נשאר בתור. ייכנס להצעת שילוב כשתהיה דחופה באותה חנות או מחוז.',
          )}
        </p>
      )}
    </section>
  )
}
