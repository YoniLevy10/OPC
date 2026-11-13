import Link from 'next/link'
import { MapPin, Phone } from 'lucide-react'
import { EmptyState, Notice, Panel } from '@/components/ui/primitives'
import { Button } from '@/components/ui/button'
import { verifyProPortalToken } from '@/modules/pro/token'
import { listProJobsForPhone } from '@/modules/pro/jobs'
import { formatIsraeliPhoneDisplay } from '@/lib/phone'
import { formatIls } from '@/modules/spend/true-cost'

export const dynamic = 'force-dynamic'

function mapsHref(location: string | null, storeName: string): string | null {
  const q = (location || storeName).trim()
  if (!q) return null
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Optical Center ${q}`)}`
}

export default async function ProPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>
}) {
  const { t } = await searchParams
  const payload = verifyProPortalToken(t)
  if (!payload) {
    return (
      <Notice tone="critical">
        קישור לא תקף — בקשו מארי לשלוח שוב SMS עם קישור אישי לעבודות.
      </Notice>
    )
  }

  const jobs = await listProJobsForPhone(payload.phone)

  if (jobs.length === 0) {
    return (
      <EmptyState
        title="אין עבודות פתוחות"
        description="כשארי ישבץ אתכם לתקלה, היא תופיע כאן."
      />
    )
  }

  const token = encodeURIComponent(t!)

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="t-title text-ink">
          שלום{jobs[0]?.professionalName ? `, ${jobs[0].professionalName}` : ''}
        </h1>
        <p className="t-meta text-ink-2">
          {jobs.length === 1 ? 'עבודה אחת משויכת' : `${jobs.length} עבודות משויכות`}
        </p>
      </header>

      <ul className="flex flex-col gap-3">
        {jobs.map((job) => {
          const maps = mapsHref(job.storeLocation, job.storeName)
          const tel = job.managerPhone?.replace(/\D/g, '') || null
          return (
            <li key={job.engagementId}>
              <Panel elevated className="overflow-hidden">
                <div className="flex flex-col gap-3 p-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="t-section text-ink">
                        #{job.storeCode} · {job.storeName}
                      </p>
                      {job.storeLocation ? (
                        <p className="t-meta mt-0.5 text-ink-2">{job.storeLocation}</p>
                      ) : null}
                    </div>
                    {job.approvedAmount > 0 ? (
                      <span className="t-body-strong t-num shrink-0 text-ink">
                        {formatIls(job.approvedAmount)}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {tel ? (
                      <Button asChild size="sm" variant="primary">
                        <a href={`tel:${tel}`}>
                          <Phone className="h-3.5 w-3.5" aria-hidden />
                          חייג למנהל · {formatIsraeliPhoneDisplay(job.managerPhone!)}
                        </a>
                      </Button>
                    ) : (
                      <p className="t-meta text-ink-3">אין טלפון מנהל במערכת</p>
                    )}
                    {maps ? (
                      <Button asChild size="sm" variant="secondary">
                        <a href={maps} target="_blank" rel="noreferrer">
                          <MapPin className="h-3.5 w-3.5" aria-hidden />
                          ניווט
                        </a>
                      </Button>
                    ) : null}
                  </div>

                  <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border/70 bg-surface-sunken/30">
                    {job.tickets.map((ticket) => (
                      <li key={ticket.id}>
                        <Link
                          href={`/pro/${ticket.id}?t=${token}`}
                          className="flex flex-col gap-0.5 px-3 py-2.5 transition-colors hover:bg-surface-sunken/50"
                        >
                          <span className="t-caption t-num font-semibold text-ink">
                            {ticket.display}
                          </span>
                          <span className="t-body line-clamp-2 text-ink">
                            {ticket.title}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </Panel>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
