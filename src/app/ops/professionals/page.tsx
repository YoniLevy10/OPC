import Link from 'next/link'
import { redirect } from 'next/navigation'
import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { EmptyState, Panel } from '@/components/ui/primitives'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { getLocale } from '@/lib/i18n/server'
import { phrase } from '@/lib/i18n/phrases'
import { listProfessionals } from '@/modules/professionals/service'
import {
  listEngagements,
  type ProfessionalVisitRow,
} from '@/modules/engagements/service'
import { midragSectorsForSelect } from '@/modules/vendors/midrag/catalog'
import { ProfessionalsBook } from './professionals-book'
import { ProfessionalsManualAdd } from './professionals-manual-add'
import { ProfessionalsMidrag } from './professionals-midrag'
import { VendorsAdmin, type VendorRow } from '../vendors/vendors-admin'
import { listVendors } from '@/modules/vendors/service'
import { listRecentAuditEvents } from '@/modules/audit/service'
import { listTickets } from '@/modules/tickets/service'
import { OPEN_TICKET_STATUSES, type TicketStatus } from '@/modules/tickets/constants'
import { listOutcomes } from '@/lib/data/ops-ledger'
import { addOutcomeAction } from '../work-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { normalizePhoneDigits, formatIsraeliPhoneDisplay } from '@/lib/phone'
import { rankKnownVendors } from '@/modules/vendors/outcomes'
import { cn } from '@/lib/utils'
import { Search, UserPlus, UserRound } from 'lucide-react'

export const dynamic = 'force-dynamic'

function isOpenStatus(status: string) {
  return OPEN_TICKET_STATUSES.includes(status as TicketStatus)
}

export default async function ProfessionalsPage() {
  const locale = await getLocale()
  const p = (text: string, vars?: Record<string, string | number>) =>
    phrase(locale, text, vars)
  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) redirect('/login')

  const sectors = midragSectorsForSelect()
  const [{ vendors }, { events }, ticketResult] = await Promise.all([
    listVendors(),
    listRecentAuditEvents(300),
    listTickets(1000).catch(() => ({ tickets: [], backend: 'memory' as const })),
  ])
  const ticketById = new Map(
    (ticketResult.tickets ?? []).map((ticket) => [ticket.id, ticket]),
  )
  const statsByVendor = new Map<
    string,
    { openIds: Set<string>; recent: VendorRow['recent'] }
  >()
  for (const event of events) {
    if (event.event_type !== 'partner_dispatched') continue
    const vendorId = String(
      (event.payload as { vendor_id?: string }).vendor_id ?? '',
    )
    if (!vendorId) continue
    const stats = statsByVendor.get(vendorId) ?? {
      openIds: new Set<string>(),
      recent: [],
    }
    const ticket = ticketById.get(event.ticket_id)
    if (ticket && isOpenStatus(ticket.status)) stats.openIds.add(event.ticket_id)
    if (stats.recent.length < 8) {
      stats.recent.push({
        ticket_id: event.ticket_id,
        ticket_display: event.ticket_display,
        created_at: event.created_at,
        status: String((event.payload as { status?: string }).status ?? ''),
      })
    }
    statsByVendor.set(vendorId, stats)
  }
  const enriched: VendorRow[] = vendors.map((vendor) => ({
    ...vendor,
    open_tickets: statsByVendor.get(vendor.id)?.openIds.size ?? 0,
    avg_response_label: '—',
    recent: statsByVendor.get(vendor.id)?.recent ?? [],
  }))
  const activeCount = enriched.filter((vendor) => vendor.active).length
  const preferredCount = enriched.filter(
    (vendor) => vendor.preferred && vendor.active,
  ).length
  const outcomes = listOutcomes()
  let professionals: Awaited<
    ReturnType<typeof listProfessionals>
  >['professionals'] = []
  try {
    const result = await listProfessionals({ limit: 100 })
    professionals = result.professionals
  } catch {
    professionals = []
  }

  const historyByProfessionalId: Record<string, ProfessionalVisitRow[]> = {}
  const historyByPhone: Record<string, ProfessionalVisitRow[]> = {}
  try {
    const engagements = await listEngagements()
    for (const row of engagements) {
      const visit: ProfessionalVisitRow = {
        engagementId: row.id,
        ticketId: row.ticketId,
        bundledTicketIds: row.bundledTicketIds,
        storeCode: row.storeCode,
        storeName: row.storeName,
        approvedAmount: row.approvedAmount,
        approvedAt: row.approvedAt,
        status: row.status,
        closedAt: row.closedAt,
      }
      if (row.professionalId) {
        const list = historyByProfessionalId[row.professionalId] ?? []
        list.push(visit)
        historyByProfessionalId[row.professionalId] = list
      }
      const phone = normalizePhoneDigits(row.professionalPhone)
      if (phone) {
        const list = historyByPhone[phone] ?? []
        list.push(visit)
        historyByPhone[phone] = list
      }
    }
    for (const list of Object.values(historyByProfessionalId)) {
      list.sort((a, b) => (a.approvedAt < b.approvedAt ? 1 : -1))
    }
    for (const list of Object.values(historyByPhone)) {
      list.sort((a, b) => (a.approvedAt < b.approvedAt ? 1 : -1))
    }
  } catch {
    // Book still works without visit history.
  }

  const ranked = rankKnownVendors(outcomes, 'hvac')

  const metrics = [
    { label: p('בספר'), value: professionals.length, accent: false },
    { label: p('ספקים פעילים'), value: activeCount, accent: false },
    {
      label: p('מועדפים'),
      value: preferredCount,
      accent: preferredCount > 0,
    },
    { label: p('מקצועות מידרג'), value: sectors.length, accent: false },
  ]

  const sectionTabs = [
    { href: '#contacts', label: p('ספר קשר') },
    { href: '#vendors', label: p('ספקים לשיגור') },
    { href: '#outcomes', label: p('תוצאות טיפול') },
  ]

  return (
    <OpsAppShell>
      <div className="ari-home flex flex-col gap-3">
        <header className="flex flex-col gap-1">
          <h1 className="t-title text-ink">{p('בעלי מקצוע')}</h1>
          <p className="t-meta text-ink-2">
            {p('ספר קשר לתיאום, וספקים לשיגור כשצריך.')}
          </p>
        </header>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="flex min-h-[5.75rem] min-w-0 flex-col justify-between rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-4"
            >
              <span
                className={cn(
                  't-num block text-[2.125rem] font-semibold leading-none tracking-tight',
                  metric.accent ? 'text-[var(--tenant)]' : 'text-ink',
                )}
              >
                {metric.value}
              </span>
              <span className="t-body mt-3 block text-ink-2">{metric.label}</span>
            </div>
          ))}
        </div>

        <nav
          aria-label={p('מעבר מהיר')}
          className="sticky top-0 z-20 bg-[var(--canvas)] py-2"
        >
          <div className="flex w-full min-w-0 gap-1 overflow-x-auto rounded-[var(--radius-md)] border border-border bg-[var(--surface-sunken)]/50 p-1 scrollbar-none">
            {sectionTabs.map((tab) => (
              <a
                key={tab.href}
                href={tab.href}
                className="t-control flex h-10 min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-[var(--radius-sm)] px-3 text-center text-ink-3 transition-colors hover:bg-surface hover:text-ink hover:shadow-[var(--shadow-1)]"
              >
                {tab.label}
              </a>
            ))}
          </div>
        </nav>

        <section id="contacts" className="scroll-mt-6 flex flex-col gap-3">
          <header>
            <h2 className="t-section text-ink">{p('ספר קשר')}</h2>
            <span aria-hidden className="clay-rule" />
            <p className="t-meta mt-1 text-ink-3">
              {p('מידרג או הוספה ידנית — חיוג מהיר בפעם הבאה')}
            </p>
          </header>

          <div className="grid items-stretch gap-3 lg:grid-cols-2">
            <div className="flex h-full min-h-0 flex-col rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-1)]">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--tenant-soft)] text-[var(--tenant)]"
                >
                  <Search className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="t-body-strong text-ink">{p('חיפוש במידרג')}</p>
                  <p className="t-caption mt-1 text-ink-2">
                    {p('פותח מידרג חיצוני. מעתיקים שם וטלפון ושומרים לספר.')}
                  </p>
                </div>
              </div>
              <div className="mt-auto pt-4">
                <ProfessionalsMidrag />
              </div>
            </div>
            <div className="flex h-full min-h-0 flex-col rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-1)]">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--tenant-soft)] text-[var(--tenant)]"
                >
                  <UserPlus className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="t-body-strong text-ink">{p('הוספה ידנית')}</p>
                  <p className="t-caption mt-1 text-ink-2">
                    {p('שם וטלפון — בלי מידרג.')}
                  </p>
                </div>
              </div>
              <div className="mt-auto flex min-h-0 flex-1 flex-col pt-4">
                <ProfessionalsManualAdd />
              </div>
            </div>
          </div>

          <Panel flush elevated className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-border bg-[var(--surface-sunken)] px-4 py-3">
              <div>
                <p className="t-body-strong text-ink">{p('שמורים')}</p>
                <span aria-hidden className="clay-rule" />
              </div>
              <p className="t-meta t-num text-ink-3">
                {professionals.length === 0
                  ? p('ריק')
                  : p('{count} אנשי מקצוע', { count: professionals.length })}
              </p>
            </div>
            {professionals.length === 0 ? (
              <EmptyState
                title={p('עדיין אין אנשי מקצוע שמורים')}
                description={p(
                  'חפשו במידרג או הוסיפו ידנית — ואפשר למחוק מהספר בכל עת.',
                )}
                icon={UserRound}
                className="py-12"
              />
            ) : (
              <ProfessionalsBook
                professionals={professionals}
                historyByProfessionalId={historyByProfessionalId}
                historyByPhone={historyByPhone}
              />
            )}
          </Panel>
        </section>

        <section id="vendors" className="scroll-mt-6 flex flex-col gap-3">
          <header>
            <h2 className="t-section text-ink">{p('ספקים לשיגור')}</h2>
            <span aria-hidden className="clay-rule" />
            <p className="t-meta mt-1 text-ink-3">
              {p('{active} פעילים · {preferred} מועדפים — לשליחה דרך המערכת', {
                active: activeCount,
                preferred: preferredCount,
              })}
            </p>
          </header>
          <VendorsAdmin initialVendors={enriched} />
        </section>

        <section id="outcomes" className="scroll-mt-6 flex flex-col gap-3">
          <header>
            <h2 className="t-section text-ink">{p('תוצאות טיפול')}</h2>
            <span aria-hidden className="clay-rule" />
            <p className="t-meta mt-1 text-ink-3">
              {p('מחיר, איכות וזמן הגעה — לדירוג מהיר בפעם הבאה')}
            </p>
          </header>
          <Panel elevated>
            <form
              action={addOutcomeAction}
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            >
              <Input
                name="vendorName"
                placeholder={p('שם ספק / בעל מקצוע')}
                required
              />
              <Input
                name="category"
                placeholder={p('סוג תקלה')}
                defaultValue="hvac"
              />
              <Input name="region" placeholder={p('אזור')} />
              <Input name="price" type="number" placeholder={p('מחיר')} />
              <Input
                name="arrival"
                type="number"
                placeholder={p('דקות הגעה')}
              />
              <Input
                name="quality"
                type="number"
                placeholder={p('איכות 1–5')}
              />
              <Input name="warranty" placeholder={p('אחריות')} />
              <label className="t-meta flex min-h-11 items-center gap-2 text-ink-2">
                <input type="checkbox" name="success" defaultChecked />
                {p('הצליח')}
              </label>
              <div className="sm:col-span-2 lg:col-span-4">
                <Button type="submit" variant="secondary">
                  {p('שמירת תוצאה')}
                </Button>
              </div>
            </form>

            {ranked.length > 0 ? (
              <ul className="mt-4 divide-y divide-border border-t border-border">
                {ranked.map((row) => {
                  const phone = enriched.find(
                    (vendor) => vendor.name === row.vendorName,
                  )?.contact_phone
                  const digits = normalizePhoneDigits(phone)
                  return (
                    <li
                      key={`${row.vendorName}-${row.price}`}
                      className="flex flex-wrap items-center justify-between gap-2 py-3"
                    >
                      <span className="t-body text-ink">
                        {row.vendorName}
                        <span className="t-meta text-ink-3">
                          {' '}
                          · {row.price ?? '—'} · {p('איכות')}{' '}
                          {row.quality ?? '—'}
                        </span>
                      </span>
                      {digits ? (
                        <Link
                          className="t-meta text-ink underline-offset-2 hover:underline"
                          href={`https://wa.me/${digits}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {p('וואטסאפ')} ·{' '}
                          {formatIsraeliPhoneDisplay(phone || digits)}
                        </Link>
                      ) : (
                        <span className="t-caption text-ink-3">
                          {p('אין טלפון')}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="t-meta mt-4 border-t border-border pt-4 text-ink-3">
                {p('עדיין אין תוצאות שמורות.')}
              </p>
            )}
          </Panel>
        </section>
      </div>
    </OpsAppShell>
  )
}
