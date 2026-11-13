import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { OpsPageHero } from '@/components/ops/ops-page-hero'
import { Skeleton } from '@/components/ui/primitives'
import { InboxClient } from './inbox-client'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { getLocale } from '@/lib/i18n/server'
import { phrase } from '@/lib/i18n/phrases'

export const dynamic = 'force-dynamic'

export default async function InboxPage() {
  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) redirect('/login')
  const locale = await getLocale()

  return (
    <OpsAppShell>
      <div className="flex min-h-0 flex-1 flex-col md:w-full md:gap-2">
        {/* Compact desktop band; mobile uses the glass top-bar title (fillMain). */}
        <OpsPageHero
          className="hidden shrink-0 md:block"
          compact
          title="WhatsApp"
          status={phrase(locale, 'תיבת דואר נכנסת · השתלטות אנושית')}
        />
        <Suspense
          fallback={
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 md:p-0">
              <Skeleton className="h-10 w-48" />
              <Skeleton className="min-h-0 flex-1 w-full rounded-[var(--radius-lg)]" />
            </div>
          }
        >
          <InboxClient />
        </Suspense>
      </div>
    </OpsAppShell>
  )
}
