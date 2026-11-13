import { OpsPageHero } from '@/components/ops/ops-page-hero'
import { WhatsAppTemplatesClient } from './whatsapp-templates-client'
import { PhoneDesktopOnly } from '@/components/layout/phone-desktop-only'
import { getLocale } from '@/lib/i18n/server'
import { phrase } from '@/lib/i18n/phrases'

export default async function WhatsAppTemplatesPage() {
  const locale = await getLocale()
  const p = (text: string, vars?: Record<string, string | number>) =>
    phrase(locale, text, vars)

  return (
    <PhoneDesktopOnly title={p('תבניות WhatsApp')}>
    <div className="flex w-full max-w-full flex-col gap-4 overflow-x-clip">
      <OpsPageHero
        title={p('תבניות WhatsApp')}
        status={p('ניהול תבניות Meta לשליחה אחרי סגירת חלון 24 השעות')}
      />
      <WhatsAppTemplatesClient />
    </div>
    </PhoneDesktopOnly>
  )
}
