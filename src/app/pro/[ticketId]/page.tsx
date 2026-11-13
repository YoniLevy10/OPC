import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MapPin, Phone } from 'lucide-react'
import { Notice, Panel, KeyValue } from '@/components/ui/primitives'
import { Button } from '@/components/ui/button'
import { verifyProPortalToken } from '@/modules/pro/token'
import { getProJobForTicket } from '@/modules/pro/jobs'
import { formatIsraeliPhoneDisplay } from '@/lib/phone'
import { formatIls } from '@/modules/spend/true-cost'
import { StatusLabel } from '@/components/ui/signal'

export const dynamic = 'force-dynamic'

function mapsHref(location: string | null, storeName: string): string | null {
  const q = (location || storeName).trim()
  if (!q) return null
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Optical Center ${q}`)}`
}

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

  const token = encodeURIComponent(t!)
  const maps = mapsHref(job.storeLocation, job.storeName)
  const tel = job.managerPhone?.replace(/\D/g, '') || null

  return (
    <div className="flex flex-col gap-4">
      <Button asChild variant="ghost" size="sm" className="self-start">
        <Link href={`/pro?t=${token}`}>← כל העבודות</Link>
      </Button>

      <Panel elevated>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="t-caption t-num font-semibold text-ink">{ticket.display}</p>
          <StatusLabel status={ticket.status} />
        </div>
        <p className="t-section text-ink">{ticket.title}</p>
        {ticket.description && ticket.description !== ticket.title ? (
          <p className="t-body mt-2 whitespace-pre-wrap text-ink-2">
            {ticket.description}
          </p>
        ) : null}
      </Panel>

      <Panel elevated>
        <dl className="divide-y divide-border">
          <KeyValue label="סניף">
            #{job.storeCode} · {job.storeName}
          </KeyValue>
          {job.storeLocation ? (
            <KeyValue label="כתובת">{job.storeLocation}</KeyValue>
          ) : null}
          <KeyValue label="מנהל חנות">
            {job.managerPhone ? (
              <a
                href={`tel:${tel}`}
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

        <div className="mt-4 flex flex-wrap gap-2">
          {tel ? (
            <Button asChild size="sm" variant="primary">
              <a href={`tel:${tel}`}>
                <Phone className="h-3.5 w-3.5" aria-hidden />
                חייג למנהל
              </a>
            </Button>
          ) : null}
          {maps ? (
            <Button asChild size="sm" variant="secondary">
              <a href={maps} target="_blank" rel="noreferrer">
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                ניווט לחנות
              </a>
            </Button>
          ) : null}
        </div>

        <p className="t-meta mt-3 text-ink-3">
          תאמו הגעה ישירות עם מנהל החנות. סגירת התקלה מתבצעת אחרי אישור החנות.
        </p>
      </Panel>
    </div>
  )
}
