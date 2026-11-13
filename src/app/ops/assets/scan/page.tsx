import { redirect } from 'next/navigation'
import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { PageToolbar } from '@/components/layout/page-toolbar'
import { OpsPageHero } from '@/components/ops/ops-page-hero'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { AssetScanClient } from './scan-client'
import { getLocale } from '@/lib/i18n/server'
import { phrase } from '@/lib/i18n/phrases'

export const dynamic = 'force-dynamic'

export default async function AssetScanPage() {
  const locale = await getLocale()
  const p = (text: string, vars?: Record<string, string | number>) =>
    phrase(locale, text, vars)
  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) redirect('/login')

  return (
    <OpsAppShell>
      <div className="flex flex-col gap-4 stagger">
        <PageToolbar
          backHref="/ops/assets"
          backLabel={p('חזרה לנכסים')}
          showRefresh
        />
        <OpsPageHero
          title={p('סריקת נכסים')}
          status={p('סריקת ברקוד או QR לזיהוי ציוד')}
        />
        <AssetScanClient />
      </div>
    </OpsAppShell>
  )
}
