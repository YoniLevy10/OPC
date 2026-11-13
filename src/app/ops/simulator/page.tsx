import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { PageToolbar } from '@/components/layout/page-toolbar'
import { OpsPageHero } from '@/components/ops/ops-page-hero'
import { Panel } from '@/components/ui/primitives'
import { SimulatorForm } from './simulator-form'
import { PhoneDesktopOnly } from '@/components/layout/phone-desktop-only'
import { getLocale } from '@/lib/i18n/server'
import { phrase } from '@/lib/i18n/phrases'

export const dynamic = 'force-dynamic'

export default async function SimulatorPage() {
  const locale = await getLocale()
  const p = (text: string, vars?: Record<string, string | number>) =>
    phrase(locale, text, vars)

  return (
    <OpsAppShell>
      <PhoneDesktopOnly title={p('סימולטור')}>
      <div className="flex w-full max-w-full flex-col gap-5 overflow-x-clip stagger">
        <PageToolbar backHref="/ops/lab" backLabel={p('חזרה')} showRefresh />
        <OpsPageHero
          title={p('סימולטור WhatsApp')}
          status={p('בדיקת intake בלי Meta')}
        />
        <Panel elevated className="px-4 py-5 md:px-5">
          <SimulatorForm />
        </Panel>
      </div>
      </PhoneDesktopOnly>
    </OpsAppShell>
  )
}
