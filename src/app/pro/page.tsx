import Link from 'next/link'
import { EmptyState, Notice, Panel } from '@/components/ui/primitives'
import { verifyProPortalToken } from '@/modules/pro/token'
import { listProJobsForPhone } from '@/modules/pro/jobs'
import { formatIsraeliPhoneDisplay } from '@/lib/phone'
import { formatIls } from '@/modules/spend/true-cost'

export const dynamic = 'force-dynamic'

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

  return (
    <div className="flex flex-col gap-3">
      <p className="t-body text-ink">
        שלום{jobs[0]?.professionalName ? `, ${jobs[0].professionalName}` : ''} —{' '}
        {jobs.length} עבודות משויכות
      </p>
      <ul className="flex flex-col gap-3">
        {jobs.map((job) => (
          <li key={job.engagementId}>
            <Panel elevated className="overflow-hidden">
              <div className="flex flex-col gap-2 p-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="t-section text-ink">
                    #{job.storeCode} · {job.storeName}
                  </p>
                  {job.approvedAmount > 0 ? (
                    <span className="t-caption t-num text-ink-muted">
                      {formatIls(job.approvedAmount)}
                    </span>
                  ) : null}
                </div>
                {job.managerPhone ? (
                  <a
                    href={`tel:${job.managerPhone.replace(/\D/g, '')}`}
                    className="t-body text-accent underline"
                    dir="ltr"
                  >
                    חייג למנהל · {formatIsraeliPhoneDisplay(job.managerPhone)}
                  </a>
                ) : (
                  <p className="t-meta text-ink-muted">אין טלפון מנהל במערכת</p>
                )}
                <ul className="divide-y divide-border">
                  {job.tickets.map((ticket) => (
                    <li key={ticket.id}>
                      <Link
                        href={`/pro/${ticket.id}?t=${encodeURIComponent(t!)}`}
                        className="flex flex-col gap-0.5 py-2"
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
        ))}
      </ul>
    </div>
  )
}
