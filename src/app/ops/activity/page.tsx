import { redirect } from 'next/navigation'
import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { OpsPageHero } from '@/components/ops/ops-page-hero'
import { ActivityLog } from './activity-log'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { listRecentAuditEvents } from '@/modules/audit/service'

export const dynamic = 'force-dynamic'

export default async function ActivityPage() {
  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) redirect('/login')

  const { events, backend } = await listRecentAuditEvents(200)

  return (
    <OpsAppShell>
      <div className="flex w-full max-w-full flex-col gap-5 overflow-x-clip stagger">
        <OpsPageHero
          title="היסטוריה"
          status={
            events.length === 0
              ? 'אין אירועים עדיין'
              : `${events.length} אירועי תקלות אחרונים${backend === 'memory' ? ' · זיכרון' : ''}`
          }
        />
        <ActivityLog events={events} />
      </div>
    </OpsAppShell>
  )
}
