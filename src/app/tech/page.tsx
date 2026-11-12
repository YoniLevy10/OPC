import { redirect } from 'next/navigation'
import { TechShell } from '@/components/layout/tech-shell'
import { RefreshButton } from '@/components/layout/refresh-button'
import { TechJobList } from '@/app/tech/tech-job-list'
import { TechPushSubscribe } from '@/app/tech/tech-push-subscribe'
import { ErrorState, Notice } from '@/components/ui/primitives'
import { OpsPageHero } from '@/components/ops/ops-page-hero'
import { fetchTechTickets } from '@/modules/tickets/tech'
import { OPEN_TICKET_STATUSES } from '@/modules/tickets/constants'
import {
  getServerActor,
  resolveServerTechId,
} from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { actorIsTech } from '@/lib/auth/types'
import { techHref } from '@/lib/tech-href'

export const dynamic = 'force-dynamic'

export default async function TechPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ techId?: string }>
}) {
  const params = await searchParams
  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) {
    redirect('/login')
  }

  const techId = resolveServerTechId(actor, params.techId ?? null)
  const { tickets: fetched, error } = await fetchTechTickets(techId)

  // Strict: only jobs assigned to this technician (no unassigned pool noise).
  const tickets = techId
    ? fetched.filter((t) => t.assigned_to === techId)
    : []

  const openCount = tickets.filter((t) =>
    OPEN_TICKET_STATUSES.includes(t.status as never),
  ).length

  const missingTech = !techId
  const hqPreview =
    Boolean(techId) &&
    Boolean(actor) &&
    !actorIsTech(actor!) &&
    Boolean(params.techId)

  return (
    <TechShell
      enablePullToRefresh
      headerActions={<RefreshButton label="רענון" />}
    >
      <div className="flex flex-col gap-5">
        <OpsPageHero
          eyebrow="Optical Center · טכנאי"
          title="העבודות שלי"
          status={
            openCount > 0 ? (
              <span className="t-num">
                {openCount} עבודות פתוחות
              </span>
            ) : (
              'אין עבודות פתוחות'
            )
          }
        />

        <TechPushSubscribe />

        {error ? (
          <ErrorState
            title="לא ניתן לטעון עבודות"
            description="נסו לרענן. אם הבעיה נמשכת פנו למוקד."
            action={<RefreshButton label="רענון" />}
          />
        ) : null}

        {missingTech ? (
          <Notice tone="warning">
            לא זוהה טכנאי. היכנסו עם חשבון טכנאי, או פתחו את קישור השטח האישי
            ממסך המשתמשים (כולל techId).
          </Notice>
        ) : null}

        {hqPreview ? (
          <Notice tone="warning">
            תצוגת תור של טכנאי דרך קישור שטח.{' '}
            <a className="underline" href={techHref('/tech', techId)}>
              רענון
            </a>
          </Notice>
        ) : null}

        <TechJobList tickets={tickets} techId={techId} />
      </div>
    </TechShell>
  )
}
