import { redirect } from 'next/navigation'
import Link from 'next/link'
import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { PageToolbar } from '@/components/layout/page-toolbar'
import { OpsPageHero } from '@/components/ops/ops-page-hero'
import { Button } from '@/components/ui/button'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { ReportsHistoryClient } from './reports-history-client'
import { PhoneFold } from '@/components/layout/phone-fold'
import { getLocale } from '@/lib/i18n/server'
import { phrase } from '@/lib/i18n/phrases'

export const dynamic = 'force-dynamic'

export default async function ReportsHistoryPage() {
  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) redirect('/login')
  const locale = await getLocale()
  const p = (text: string, vars?: Record<string, string | number>) =>
    phrase(locale, text, vars)

  return (
    <OpsAppShell>
      <div className="flex flex-col gap-5 stagger">
        <PageToolbar
          backHref="/ops/reports"
          backLabel={p('חזרה לדוחות')}
          showRefresh
        />

        <OpsPageHero
          title={p('היסטוריית דוחות')}
          status={p('סיכומים שנשמרו מהמסך הראשי')}
          actions={
            <Button asChild variant="secondary" size="sm">
              <Link href="/ops/reports">{p('חזרה לסיכום')}</Link>
            </Button>
          }
        />

        <PhoneFold title={p('דוחות שנשמרו')} summary={p('פירוט וייצוא')}>
        <ReportsHistoryClient />
        </PhoneFold>
      </div>
    </OpsAppShell>
  )
}
