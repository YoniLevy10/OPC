import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { canReadTicket } from '@/lib/auth/types'
import { storeProductRoles } from '@/lib/auth/roles'
import { getById } from '@/modules/tickets/service'
import { StatusLabel } from '@/components/ui/signal'
import { Panel, KeyValue } from '@/components/ui/primitives'
import { Button } from '@/components/ui/button'
import { OpsPageHero } from '@/components/ops/ops-page-hero'
import { StoreConfirmButton } from '../store-confirm-button'
import { StoreWaPrimaryNotice } from '../../wa-primary-notice'
import { PhoneFold } from '@/components/layout/phone-fold'
import {
  TICKET_CATEGORY_LABELS_HE,
  type TicketStatus,
} from '@/modules/tickets/constants'
import { formatRepairEtaHe } from '@/modules/tickets/repair-eta'
import { formatQualityHoldHe, isQualityHoldActive } from '@/modules/tickets/quality-hold'

export const dynamic = 'force-dynamic'

export default async function StoreTicketPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) redirect('/login')

  const { id } = await params
  let ticket
  try {
    ticket = await getById(id)
  } catch {
    ticket = null
  }
  if (!ticket || (actor && !canReadTicket(actor, ticket))) notFound()

  const canConfirm = actor
    ? actor.memberships.some((membership) =>
        storeProductRoles().includes(membership.role) &&
        membership.organization_id === ticket.organization_id &&
        membership.store_id === ticket.store_id,
      )
    : shouldAllowDemoEntry()

  const etaLabel = formatRepairEtaHe(ticket.repair_eta_at)
  const holdLabel =
    ticket.status === 'resolved' && isQualityHoldActive(ticket.quality_hold_until)
      ? formatQualityHoldHe(ticket.quality_hold_until)
      : null

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5 stagger">
      <OpsPageHero
        eyebrow={ticket.display_number ?? ticket.id.slice(0, 8)}
        title={ticket.stores?.name ?? 'תקלה'}
        status={ticket.description || ticket.title || 'ללא תיאור'}
        footer={<StatusLabel status={ticket.status as TicketStatus} />}
      />

      <PhoneFold title="פרטים" summary={TICKET_CATEGORY_LABELS_HE[ticket.category] ?? ticket.category}>
      <Panel elevated>
        <dl className="divide-y divide-border">
          <KeyValue label="סוג">
            {TICKET_CATEGORY_LABELS_HE[ticket.category] ?? ticket.category}
          </KeyValue>
          <KeyValue label="טכנאי">
            {ticket.assignee?.full_name ||
              ticket.assignee?.email ||
              '—'}
          </KeyValue>
          {etaLabel ? (
            <KeyValue label="מועד הגעה משוער">{etaLabel}</KeyValue>
          ) : null}
          {holdLabel ? (
            <KeyValue label="החזקת איכות">{holdLabel}</KeyValue>
          ) : null}
        </dl>
      </Panel>
      </PhoneFold>

      {ticket.status === 'engaged' ? (
        <Panel elevated>
          <p className="t-body text-ink">ארי אישר את העבודה. מנהל החנות מתאם את ההגעה ישירות עם איש המקצוע.</p>
          <p className="t-meta mt-2 text-ink-2">התקלה נשארת פתוחה עד ביצוע העבודה ואישור התיקון בחנות.</p>
        </Panel>
      ) : null}

      {canConfirm && ticket.status === 'resolved' ? (
        <StoreWaPrimaryNotice
          storeCode={ticket.stores?.code ?? '172'}
          mode="confirm"
        />
      ) : null}

      {canConfirm ? (
        <StoreConfirmButton
          ticketId={ticket.id}
          initialStatus={ticket.status}
          qualityHoldUntil={ticket.quality_hold_until ?? null}
        />
      ) : null}

      <Button asChild variant="ghost" size="touch" className="self-start">
        <Link href="/store">חזרה לרשימה</Link>
      </Button>
    </div>
  )
}
