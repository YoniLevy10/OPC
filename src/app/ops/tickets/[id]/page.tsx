import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { PageToolbar } from '@/components/layout/page-toolbar'
import {
  Panel,
  KeyValue,
} from '@/components/ui/primitives'
import { OpsPageHero } from '@/components/ops/ops-page-hero'
import { Button } from '@/components/ui/button'
import { StatusLabel } from '@/components/ui/signal'
import { EvidenceGrid } from '@/components/ui/evidence'
import {
  normalizeTicketCategory,
  OPEN_TICKET_STATUSES,
  TICKET_CATEGORY_LABELS_HE,
  type TicketPriority,
  type TicketStatus,
} from '@/modules/tickets/constants'
import { getById } from '@/modules/tickets/service'
import {
  fetchTicketAttachments,
  mergeEvidence,
} from '@/modules/tickets/attachments'
import { EngagementPanel } from './engagement-panel'
import { TicketDeleteButton } from '../ticket-delete-button'
import { Tx } from '@/components/i18n/tx'
import { Timeline } from '@/components/ui/timeline'
import { buildActivityDesc } from '@/modules/tickets/activity'
import { phrase } from '@/lib/i18n/phrases'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { actorCanAccessTicket } from '@/lib/auth/ticket-scope'
import { resolveTicketsSupabase } from '@/lib/supabase/tickets-client'
import {
  plainAgoHe,
  plainOpenForHe,
} from '@/components/ops/plain-labels'
import { cn } from '@/lib/utils'
import { listTickets } from '@/modules/tickets/service'
import {
  findRecurrences,
  recurrenceBasis,
  recurrenceTicketLabel,
  suggestPrevention,
} from '@/modules/tickets/recurrence'
import { getLocale } from '@/lib/i18n/server'
import { translate, type MessageKey } from '@/lib/i18n/messages'
import { TicketTrueCostPanel } from './ticket-true-cost'
import {
  listOutcomes,
  listSpends,
  spendForTicket,
  spendsForAsset,
  spendsForTicket,
} from '@/lib/data/ops-ledger'
import { formatIls, trueCostBreakdown } from '@/modules/spend/true-cost'
import { serviceCallRecord } from '@/modules/tickets/call-record'
import {
  bandFromPrices,
  categorySamples,
  estimateFaultCost,
  formatCostBand,
} from '@/modules/recommendations/estimate'
import { PhoneFold as TicketFold, PhoneFoldStack as TicketFoldStack } from '@/components/layout/phone-fold'
import { formatQualityHoldHe, isQualityHoldActive } from '@/modules/tickets/quality-hold'
import { formatRepairEtaHe } from '@/modules/tickets/repair-eta'
import { ticketDecision } from '@/modules/decisions/queue'
import { lockedEngagementFor } from '@/modules/engagements/service'
import { listProfessionals } from '@/modules/professionals/service'
import { loadMidragResults } from '@/modules/vendors/midrag/live-results'
import { recommendBundles, type BundleFault } from '@/modules/whatsapp/agent/bundle'
import { ticketIsUrgent } from '@/modules/tickets/urgent'
import { listVendors } from '@/modules/vendors/service'
import { StoreVisitDispatch } from '@/app/ops/stores/[code]/store-visit-dispatch'
import { executionBlockReason } from '@/modules/spend/policy'

export const dynamic = 'force-dynamic'

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) {
    redirect('/login')
  }

  const resolvedClient = await resolveTicketsSupabase(actor)

  const [ticket, storedAttachments] = await Promise.all([
    getById(id, { client: resolvedClient?.client }).catch(() => null),
    fetchTicketAttachments(id).catch(() => []),
  ])

  if (!ticket) notFound()
  if (actor && !actorCanAccessTicket(actor, ticket)) notFound()

  const attachments = mergeEvidence(storedAttachments, ticket.messages ?? [])
  const locale = await getLocale()
  const p = (text: string, vars?: Record<string, string | number>) =>
    phrase(locale, text, vars)
  const openFor = plainOpenForHe(ticket.created_at, ticket, new Date(), locale)
  const decision = ticketDecision(ticket, new Date(), locale)
  const openTicket = !['resolved', 'closed', 'cancelled'].includes(ticket.status)
  const verbRaw = decision
    ? decision.action.split('·')[0]?.trim()
    : openTicket
      ? 'לטפל'
      : null
  const verb = verbRaw ? p(verbRaw) : null
  const storeName = ticket.stores?.name?.trim() || p('חנות')
  const storeCode = ticket.stores?.code?.trim()
  const whatsBroken = ticket.description || ticket.title || p('ללא תיאור')
  const { phonesMatch } = await import('@/modules/whatsapp/classify')
  const storeManager =
    ticket.stores?.manager_phone &&
    ticket.reporter_phone &&
    phonesMatch(ticket.reporter_phone, ticket.stores.manager_phone)
      ? ticket.stores.manager_name?.trim() || null
      : null
  const reporter =
    ticket.reporter_name?.trim() ||
    storeManager ||
    ticket.reporter_phone?.trim() ||
    p('דיווח מהחנות')

  const history = await listTickets({ limit: 200 }).catch(() => ({ tickets: [] }))
  const hits = findRecurrences(
    {
      id: ticket.id,
      storeId: ticket.store_id,
      category: ticket.category,
      description: ticket.description,
      status: ticket.status,
      createdAt: ticket.created_at,
      assetId: ticket.asset_id ?? null,
    },
    (history.tickets ?? []).map((row) => ({
      id: row.id,
      storeId: row.store_id,
      category: row.category,
      description: row.description,
      status: row.status,
      createdAt: row.created_at,
      assetId: row.asset_id ?? null,
      resolutionNote: null,
      displayNumber:
        row.display_number?.trim() ||
        (row.number != null ? `OC-${row.number}` : null),
    })),
  )
  const ticketSpends = spendsForTicket(ticket.id)
  const assetSpends = ticket.asset_id ? spendsForAsset(ticket.asset_id) : []
  const holdLabel = formatQualityHoldHe(ticket.quality_hold_until)
  const holdActive =
    ticket.status === 'resolved' && isQualityHoldActive(ticket.quality_hold_until)
  const etaLabel = formatRepairEtaHe(ticket.repair_eta_at)
  const prevention = suggestPrevention(hits)
  const urgent = ticketIsUrgent(ticket)
  const locked = await lockedEngagementFor(ticket.id).catch(() => null)
  const canDispatch = openTicket && ticket.status !== 'engaged'
  const needsStoreDispatchPros = ticket.status === 'engaged'
  const [bookPros, midrag, vendorsResult] = await Promise.all([
    canDispatch || needsStoreDispatchPros
      ? listProfessionals({ limit: 24 })
          .then((r) => r.professionals.filter((pro) => Boolean(pro.phone)))
          .catch(() => [])
      : Promise.resolve([]),
    canDispatch
      ? loadMidragResults({
          category: ticket.category,
          city: ticket.stores?.city ?? null,
        }).catch(() => null)
      : Promise.resolve(null),
    listVendors({ activeOnly: true }).catch(() => ({ vendors: [] as Array<{
      id: string
      name: string
      specialties?: string
      coverage_regions?: string[] | null
      contact_phone?: string | null
    }> })),
  ])
  const sameStoreOpen = (history.tickets ?? []).filter(
    (row) =>
      row.id !== ticket.id &&
      Boolean(ticket.store_id) &&
      row.store_id === ticket.store_id &&
      OPEN_TICKET_STATUSES.includes(row.status as (typeof OPEN_TICKET_STATUSES)[number]) &&
      row.status !== 'engaged',
  )
  const openForBundle = sameStoreOpen
  const bundleCards = recommendBundles({
    open: [
      {
        id: ticket.id,
        storeId: ticket.store_id,
        storeName,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        summary: ticket.description,
        createdAt: ticket.created_at,
        regionId: ticket.region_id,
        urgent,
      },
      ...openForBundle.map(
        (row): BundleFault => ({
          id: row.id,
          storeId: row.store_id,
          storeName: row.stores?.name || row.stores?.code || 'סניף',
          category: row.category,
          priority: row.priority,
          status: row.status,
          summary: row.title || row.description,
          createdAt: row.created_at,
          regionId: row.region_id,
          urgent: ticketIsUrgent(row),
        }),
      ),
    ],
  })
  const suggestedCompanionIds = new Set(
    bundleCards.find((card) => card.ticketIds[0] === ticket.id)?.ticketIds.slice(1) ??
      [],
  )
  const companions = sameStoreOpen.map((row) => ({
    id: row.id,
    storeName: row.stores?.name || storeName,
    summary: row.title || row.description || 'תקלה',
    label:
      row.display_number?.trim() ||
      (row.number != null ? `OC-${row.number}` : row.id.slice(0, 8)),
    suggested: suggestedCompanionIds.has(row.id),
  }))
  const storeDispatchTickets = [
    ...(canDispatch
      ? [
          {
            id: ticket.id,
            label:
              ticket.display_number?.trim() ||
              (ticket.number != null ? `OC-${ticket.number}` : ticket.id.slice(0, 8)),
            title: ticket.title || ticket.description,
            spendBlock: executionBlockReason(spendForTicket(ticket.id)),
            category: ticket.category,
            status: ticket.status,
          },
        ]
      : []),
    ...sameStoreOpen.map((row) => ({
      id: row.id,
      label:
        row.display_number?.trim() ||
        (row.number != null ? `OC-${row.number}` : row.id.slice(0, 8)),
      title: row.title || row.description,
      spendBlock: executionBlockReason(spendForTicket(row.id)),
      category: row.category,
      status: row.status,
    })),
  ]
  const tx = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(locale, key, vars)
  const categoryKey = `category.${ticket.category}` as MessageKey
  const knownCategory = [
    'hvac',
    'electrical',
    'electrical_hazard',
    'plumbing',
    'security',
    'it',
    'cleaning',
    'other',
  ].includes(ticket.category)
  const categoryLabel = knownCategory
    ? tx(categoryKey)
    : (TICKET_CATEGORY_LABELS_HE[ticket.category] ?? ticket.category)
  const priority = ticket.priority as TicketPriority
  const categoryByTicketId: Record<string, string> = {}
  for (const row of history.tickets ?? []) {
    if (row.category) categoryByTicketId[row.id] = row.category
  }
  categoryByTicketId[ticket.id] = ticket.category
  const recordedBand = bandFromPrices(
    categorySamples({
      outcomes: listOutcomes(),
      spends: listSpends(),
      categoryByTicketId,
    }).get(normalizeTicketCategory(ticket.category)) ?? [],
  )
  const faultEstimate = estimateFaultCost(ticket.category, recordedBand)

  const storyLines: string[] = [`${p('נפתחה על ידי')} ${reporter}`]
  if (ticket.status === 'resolved' || ticket.status === 'closed') {
    storyLines.push(p('הסתיימה'))
  }

  const treatmentSummary = (() => {
    const events = ticket.events ?? []
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const e = events[i]
      if (e.event_type !== 'tech_note') continue
      const payload = (e.payload ?? {}) as {
        resolution_note?: string
        note?: string
        to_status?: string
      }
      const text = (payload.resolution_note ?? payload.note)?.trim()
      if (text && (payload.to_status === 'resolved' || payload.resolution_note)) {
        return text
      }
    }
    return null
  })()

  const activity = buildActivityDesc(ticket.messages ?? [], ticket.events ?? [])
  const latest = activity[0]
  const latestSummary = latest
    ? [latest.label, latest.body?.trim()].filter(Boolean).join(' · ')
    : p('אין פעילות')
  const cost = trueCostBreakdown(ticketSpends)
  const estimateText = formatCostBand(faultEstimate.band, locale)
  const costSummary =
    cost.count === 0 ? p('משוער {range}', { range: estimateText }) : formatIls(cost.total)
  const stepLabel =
    ticket.status === 'engaged'
      ? p('נשלח איש מקצוע לתיקון')
      : urgent
        ? p('מחכה לאישור')
        : p('לא דחוף')
  const call = serviceCallRecord({
    store: storeName,
    type: categoryLabel,
    urgent,
    openedAt: ticket.created_at,
    events: ticket.events ?? [],
    professional: locked?.professionalName,
    phone: locked?.professionalPhone,
    approvedPrice: locked?.approvedAmount,
    closedAt: ticket.closed_at,
    storeConfirmedAt: ticket.store_confirmed_at,
  })

  return (
    <OpsAppShell>
      <div className="ari-home mx-auto flex min-w-0 w-full max-w-2xl flex-col gap-3 overflow-x-clip phone-pad-tab phone-pad-dock md:max-w-4xl md:gap-5 md:!pb-0">
        <PageToolbar backHref="/ops/tickets" backLabel={p('חזרה')} showRefresh />

        <OpsPageHero
          compact
          eyebrow={
            [
              ticket.display_number ||
                (ticket.number != null ? `OC-${ticket.number}` : ticket.id.slice(0, 8)),
              storeCode,
            ]
              .filter(Boolean)
              .join(' · ')
          }
          title={storeName}
          status={whatsBroken}
          footer={
            <>
              <StatusLabel status={ticket.status as TicketStatus} />
              <span
                className={cn(
                  't-body',
                  openFor.overdue
                    ? 'text-[var(--signal-critical)]'
                    : 'text-ink-2',
                )}
              >
                {ticket.status === 'resolved'
                  ? p('ממתינה לאישור חנות')
                  : openFor.text}
              </span>
            </>
          }
        />

        {verb === p('לאשר') ? (
          <div className="hidden items-center justify-end px-1 md:flex">
            <Button asChild variant="primary" size="sm">
              <Link href="#ticket-actions">{p('לאשר')}</Link>
            </Button>
          </div>
        ) : null}

        <Panel elevated className="max-md:p-3">
          <dl className="grid grid-cols-2 gap-2 md:block md:divide-y md:divide-border max-md:[&>*:last-child:nth-child(odd)]:col-span-2">
            <KeyValue phoneTile label={tx('ticket.opened')}>
              {plainAgoHe(ticket.created_at, new Date(), locale)}
            </KeyValue>
            <KeyValue phoneTile label={tx('ticket.urgency')}>
              {tx(`priority.${priority}`)}
            </KeyValue>
            <KeyValue phoneTile label={p('השלב')}>
              {stepLabel}
            </KeyValue>
            <KeyValue phoneTile label={tx('ticket.category')}>
              {categoryLabel}
            </KeyValue>
            <KeyValue phoneTile label={p('ביקורים')}>
              {call.visits}
            </KeyValue>
            <KeyValue phoneTile label={p('בעל מקצוע')}>
              {call.professional ?? p('אחרי השיחה')}
            </KeyValue>
            <KeyValue phoneTile label={p('טלפון')}>
              {call.phone ?? '—'}
            </KeyValue>
            <KeyValue phoneTile label={p('מחיר שאושר')}>
              {call.approvedPrice != null ? formatIls(call.approvedPrice) : '—'}
            </KeyValue>
            <KeyValue phoneTile label={p('אופן סגירה')}>
              {call.closeMethod}
            </KeyValue>
            <KeyValue phoneTile label={p('אישור חנות')}>
              {call.storeApproved ? p('אושר') : p('ממתין')}
            </KeyValue>
            {call.decisions.length > 0 ? (
              <KeyValue phoneTile label={p('החלטות')}>
                {call.decisions.join(' · ')}
              </KeyValue>
            ) : null}
            {etaLabel ? (
              <KeyValue phoneTile label={tx('ticket.eta')}>{etaLabel}</KeyValue>
            ) : null}
            {holdLabel && (holdActive || ticket.status === 'resolved') ? (
              <KeyValue phoneTile label={tx('ticket.qualityHold')}>{holdLabel}</KeyValue>
            ) : null}
          </dl>
        </Panel>

        {treatmentSummary ? (
          <p className="t-body px-1 text-ink-2">{treatmentSummary}</p>
        ) : null}

        <TicketFoldStack>
          <TicketFold title={tx('ticket.trueCost')} summary={costSummary}>
            <TicketTrueCostPanel
              ticketSpends={ticketSpends}
              assetSpends={assetSpends}
              locale={locale}
              estimate={{ text: estimateText, basis: faultEstimate.basis }}
            />
          </TicketFold>

          <TicketFold title={p('מה קרה עד עכשיו')} summary={latestSummary}>
            <Panel elevated flush className="overflow-hidden">
              {hits.length > 0 ? (
                <div className="border-b border-border px-5 py-3">
                  <p className="t-body-strong text-ink">
                    <Tx text="אירועים דומים" />
                  </p>
                  <p className="t-meta mt-1 text-ink-2">{recurrenceBasis(hits)}</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {hits.slice(0, 6).map((hit) => (
                      <li key={hit.ticket.id}>
                        <Link
                          href={`/ops/tickets/${hit.ticket.id}`}
                          className="t-meta inline-flex min-h-8 items-center rounded-[var(--radius-sm)] border border-border bg-canvas px-2.5 text-ink transition-colors hover:border-[var(--tenant)] hover:text-[var(--tenant)]"
                        >
                          {recurrenceTicketLabel(hit.ticket)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {prevention ? <p className="t-body mt-2 text-ink">{prevention}</p> : null}
                </div>
              ) : null}
              <div className="border-b border-border px-5 py-3">
                <p className="t-section text-ink">
                  <Tx text="מה קרה עד עכשיו" />
                </p>
                {storyLines.length > 0 ? (
                  <p className="t-caption mt-1 text-ink-3">
                    {storyLines.join(' · ')}
                  </p>
                ) : null}
              </div>
              <Timeline items={activity} />
            </Panel>
          </TicketFold>

          {attachments.length > 0 ? (
            <TicketFold title={p('תיעוד')} summary={p(`${attachments.length} קבצים`)}>
              <Panel elevated>
                <p className="t-section mb-3 text-ink">
                  <Tx text="תיעוד" />
                </p>
                <EvidenceGrid attachments={attachments} />
              </Panel>
            </TicketFold>
          ) : null}
        </TicketFoldStack>

        <div id="ticket-actions" className="grid gap-3">
          <EngagementPanel
            ticketId={ticket.id}
            urgent={urgent}
            status={ticket.status}
            locked={locked}
            book={bookPros}
            pros={midrag?.pros ?? []}
            searchUrl={midrag?.searchUrl ?? 'https://www.midrag.co.il/Search/InSector'}
            fallback={midrag?.fallback ?? true}
            reason={midrag?.reason}
            stale={midrag?.stale}
            companions={companions}
            category={ticket.category || 'other'}
            city={ticket.stores?.city ?? null}
          />
          {ticket.store_id &&
          ticket.status === 'engaged' &&
          storeDispatchTickets.length > 0 ? (
            <StoreVisitDispatch
              storeId={ticket.store_id}
              storeCode={storeCode || ticket.stores?.code || ''}
              city={ticket.stores?.city ?? null}
              region={ticket.region_id}
              tickets={storeDispatchTickets}
              initialSelectedIds={storeDispatchTickets.map((t) => t.id)}
              vendors={(vendorsResult.vendors ?? []).map((v) => ({
                id: v.id,
                name: v.name,
                specialties: v.specialties,
                coverage: v.coverage_regions,
                phone: v.contact_phone,
              }))}
              professionals={bookPros.map((person) => ({
                id: person.id,
                full_name: person.full_name,
                phone: person.phone,
                trade: person.trade,
              }))}
            />
          ) : null}
        </div>

        <div className="flex justify-end px-1 pb-2">
          <TicketDeleteButton
            ticketId={ticket.id}
            label={
              ticket.display_number ||
              (ticket.number != null ? `OC-${ticket.number}` : ticket.id.slice(0, 8))
            }
            variant="critical"
          />
        </div>
      </div>
    </OpsAppShell>
  )
}
