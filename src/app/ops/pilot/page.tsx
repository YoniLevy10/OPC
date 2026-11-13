import { redirect } from 'next/navigation'
import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { OpsPageHero } from '@/components/ops/ops-page-hero'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { getLocale } from '@/lib/i18n/server'
import { phrase } from '@/lib/i18n/phrases'
import { listTickets } from '@/modules/tickets/service'
import { findRecurrences } from '@/modules/tickets/recurrence'
import { computePilotMetrics, type PilotSample } from '@/modules/pilot/metrics'
import { pilotMoney } from '@/modules/pilot/value'
import { categorySpendBars, moneyBars } from '@/modules/pilot/story'
import { formatIls } from '@/modules/spend/true-cost'
import { RetainChat } from './retain-chat'
import { MoneyTiles, ValueBars } from './value-charts'
import { listClassificationCorrections, listFiles, listSpends } from '@/lib/data/ops-ledger'

export const dynamic = 'force-dynamic'

export default async function PilotPage() {
  const locale = await getLocale()
  const p = (text: string) => phrase(locale, text)
  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) redirect('/login')
  const { tickets } = await listTickets({ limit: 300 }).catch(() => ({
    tickets: [],
  }))
  const spends = listSpends()
  const files = listFiles()
  const repeatIds: string[] = []
  const samples: PilotSample[] = tickets.map((ticket) => {
    const repeats = findRecurrences(
      {
        id: ticket.id,
        storeId: ticket.store_id,
        category: ticket.category,
        description: ticket.description,
        status: ticket.status,
        createdAt: ticket.created_at,
      },
      tickets.map((row) => ({
        id: row.id,
        storeId: row.store_id,
        category: row.category,
        description: row.description,
        status: row.status,
        createdAt: row.created_at,
      })),
    )
    if (repeats.length > 0) {
      repeatIds.push(ticket.id, ...repeats.map((hit) => hit.ticket.id))
    }
    const spend = spends.find((row) => row.ticketId === ticket.id)
    return {
      openedAt: ticket.created_at,
      resolvedAt: ticket.resolved_at ?? null,
      approvalRequestedAt: spend?.createdAt ?? null,
      approvalDecidedAt: spend?.decidedAt ?? null,
      reachedAriOutsideSystem: false,
      repeatedFault: repeats.length > 0,
      ingestedClean: false,
      correctedManually: false,
    }
  })
  const fileSamples: PilotSample[] = files.map((file) => ({
    openedAt: new Date().toISOString(),
    resolvedAt: null,
    approvalRequestedAt: null,
    approvalDecidedAt: null,
    reachedAriOutsideSystem: false,
    repeatedFault: false,
    ingestedClean: file.status === 'ingested',
    correctedManually: file.status === 'needs_review',
  }))
  const metrics = computePilotMetrics([...samples, ...fileSamples])
  const money = pilotMoney(spends, repeatIds)
  const categoryByTicketId: Record<string, string> = {}
  for (const ticket of tickets) {
    if (ticket.id) categoryByTicketId[ticket.id] = ticket.category || 'other'
  }
  const tradeBars = categorySpendBars(spends, categoryByTicketId)
  const hasSaved = money.bundleSaved > 0
  const savedLine = hasSaved ? formatIls(money.bundleSaved) : '—'
  const opsMetrics = [
    {
      label: p('חציון שעות טיפול'),
      value: metrics.medianResolveHours?.toFixed(1) ?? '—',
    },
    {
      label: p('חציון שעות לאישור'),
      value: metrics.medianApprovalHours?.toFixed(1) ?? '—',
    },
    { label: p('תקלות חוזרות'), value: String(metrics.repeats) },
    { label: p('פניות מחוץ למערכת'), value: String(metrics.outsideSystem) },
    {
      label: p('קליטה נקייה'),
      value:
        metrics.cleanIngestRate == null
          ? '—'
          : `${Math.round(metrics.cleanIngestRate * 100)}%`,
    },
    {
      label: p('תיקוני סיווג'),
      value: String(listClassificationCorrections().length),
    },
  ]

  return (
    <OpsAppShell>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 md:gap-5">
        <OpsPageHero
          title={p('כמה נחסך')}
          status={p('הכסף שנרשם, והסניף שדורש אותך.')}
        />

        <section className="rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-4 md:px-5 md:py-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="t-caption text-ink-3">{p('נחסך מאיחוד ביקור')}</p>
              <p
                className={`t-title t-num mt-1 ${hasSaved ? 'text-ink' : 'text-ink-3'}`}
              >
                {savedLine}
              </p>
            </div>
            <p className="t-body max-w-md text-ink-2">
              {hasSaved
                ? p('ביקור אחד נרשם זול יותר משתי קריאות נפרדות על אותן תקלות.')
                : p(
                    'חיסכון נספר כשיש הצעת מחיר לכל תקלה, וביקור אחד זול יותר משתיהן.',
                  )}
            </p>
          </div>

          <div className="mt-5">
            <MoneyTiles
              bars={moneyBars(money).map((bar) => ({
                ...bar,
                label: p(bar.label),
              }))}
            />
          </div>

          {tradeBars.length > 0 ? (
            <div className="mt-5 border-t border-border pt-5">
              <ValueBars title={p('הצעות שנרשמו לפי סוג')} bars={tradeBars} />
            </div>
          ) : null}
        </section>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(17rem,0.95fr)] lg:gap-5">
          <section className="rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-4 md:px-5">
            <p className="t-section text-ink">{p('מדדים תפעוליים')}</p>
            <p className="t-meta mt-1 text-ink-3">
              {p('זמן, חזרות וקליטה — בלי קופסאות ריקות')}
            </p>
            <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {opsMetrics.map((row) => (
                <li
                  key={row.label}
                  className="flex min-h-[4.5rem] flex-col justify-between rounded-[var(--radius-lg)] border border-border px-3.5 py-3"
                >
                  <span className="t-meta text-ink-3">{row.label}</span>
                  <span className="t-num mt-2 text-[1.25rem] font-semibold leading-none text-ink">
                    {row.value}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <RetainChat />
        </div>
      </div>
    </OpsAppShell>
  )
}
