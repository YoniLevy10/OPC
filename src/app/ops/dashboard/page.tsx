import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { CreateTicketDialog } from '@/components/ops/create-ticket-dialog'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { scopeTicketsForActor } from '@/lib/auth/ticket-scope'
import { computeDashboardKpis } from '@/modules/ops/dashboard-kpis'
import { ariGreeting, buildAriHome } from '@/modules/ops/ari-home'
import { listTickets } from '@/modules/tickets/service'
import { hydrateOpsLedger } from '@/lib/data/ops-db'
import { listSpends, listTasks } from '@/lib/data/ops-ledger'
import { formatRecordedAmount, recordedTicketAmount } from '@/modules/recommendations/estimate'
import { OPEN_TICKET_STATUSES } from '@/modules/tickets/constants'
import type { QueueTicket } from '@/modules/tickets/queue'
import { DashboardSoftRefresh } from './dashboard-soft-refresh'
import { AriHomeBoard } from './ari-home'
import { getLocale } from '@/lib/i18n/server'
import { phrase } from '@/lib/i18n/phrases'
import { listStores } from '@/modules/stores/service'
import { ledgerDecisions } from '@/modules/decisions/from-ledger'
import { buildHomeDecisions, scopeHomeStores } from '@/modules/ops/home-decisions'
import { HomeDecisions } from './home-decisions'

export const dynamic = 'force-dynamic'

export default async function OpsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>
}) {
  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) {
    redirect('/login')
  }
  const locale = await getLocale()
  const p = (text: string) => phrase(locale, text)
  const noticeCode = (await searchParams).notice
  const canCreateTicket = actor?.memberships.some(
    (membership) => membership.role === 'global_admin' || membership.role === 'global_maintenance',
  ) ?? false

  const [openResult, doneResult, storeResult, ledgerResult] = await Promise.all([
    listTickets({
      limit: 150,
      statuses: [...OPEN_TICKET_STATUSES],
    }).catch(() => ({ tickets: [], backend: 'memory' as const, error: 'טעינת התקלות נכשלה' })),
    listTickets({
      limit: 80,
      statuses: ['resolved', 'closed'],
    }).catch(() => ({ tickets: [], backend: 'memory' as const, error: 'טעינת ההיסטוריה נכשלה' })),
    listStores().catch(() => ({ stores: [], error: 'טעינת החנויות נכשלה' })),
    hydrateOpsLedger().catch(() => ({ ok: false as const, error: 'טעינת נתוני התפעול נכשלה' })),
  ])
  const ticketsFailed = Boolean(openResult.error || doneResult.error)
  const storesFailed = 'error' in storeResult
  const homeDecisions = buildHomeDecisions({
    actor,
    tickets: [...openResult.tickets, ...doneResult.tickets] as unknown as QueueTicket[],
    decisions: ledgerResult.ok ? ledgerDecisions(new Date(), locale) : [],
    stores: storeResult.stores,
    tasks: ledgerResult.ok ? listTasks() : [],
    ticketsFailed,
    ledgerFailed: !ledgerResult.ok,
    storesFailed,
    locale,
  })
  const visibleStores = scopeHomeStores(actor, storeResult.stores)

  const fetched = [
    ...(openResult.tickets ?? []),
    ...(doneResult.tickets ?? []),
  ] as unknown as QueueTicket[]
  const all = actor ? scopeTicketsForActor(actor, fetched) : fetched
  const kpis = computeDashboardKpis(all, [])
  const openTickets = all.filter((ticket) =>
    (OPEN_TICKET_STATUSES as readonly string[]).includes(ticket.status),
  )
  const closedTickets = all.filter(
    (ticket) => ticket.status === 'resolved' || ticket.status === 'closed',
  )
  const home = buildAriHome({
    openTickets,
    closedTickets,
    openCount: kpis.open,
    locale,
  })
  const spends = ledgerResult.ok ? listSpends() : []
  const ticketCost: Record<string, string> = {}
  const storeCost: Record<string, string> = {}
  const byStore = new Map<string, { sum: number; missing: number }>()
  let recordedSum = 0
  let recordedMissing = 0
  for (const ticket of openTickets) {
    const amount = recordedTicketAmount(spends, ticket.id)
    ticketCost[ticket.id] = formatRecordedAmount(amount)
    const storeId = ticket.store_id || ''
    const row = byStore.get(storeId) ?? { sum: 0, missing: 0 }
    if (amount == null) {
      row.missing += 1
      recordedMissing += 1
    } else {
      row.sum += amount
      recordedSum += amount
    }
    byStore.set(storeId, row)
  }
  for (const [storeId, row] of byStore) {
    if (row.sum <= 0) storeCost[storeId] = 'אין עדיין מחיר'
    else if (row.missing > 0) {
      storeCost[storeId] = `${formatRecordedAmount(row.sum)} נרשמו, ${row.missing} בלי מחיר`
    }
    else storeCost[storeId] = formatRecordedAmount(row.sum)
  }
  const notice =
    noticeCode === 'sent'
      ? p('הביקור הוזמן. מצב העברת הפרטים מופיע בביקור.')
      : noticeCode === 'approved'
        ? p('ההזמנה אושרה')
        : null

  return (
    <OpsAppShell>
      <DashboardSoftRefresh />
      <div className="ari-home flex flex-col gap-4">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="t-title text-ink">{ariGreeting()}</h1>
          {canCreateTicket ? (
            <div className="max-md:[&>button]:w-full">
            <Suspense fallback={null}>
              <CreateTicketDialog stores={visibleStores} trigger="header" />
            </Suspense>
            </div>
          ) : null}
        </header>
        <HomeDecisions model={homeDecisions} />
        <AriHomeBoard
          model={home}
          stats={{
            open: kpis.open,
            closedToday: home.closedToday,
            overdue: kpis.breached,
            awaitingApproval: homeDecisions.spendApprovals,
          }}
          dataIncomplete={homeDecisions.partialFailure}
          costsAvailable={ledgerResult.ok}
          ticketCost={ticketCost}
          storeCost={storeCost}
          recordedSummary={
            openTickets.length === 0 || !ledgerResult.ok
              ? null
              : recordedSum <= 0
                ? p('אין עדיין מחיר')
                : recordedMissing > 0
                  ? `${formatRecordedAmount(recordedSum)} נרשמו, ${recordedMissing} בלי מחיר`
                  : formatRecordedAmount(recordedSum)
          }
          notice={notice}
        />
      </div>
    </OpsAppShell>
  )
}
