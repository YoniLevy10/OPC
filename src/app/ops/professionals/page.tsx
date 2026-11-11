import Link from 'next/link'
import { redirect } from 'next/navigation'
import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { OpsPageHero } from '@/components/ops/ops-page-hero'
import { EmptyState } from '@/components/ui/primitives'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { getLocale } from '@/lib/i18n/server'
import { phrase } from '@/lib/i18n/phrases'
import { listProfessionals } from '@/modules/professionals/service'
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
import { UserRound } from 'lucide-react'

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

  const ranked = rankKnownVendors(outcomes, 'hvac')

  return (
    <OpsAppShell>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 md:gap-5">
        <OpsPageHero
          title="בעלי מקצוע"
          status="ספר קשר לתיאום, וספקים לשיגור כשצריך."
        />

        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          <li className="flex min-h-[4.75rem] flex-col justify-between rounded-[var(--radius-lg)] border border-border bg-surface px-3.5 py-3">
            <span className="t-meta text-ink-3">{p('בספר')}</span>
            <span className="t-num mt-2 text-[1.5rem] font-semibold leading-none text-ink">
              {professionals.length}
            </span>
          </li>
          <li className="flex min-h-[4.75rem] flex-col justify-between rounded-[var(--radius-lg)] border border-border bg-surface px-3.5 py-3">
            <span className="t-meta text-ink-3">{p('ספקים פעילים')}</span>
            <span className="t-num mt-2 text-[1.5rem] font-semibold leading-none text-ink">
              {activeCount}
            </span>
          </li>
          <li className="flex min-h-[4.75rem] flex-col justify-between rounded-[var(--radius-lg)] border border-border bg-surface px-3.5 py-3">
            <span className="t-meta text-ink-3">{p('מועדפים')}</span>
            <span className="t-num mt-2 text-[1.5rem] font-semibold leading-none text-ink">
              {preferredCount}
            </span>
          </li>
          <li className="flex min-h-[4.75rem] flex-col justify-between rounded-[var(--radius-lg)] border border-border bg-surface px-3.5 py-3">
            <span className="t-meta text-ink-3">{p('מקצועות מידרג')}</span>
            <span className="t-num mt-2 text-[1.5rem] font-semibold leading-none text-ink">
              {sectors.length}
            </span>
          </li>
        </ul>

        <nav
          aria-label={p('מעבר מהיר')}
          className="flex flex-wrap gap-2 border-b border-border pb-3"
        >
          <a
            href="#contacts"
            className="t-caption rounded-full border border-border bg-surface px-3 py-1.5 text-ink hover:bg-[var(--tenant-soft)] hover:text-[var(--tenant)]"
          >
            {p('ספר קשר')}
          </a>
          <a
            href="#vendors"
            className="t-caption rounded-full border border-border bg-surface px-3 py-1.5 text-ink hover:bg-[var(--tenant-soft)] hover:text-[var(--tenant)]"
          >
            {p('ספקים לשיגור')}
          </a>
          <a
            href="#outcomes"
            className="t-caption rounded-full border border-border bg-surface px-3 py-1.5 text-ink hover:bg-[var(--tenant-soft)] hover:text-[var(--tenant)]"
          >
            {p('תוצאות טיפול')}
          </a>
        </nav>

        <section id="contacts" className="scroll-mt-6 space-y-3">
          <header className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="t-section text-ink">{p('ספר קשר')}</h2>
              <p className="t-meta text-ink-3">
                {p('מידרג או הוספה ידנית — חיוג מהיר בפעם הבאה')}
              </p>
            </div>
          </header>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
              <p className="t-body-strong text-ink">{p('חיפוש במידרג')}</p>
              <p className="t-caption mt-1 text-ink-3">
                {p('פותח מידרג חיצוני. מעתיקים שם וטלפון ושומרים לספר.')}
              </p>
              <div className="mt-3">
                <ProfessionalsMidrag />
              </div>
            </div>
            <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
              <ProfessionalsManualAdd />
            </div>
          </div>

          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <p className="t-body-strong text-ink">{p('שמורים')}</p>
              <p className="t-meta text-ink-3">
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
              <ProfessionalsBook professionals={professionals} />
            )}
          </div>
        </section>

        <section id="vendors" className="scroll-mt-6 space-y-3">
          <header>
            <h2 className="t-section text-ink">{p('ספקים לשיגור')}</h2>
            <p className="t-meta text-ink-3">
              {p('{active} פעילים · {preferred} מועדפים — לשליחה דרך המערכת', {
                active: activeCount,
                preferred: preferredCount,
              })}
            </p>
          </header>
          <VendorsAdmin initialVendors={enriched} />
        </section>

        <section id="outcomes" className="scroll-mt-6 space-y-3">
          <header>
            <h2 className="t-section text-ink">{p('תוצאות טיפול')}</h2>
            <p className="t-meta text-ink-3">
              {p('מחיר, איכות וזמן הגעה — לדירוג מהיר בפעם הבאה')}
            </p>
          </header>
          <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
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
          </div>
        </section>
      </div>
    </OpsAppShell>
  )
}
