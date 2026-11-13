import { redirect } from 'next/navigation'
import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { ActivityLog } from './activity-log'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { listRecentAuditEvents } from '@/modules/audit/service'
import { getLocale } from '@/lib/i18n/server'
import { phrase } from '@/lib/i18n/phrases'

export const dynamic = 'force-dynamic'

export default async function ActivityPage() {
  const locale = await getLocale()
  const p = (text: string, vars?: Record<string, string | number>) =>
    phrase(locale, text, vars)
  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) redirect('/login')

  const { events, slaCount, backend } = await listRecentAuditEvents(180)

  return (
    <OpsAppShell>
      <div className="ari-home mx-auto flex w-full max-w-3xl flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h1 className="t-title text-ink">{p('היסטוריה')}</h1>
          <p className="t-meta text-ink-2">
            {p('יומן פעולות על תקלות')}
            {backend === 'memory' ? p(' · זיכרון') : ''}
          </p>
        </header>
        <ActivityLog events={events} slaCount={slaCount} />
      </div>
    </OpsAppShell>
  )
}
