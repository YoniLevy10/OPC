import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { PartyPopper } from 'lucide-react'
import { OpsAppShell } from '@/components/layout/ops-app-shell'
import {
  EmptyState,
  Panel,
  ErrorState,
} from '@/components/ui/primitives'
import { Button } from '@/components/ui/button'
import { TicketSearch } from './ticket-search'
import { TicketFilters } from './ticket-filters'
import { TicketQueueItem } from './ticket-queue-item'
import { StoreCreateForm } from '@/app/ops/stores/store-create-form'
import { VisitQueueShell } from './visit-multi-select'
import { listTickets, listInternalTechnicians } from '@/modules/tickets/service'
import {
  applyQueue,
  parseQueueParams,
  queueHref,
  type QueueTicket,
  type QueueView,
} from '@/modules/tickets/queue'
import { OPEN_TICKET_STATUSES } from '@/modules/tickets/constants'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { scopeTicketsForActor } from '@/lib/auth/ticket-scope'
import { resolveTicketsSupabase } from '@/lib/supabase/tickets-client'
import { listStores } from '@/modules/stores/service'
import { Tx } from '@/components/i18n/tx'
import { getLocale } from '@/lib/i18n/server'
import { phrase } from '@/lib/i18n/phrases'
import { translate } from '@/lib/i18n/messages'
import { listVendors } from '@/modules/vendors/service'
import { listOutcomes, spendForTicket } from '@/lib/data/ops-ledger'
import { hydrateOpsLedger } from '@/lib/data/ops-db'
import { listProfessionals } from '@/modules/professionals/service'
import {
  recommendBundles,
  sameStoreCompanionIds,
  type BundleFault,
} from '@/modules/whatsapp/agent/bundle'
import { presentRecommendations } from '@/modules/recommendations/present'
import { TicketStoreGroups } from './ticket-store-groups'
import { executionBlockReason } from '@/modules/spend/policy'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50
/** Cap DB fetch; view filters open vs resolved at the query when possible. */
const FETCH_LIMIT = 200

const TAB_VIEWS = new Set<QueueView>([
  'open',
  'attention',
  'urgent',
  'stuck',
  'resolved',
])

function toFault(ticket: QueueTicket): BundleFault {
  const row = ticket as QueueTicket & { urgent?: boolean | null }
  return {
    id: ticket.id,
    storeId: ticket.store_id || '',
    storeName: ticket.stores?.name || ticket.stores?.code || 'סניף',
    category: ticket.category || 'other',
    priority: ticket.priority,
    status: ticket.status,
    summary: ticket.description,
    createdAt: ticket.created_at,
    slaResolveBy: ticket.sla_resolve_by,
    resolvedAt: ticket.resolved_at,
    firstResponseAt: ticket.first_response_at,
    regionId: ticket.region_id ?? null,
    urgent: row.urgent,
    dispatched: ticket.status === 'waiting_vendor',
  }
}

function technicianName(
  id: string | null | undefined,
  techs: { id: string; name: string }[],
  locale: 'he' | 'en' | 'fr',
): string {
  if (!id) return phrase(locale, 'לא משויך')
  return techs.find((t) => t.id === id)?.name ?? phrase(locale, 'טכנאי')
}

function resolveTabView(view: QueueView): QueueView {
  if (TAB_VIEWS.has(view)) return view
  return 'open'
}

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sp = await searchParams
  const parsed = parseQueueParams(sp)
  const view = resolveTabView(parsed.view)
  const page = Math.max(1, Number(sp.page ?? '1') || 1)
  const storeCode = parsed.store || (sp.store ?? '').trim() || undefined
  const q = parsed.q || (sp.q ?? '').trim() || undefined

  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) {
    redirect('/login')
  }
  await hydrateOpsLedger()
  const locale = await getLocale()

  const resolved = await resolveTicketsSupabase(actor)

  const statuses =
    view === 'resolved'
      ? ['resolved', 'closed']
      : [...OPEN_TICKET_STATUSES]

  const [ticketResult, historyResult, techRows, storesResult, vendorsResult] =
    await Promise.all([
      listTickets({
        limit: FETCH_LIMIT,
        storeCode,
        statuses,
        q,
        client: resolved?.client,
      }).catch((err) => ({
        tickets: [] as Awaited<ReturnType<typeof listTickets>>['tickets'],
        backend: 'supabase' as const,
        error: err instanceof Error ? err.message : 'שגיאה בטעינת תקלות',
      })),
      view === 'resolved'
        ? Promise.resolve({
            tickets: [] as Awaited<ReturnType<typeof listTickets>>['tickets'],
          })
        : listTickets({
            limit: 80,
            storeCode,
            statuses: ['resolved', 'closed'],
            client: resolved?.client,
          }).catch(() => ({
            tickets: [] as Awaited<ReturnType<typeof listTickets>>['tickets'],
          })),
      listInternalTechnicians().catch(() => []),
      listStores().catch(() => ({ stores: [], backend: 'memory' as const })),
      listVendors().catch(() => ({ vendors: [], backend: 'memory' as const })),
    ])

  const fetched = (ticketResult.tickets ?? []) as unknown as QueueTicket[]
  const all = actor ? scopeTicketsForActor(actor, fetched) : fetched
  const technicians = techRows.map((t) => ({
    id: t.id,
    name: t.full_name || t.email || t.id.slice(0, 8),
  }))
  const canEditStores = Boolean(
    actor?.memberships.some(
      (m) => m.role === 'global_admin' || m.role === 'country_manager',
    ),
  )
  const canOverrideResolve = Boolean(
    actor?.memberships.some(
      (m) => m.role === 'global_maintenance' || m.role === 'global_admin',
    ),
  )
  const canDispatchVisit = Boolean(
    actor?.memberships.some((m) =>
      ['global_admin', 'global_maintenance', 'country_manager'].includes(m.role),
    ),
  )
  const listError =
    'error' in ticketResult && ticketResult.error
      ? String(ticketResult.error)
      : null

  const queueFilters = {
    ...parsed,
    view,
    sort: 'newest' as const,
    store: storeCode,
    includeDemo: false,
    q,
  }

  const filtered = applyQueue(all, queueFilters)

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, totalPages)
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const pros =
    view === 'resolved'
      ? { professionals: [] as Awaited<ReturnType<typeof listProfessionals>>['professionals'] }
      : await listProfessionals({ limit: 80 }).catch(() => ({
          professionals: [],
          backend: 'memory' as const,
        }))
  const storeCodes: Record<string, string> = {}
  for (const ticket of view === 'resolved' ? rows : filtered) {
    if (ticket.store_id && ticket.stores?.code) {
      storeCodes[ticket.store_id] = ticket.stores.code
    }
  }
  const historyTickets = actor
    ? scopeTicketsForActor(
        actor,
        (historyResult.tickets ?? []) as unknown as QueueTicket[],
      )
    : ((historyResult.tickets ?? []) as unknown as QueueTicket[])
  const openForBundles =
    view === 'resolved'
      ? []
      : (filtered as QueueTicket[]).map(toFault)
  const rawBundles =
    view === 'resolved'
      ? []
      : recommendBundles({
          open: openForBundles,
          history: historyTickets.map(toFault),
          outcomes: listOutcomes(),
          professionals: pros.professionals.map((pro) => ({
            id: pro.id,
            full_name: pro.full_name,
            phone: pro.phone,
            trade: pro.trade,
            notes: pro.notes,
            use_count: pro.use_count,
          })),
        })
  const bundleCards = presentRecommendations(rawBundles, storeCodes)
  const companionIdsByTicket = sameStoreCompanionIds(
    rawBundles,
    new Map(
      (view === 'resolved' ? rows : filtered).map((ticket) => [
        ticket.id,
        ticket.store_id || '',
      ]),
    ),
  )

  const baseHref = queueHref(queueFilters)

  const viewCountLabel =
    view === 'urgent'
      ? 'דחופות'
      : view === 'attention'
        ? 'דורשות תשומת לב'
        : view === 'stuck'
          ? 'תקועות'
          : null
  const statusLine =
    view === 'resolved'
      ? filtered.length === 0
        ? translate(locale, 'tickets.noneResolved')
        : translate(locale, 'tickets.resolved', { count: filtered.length })
      : filtered.length === 0
        ? translate(locale, 'tickets.noneOpen')
        : viewCountLabel
          ? `${filtered.length} ${viewCountLabel}`
          : translate(locale, 'tickets.open', { count: filtered.length })

  const storeOptions = storesResult.stores.map((s) => ({
    code: s.code,
    name: s.name,
  }))
  const focusedStore = storeCode
    ? storesResult.stores.find(
        (s) => s.code === storeCode || s.code === storeCode.replace(/^0+/, ''),
      ) ??
      storesResult.stores.find(
        (s) => s.code.replace(/^0+/, '') === storeCode.replace(/^0+/, ''),
      )
    : null
  const vendorOptions = (vendorsResult.vendors ?? [])
    .filter((v) => v.active !== false)
    .map((v) => ({
      id: v.id,
      name: v.name,
      specialties: v.specialties,
      coverage: v.coverage_regions,
      phone: v.contact_phone,
    }))

  return (
    <OpsAppShell>
      <div className="ari-home flex flex-col gap-3">
        <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <h1 className="t-title text-ink">{translate(locale, 'tickets.title')}</h1>
            <p className="t-meta mt-1 text-ink-2">{statusLine}</p>
          </div>
          {canEditStores ? (
            focusedStore ? (
              <StoreCreateForm
                triggerLabel="עריכת סניף"
                triggerVariant="secondary"
                triggerSize="sm"
                store={{
                  id: focusedStore.id,
                  code: focusedStore.code,
                  name: focusedStore.name,
                  city: focusedStore.city,
                  address: focusedStore.address,
                  region_id: focusedStore.region_id,
                  area_manager: focusedStore.area_manager,
                  manager_name: focusedStore.manager_name,
                  manager_phone: focusedStore.manager_phone,
                }}
              />
            ) : (
              <StoreCreateForm
                triggerLabel="הוספת סניף"
                triggerVariant="secondary"
                triggerSize="sm"
              />
            )
          ) : null}
        </header>

        <div className="sticky top-0 z-20 flex flex-col gap-3 bg-[var(--canvas)] py-2">
          <div className="flex min-w-0 max-w-full flex-col gap-3 lg:flex-row lg:items-end lg:gap-4">
            <div className="min-w-0 flex-1">
              <Suspense fallback={null}>
                <TicketSearch initialQ={q ?? ''} />
              </Suspense>
            </div>
            <Suspense fallback={null}>
              <TicketFilters stores={storeOptions} />
            </Suspense>
          </div>
          <p className="t-caption hidden text-ink-3 md:block">
            <Tx text="מיון: מהחדש לישן" />
            {canDispatchVisit && view !== 'resolved' ? (
              <>
                {' · '}
                <Tx text="סננו חנות ואז סמנו תקלות לביקור משולב" />
              </>
            ) : null}
          </p>
        </div>

        {listError ? (
          <ErrorState
            title="שגיאה בטעינה"
            description={listError}
            action={
              <Button asChild variant="secondary" size="sm">
                <Link href="/ops/tickets">
                  <Tx text="רענון" />
                </Link>
              </Button>
            }
          />
        ) : null}

        {canDispatchVisit && view !== 'resolved' ? (
          <VisitQueueShell
            tickets={rows.map((t) => ({
              id: t.id,
              storeCode: t.stores?.code ?? '',
              storeId: t.store_id ?? '',
              label:
                t.display_number ||
                (t.number != null ? `OC-${t.number}` : t.id.slice(0, 8)),
              title: t.title || t.description,
              spendBlock: executionBlockReason(spendForTicket(t.id)),
              category: t.category,
              city: t.stores?.city ?? null,
              region: t.region_id,
            }))}
            vendors={vendorOptions}
            professionals={pros.professionals.map((person) => ({
              id: person.id,
              full_name: person.full_name,
              phone: person.phone,
              trade: person.trade,
            }))}
            storeFilter={storeCode}
            companionIdsByTicket={companionIdsByTicket}
          >
            <Panel flush elevated className="overflow-hidden">
              {rows.length === 0 ? (
                <EmptyState
                  title="אין תקלות פתוחות"
                  description="כשתדווח תקלה חדשה — היא תופיע כאן."
                  icon={PartyPopper}
                />
              ) : (
                <TicketStoreGroups
                  rows={rows}
                  cards={bundleCards}
                  renderRow={(t) => (
                    <TicketQueueItem
                      key={t.id}
                      ticket={t}
                      view="open"
                      assigneeLabel={technicianName(
                        t.assigned_to,
                        technicians,
                        locale,
                      )}
                      selectable
                      canOverrideResolve={canOverrideResolve}
                    />
                  )}
                />
              )}
            </Panel>
          </VisitQueueShell>
        ) : (
          <Panel flush elevated className="overflow-hidden">
            {rows.length === 0 ? (
              <EmptyState
                title={
                  view === 'resolved'
                    ? 'אין תקלות שהסתיימו עדיין'
                    : 'אין תקלות פתוחות'
                }
                description={
                  view === 'open'
                    ? 'כשתדווח תקלה חדשה — היא תופיע כאן.'
                    : undefined
                }
                icon={PartyPopper}
              />
            ) : (
              <TicketStoreGroups
                rows={rows}
                cards={bundleCards}
                renderRow={(t) => (
                  <TicketQueueItem
                    key={t.id}
                    ticket={t}
                    view={view === 'resolved' ? 'resolved' : 'open'}
                    assigneeLabel={technicianName(
                      t.assigned_to,
                      technicians,
                      locale,
                    )}
                    canOverrideResolve={canOverrideResolve}
                  />
                )}
              />
            )}
          </Panel>
        )}

        {totalPages > 1 ? (
          <nav className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <p className="t-meta t-num text-ink-3">
              {(current - 1) * PAGE_SIZE + 1}–
              {Math.min(current * PAGE_SIZE, filtered.length)} מתוך{' '}
              {filtered.length}
            </p>
            <div className="flex gap-2">
              <Button
                asChild
                variant="secondary"
                size="sm"
                className={current <= 1 ? 'pointer-events-none opacity-40' : ''}
              >
                <Link
                  href={`${baseHref}${baseHref.includes('?') ? '&' : '?'}page=${current - 1}`}
                >
                  הקודם
                </Link>
              </Button>
              <Button
                asChild
                variant="secondary"
                size="sm"
                className={
                  current >= totalPages ? 'pointer-events-none opacity-40' : ''
                }
              >
                <Link
                  href={`${baseHref}${baseHref.includes('?') ? '&' : '?'}page=${current + 1}`}
                >
                  הבא
                </Link>
              </Button>
            </div>
          </nav>
        ) : null}
      </div>
    </OpsAppShell>
  )
}
