import { notFound, redirect } from 'next/navigation'
import { AlertTriangle, MapPin, Navigation } from 'lucide-react'
import { TechShell } from '@/components/layout/tech-shell'
import { RefreshButton } from '@/components/layout/refresh-button'
import { techHref } from '@/lib/tech-href'
import { TechTicketActions } from '@/app/tech/[ticketId]/tech-ticket-actions'
import { Panel, ErrorState, EmptyState, KeyValue } from '@/components/ui/primitives'
import { StatusLabel } from '@/components/ui/signal'
import { EvidenceGrid } from '@/components/ui/evidence'
import { PhoneCallLink } from '@/components/ui/phone-call-link'
import { OpsPageHero } from '@/components/ops/ops-page-hero'
import type { TicketStatus } from '@/modules/tickets/constants'
import { TICKET_CATEGORY_LABELS_HE } from '@/modules/tickets/constants'
import { fetchTechTicket, isTicketRef, snippet } from '@/modules/tickets/tech'
import { getById } from '@/modules/tickets/service'
import { fetchTicketAttachments, mergeEvidence } from '@/modules/tickets/attachments'
import {
  getServerActor,
  resolveServerTechId,
} from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { actorFromProfileId } from '@/lib/auth/load-memberships'
import { actorIsTech, testAuthAllowed } from '@/lib/auth/types'
import {
  actorCanAccessTicket,
  actorCanOpenTechTicket,
} from '@/lib/auth/ticket-scope'
import { storeLabel } from '@/components/ops/plain-labels'
import { TECH_COMPLETION } from '@/modules/tech/completion-copy'
import { PhoneFold, PhoneFoldStack } from '@/components/layout/phone-fold'

export const dynamic = 'force-dynamic'

function treatmentFromEvents(
  events: { event_type: string; payload: unknown }[] | undefined,
): string | null {
  if (!events?.length) return null
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
}

function mapsHref(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

export default async function TechTicketDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticketId: string }>
  searchParams: Promise<{ techId?: string }>
}) {
  const { ticketId } = await params
  const sp = await searchParams

  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) {
    redirect('/login')
  }

  const techId = resolveServerTechId(actor, sp.techId ?? null)

  if (!isTicketRef(ticketId)) notFound()

  const { ticket, error } = await fetchTechTicket(ticketId)

  if (!ticket) {
    if (error) {
      return (
        <TechShell
          title="עבודה"
          backHref={techHref('/tech', techId)}
          enablePullToRefresh
          headerActions={<RefreshButton label="רענון" />}
        >
          <ErrorState
            title="לא ניתן לטעון את העבודה"
            description="בדקו חיבור לרשת ונסו שוב."
            action={<RefreshButton label="רענון" />}
          />
        </TechShell>
      )
    }
    notFound()
  }

  const full = (await getById(ticketId).catch(() => null)) ?? ticket
  let techScope = actor && actorIsTech(actor) ? actor : null
  if (!techScope && techId && (testAuthAllowed() || shouldAllowDemoEntry())) {
    techScope = await actorFromProfileId(techId, 'test_bearer')
  }
  const openedByTech = techScope
    ? actorCanOpenTechTicket(techScope, full)
    : false
  const openedByHq = actor ? actorCanAccessTicket(actor, full) : false
  if (!openedByTech && !openedByHq && !(!actor && shouldAllowDemoEntry())) {
    return (
      <TechShell
        title="עבודה"
        backHref={techHref('/tech', techId)}
        enablePullToRefresh
        headerActions={<RefreshButton label="רענון" />}
      >
        <ErrorState
          title="אין הרשאה לעבודה זו"
          description="העבודה משויכת לטכנאי אחר, או שאין לכם גישה."
          action={<RefreshButton label="רענון" />}
        />
      </TechShell>
    )
  }

  const fullTicket = await getById(ticketId).catch(() => null)
  const storedAttachments = await fetchTicketAttachments(ticketId).catch(() => [])
  const attachments = mergeEvidence(
    [...(ticket.attachments ?? []), ...storedAttachments],
    fullTicket?.messages ?? [],
  )
  const address = [ticket.stores?.address, ticket.stores?.city]
    .filter(Boolean)
    .join(', ')
  const treatment = treatmentFromEvents(fullTicket?.events)
  const num =
    ticket.display_number ||
    (ticket.number != null ? `OC-${ticket.number}` : null)
  const storeName = storeLabel(ticket.stores)
  const description = ticket.description || ticket.title || 'ללא תיאור'
  const categoryLabel =
    TICKET_CATEGORY_LABELS_HE[
      ticket.category as keyof typeof TICKET_CATEGORY_LABELS_HE
    ] ?? ticket.category
  const managerPhone = ticket.stores?.manager_phone?.trim() || null
  const managerName = ticket.stores?.manager_name?.trim() || null
  const isCritical = ticket.priority === 'critical'

  return (
    <TechShell
      title={storeName}
      backHref={techHref('/tech', techId)}
      enablePullToRefresh
      headerActions={<RefreshButton label="רענון" />}
      actions={
        <TechTicketActions
          ticketId={ticket.id}
          techId={techId}
          status={ticket.status}
          assignedTo={ticket.assigned_to}
        />
      }
    >
      <div className="flex flex-col gap-5">
        <OpsPageHero
          eyebrow={num ?? 'עבודה'}
          title={storeName}
          status={snippet(description, 120)}
          footer={
            <div className="flex flex-wrap items-center gap-2">
              <StatusLabel status={ticket.status as TicketStatus} />
              {isCritical ? (
                <span className="inline-flex items-center gap-1 text-[var(--signal-critical)]">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  <span className="t-caption font-medium">דחוף</span>
                </span>
              ) : null}
            </div>
          }
        />

        <Panel elevated>
          <p className="t-lead whitespace-pre-wrap leading-relaxed text-ink">
            {description}
          </p>
          <dl className="mt-4 divide-y divide-border">
            <KeyValue label="סוג">{categoryLabel}</KeyValue>
            {ticket.stores?.code ? (
              <KeyValue label="סניף">#{ticket.stores.code}</KeyValue>
            ) : null}
          </dl>
        </Panel>

        {address || managerPhone ? (
          <Panel elevated>
            <p className="t-section text-ink">שטח</p>
            {address ? (
              <p className="t-body mt-3 flex items-start gap-2 text-ink-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{address}</span>
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              {address ? (
                <a
                  href={mapsHref(address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="t-control inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface px-3 text-ink transition-colors hover:bg-surface-sunken"
                >
                  <Navigation className="h-3.5 w-3.5 text-[var(--tenant)]" aria-hidden />
                  ניווט
                </a>
              ) : null}
              {managerPhone ? (
                <PhoneCallLink
                  phone={managerPhone}
                  label={managerName ? `חיוג · ${managerName}` : 'חיוג למנהל'}
                />
              ) : null}
            </div>
          </Panel>
        ) : null}

        <PhoneFoldStack>
          {treatment ? (
            <PhoneFold title={TECH_COMPLETION.treatmentLabel} summary="יומן">
              <Panel elevated>
                <p className="t-section mb-2 text-ink">
                  {TECH_COMPLETION.treatmentLabel}
                </p>
                <p className="t-body whitespace-pre-wrap text-ink-2">{treatment}</p>
              </Panel>
            </PhoneFold>
          ) : null}

          {attachments.length > 0 ? (
            <PhoneFold title="תיעוד" summary={`${attachments.length}`}>
              <Panel elevated>
                <p className="t-section mb-3 text-ink">תיעוד</p>
                <EvidenceGrid attachments={attachments} />
              </Panel>
            </PhoneFold>
          ) : ticket.status === 'in_progress' ? (
            <PhoneFold title="תיעוד" summary="עדיין אין">
              <Panel elevated>
                <EmptyState
                  title="עדיין אין הוכחת ביצוע"
                  description="בסיום — צרפו תמונה או וידאו יחד עם סיכום הטיפול."
                />
              </Panel>
            </PhoneFold>
          ) : null}
        </PhoneFoldStack>
      </div>
    </TechShell>
  )
}
