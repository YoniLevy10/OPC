import { redirect } from 'next/navigation'
import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { ActivityLog } from './activity-log'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { listRecentAuditEvents } from '@/modules/audit/service'

export const dynamic = 'force-dynamic'

export default async function ActivityPage() {
  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) redirect('/login')

  const { events, slaCount, backend } = await listRecentAuditEvents(180)

  return (
    <OpsAppShell>
      <div className="ari-home mx-auto flex w-full max-w-3xl flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h1 className="t-title text-ink">היסטוריה</h1>
          <p className="t-meta text-ink-2">
            יומן פעולות על תקלות
            {backend === 'memory' ? ' · זיכרון' : ''}
          </p>
        </header>
        <ActivityLog events={events} slaCount={slaCount} />
      </div>
    </OpsAppShell>
  )
}
