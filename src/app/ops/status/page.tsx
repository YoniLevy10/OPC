import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { OpsPageHero } from '@/components/ops/ops-page-hero'
import { StatusHealthPanel } from './status-health-panel'
import { PhoneDesktopOnly } from '@/components/layout/phone-desktop-only'
import { getLocale } from '@/lib/i18n/server'
import { phrase } from '@/lib/i18n/phrases'

export const dynamic = 'force-dynamic'

export default async function OpsStatusPage() {
  const locale = await getLocale()
  const p = (text: string, vars?: Record<string, string | number>) =>
    phrase(locale, text, vars)

  return (
    <OpsAppShell>
      <PhoneDesktopOnly title={p('סטטוס מערכת')}>
      <div className="mx-auto flex w-full max-w-full flex-col gap-5 overflow-x-clip stagger md:max-w-2xl">
        <OpsPageHero
          title={p('סטטוס מערכת')}
          status={p('בריאות השירותים בזמן אמת')}
        />
        <StatusHealthPanel />
      </div>
      </PhoneDesktopOnly>
    </OpsAppShell>
  )
}
