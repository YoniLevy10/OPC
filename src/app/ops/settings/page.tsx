import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { OpsPageHero } from '@/components/ops/ops-page-hero'
import {
  GroupedList,
  GroupedRow,
  GroupedSection,
} from '@/components/ui/grouped-list'
import { Tx } from '@/components/i18n/tx'
import { SettingsForm } from './settings-form'
import { getSettings } from '@/modules/settings/service'
import { PhoneFold } from '@/components/layout/phone-fold'
import { getLocale } from '@/lib/i18n/server'
import { phrase } from '@/lib/i18n/phrases'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const { settings } = await getSettings()
  const locale = await getLocale()
  const p = (text: string, vars?: Record<string, string | number>) =>
    phrase(locale, text, vars)

  return (
    <OpsAppShell>
      <div className="mx-auto flex max-w-3xl flex-col gap-5 stagger">
        <OpsPageHero
          largeTitle
          title={p('הגדרות')}
          status={`${settings.brand_name} · ${settings.country_label}`}
        />

        <PhoneFold title={p('עריכה')} summary={`${settings.brand_name} · ${settings.country_label}`}>
        <SettingsForm initial={settings} />
        </PhoneFold>

        <GroupedList>
          <GroupedSection title={p('פריסה')}>
            <GroupedRow className="justify-between">
              <span className="t-body text-ink-2">
                <Tx text="מוצר" />
              </span>
              <span className="t-body text-ink">MILO</span>
            </GroupedRow>
            <GroupedRow className="justify-between">
              <span className="t-body text-ink-2">
                <Tx text="לקוח" />
              </span>
              <span className="t-body text-ink">{settings.brand_name}</span>
            </GroupedRow>
            <GroupedRow className="justify-between">
              <span className="t-body text-ink-2">
                <Tx text="מדינה" />
              </span>
              <span className="t-body text-ink">{settings.country_label}</span>
            </GroupedRow>
            <GroupedRow className="justify-between">
              <span className="t-body text-ink-2">
                <Tx text="ערוץ דיווח" />
              </span>
              <span className="t-body text-ink">WhatsApp</span>
            </GroupedRow>
          </GroupedSection>
        </GroupedList>
      </div>
    </OpsAppShell>
  )
}
