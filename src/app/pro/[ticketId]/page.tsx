import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Notice, Panel, KeyValue } from '@/components/ui/primitives'
import { Button } from '@/components/ui/button'
import { verifyProPortalToken } from '@/modules/pro/token'
import { getProJobForTicket } from '@/modules/pro/jobs'
import { formatIsraeliPhoneDisplay } from '@/lib/phone'
import { formatIls } from '@/modules/spend/true-cost'
import { StatusLabel } from '@/components/ui/signal'

export const dynamic = 'force-dynamic'

export default async function ProTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticketId: string }>
  searchParams: Promise<{ t?: string }>
}) {
  const { ticketId } = await params
  const { t } = await searchParams
  const payload = verifyProPortalToken(t)
  if (!payload) {
    return (
      <Notice tone="critical">
        קישור לא תקף — בקשו מארי לשלוח שוב SMS עם קישור אישי.
      </Notice>
    )
  }

  const job = await getProJobForTicket(payload.phone, ticketId)
  if (!job) notFound()

  const ticket =
    job.tickets.find((row) => row.id === ticketId) ?? job.tickets[0]
  if (!ticket) notFound()

  return (
    <div className="flex flex-col gap-3">
      <Button asChild variant="ghost" size="sm" className="self-start">
        <Link href={`/pro?t=${encodeURIComponent(t!)}`}>← כל העבודות</Link>
      </Button>

      <Panel elevated>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="t-caption t-num font-semibold text-ink">{ticket.display}</p>
          <StatusLabel status={ticket.status} />
        </div>
        <p className="t-section text-ink">{ticket.title}</p>
        {ticket.description && ticket.description !== ticket.title ? (
          <p className="t-body mt-2 whitespace-pre-wrap text-ink-muted">
            {ticket.description}
          </p>
        ) : null}
      </Panel>

      <Panel elevated>
        <dl className="divide-y divide-border">
          <KeyValue label="סניף">
            #{job.storeCode} · {job.storeName}
          </KeyValue>
          <KeyValue label="מנהל חנות">
            {job.managerPhone ? (
              <a
                href={`tel:${job.managerPhone.replace(/\D/g, '')}`}
                className="text-accent underline"
                dir="ltr"
              >
                {formatIsraeliPhoneDisplay(job.managerPhone)}
              </a>
            ) : (
              '—'
            )}
          </KeyValue>
          {job.approvedAmount > 0 ? (
            <KeyValue label="מחיר שאושר">{formatIls(job.approvedAmount)}</KeyValue>
          ) : null}
        </dl>
        <p className="t-meta mt-3 text-ink-muted">
          תאמו הגעה ישירות עם מנהל החנות. סגירת התקלה מתבצעת אחרי אישור החנות.
        </p>
      </Panel>
    </div>
  )
}
