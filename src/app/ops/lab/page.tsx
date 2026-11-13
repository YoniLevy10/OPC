import Link from 'next/link'
import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { OpsPageHero } from '@/components/ops/ops-page-hero'
import { Panel } from '@/components/ui/primitives'
import { SeedDemoTicketButton } from '@/components/ops/seed-demo-ticket-button'
import { Button } from '@/components/ui/button'
import { PhoneDesktopOnly } from '@/components/layout/phone-desktop-only'
import { getLocale } from '@/lib/i18n/server'
import { phrase } from '@/lib/i18n/phrases'

export const dynamic = 'force-dynamic'

export default async function LabPage() {
  const locale = await getLocale()
  const p = (text: string, vars?: Record<string, string | number>) =>
    phrase(locale, text, vars)

  return (
    <OpsAppShell>
      <PhoneDesktopOnly title={p('מעבדה')}>
      <div className="mx-auto flex w-full max-w-full flex-col gap-5 overflow-x-clip stagger md:max-w-3xl">
        <OpsPageHero
          title={p('מעבדה')}
          status={p('כלי בדיקה והדגמה פנימיים')}
        />

        <Panel elevated>
          <h2 className="t-section text-ink">{p('סימולטור WhatsApp')}</h2>
          <p className="t-body mb-3 mt-1 text-ink-2">
            {p('בדיקת intake בלי Meta')}
          </p>
          <Button asChild variant="secondary" size="sm">
            <Link href="/ops/simulator">{p('פתח סימולטור')}</Link>
          </Button>
        </Panel>

        <Panel elevated>
          <h2 className="t-section text-ink">{p('תקלת הדגמה')}</h2>
          <p className="t-body mb-3 mt-1 text-ink-2">
            {p('יצירת תקלה משויכת לבדיקת זרימה.')}
          </p>
          <SeedDemoTicketButton />
        </Panel>

        <Panel elevated>
          <h2 className="t-section text-ink">{p('בריאות')}</h2>
          <Button asChild variant="secondary" size="sm">
            <Link href="/ops/status">{p('סטטוס מערכת')}</Link>
          </Button>
        </Panel>
      </div>
      </PhoneDesktopOnly>
    </OpsAppShell>
  )
}
