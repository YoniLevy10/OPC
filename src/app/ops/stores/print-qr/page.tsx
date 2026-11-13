import Link from 'next/link'
import { redirect } from 'next/navigation'
import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { PageToolbar } from '@/components/layout/page-toolbar'
import { Panel, EmptyState, Notice } from '@/components/ui/primitives'
import { Button } from '@/components/ui/button'
import { OpsPageHero } from '@/components/ops/ops-page-hero'
import { PrintQrClient } from './print-qr-client'
import { fetchStores } from '@/modules/stores/data'
import { resolveWhatsAppBusinessPhone } from '@/modules/stores/business-phone'
import { storeWhatsAppDeepLink } from '@/modules/stores/whatsapp-link'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { PhoneDesktopOnly } from '@/components/layout/phone-desktop-only'
import { getLocale } from '@/lib/i18n/server'
import { phrase } from '@/lib/i18n/phrases'

export const dynamic = 'force-dynamic'

/** Archived from the product nav. QR lives on each store card. The route stays for a later bulk print. */

export default async function PrintQrBatchPage() {
  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) redirect('/login')

  const [{ stores }, businessPhone] = await Promise.all([
    fetchStores(),
    resolveWhatsAppBusinessPhone(),
  ])
  const active = stores.filter((s) => s.is_active !== false)
  const phoneReady = Boolean(businessPhone)
  const locale = await getLocale()
  const p = (text: string, vars?: Record<string, string | number>) =>
    phrase(locale, text, vars)

  return (
    <OpsAppShell>
      <PhoneDesktopOnly title={p('הדפסת QR')}>
      <div className="flex w-full max-w-full flex-col gap-5 overflow-x-clip stagger print:gap-0 print:p-0">
        <PageToolbar backHref="/ops/stores" backLabel={p('חזרה')} />
        <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
          <OpsPageHero
            className="min-w-0 flex-1"
            title={p('הדפסת QR')}
            status={`${active.length} ${p('סניפים פעילים')}`}
            actions={phoneReady ? <PrintQrClient /> : undefined}
          />
        </div>

        {!phoneReady ? (
          <Notice tone="warning">
            <span className="t-body-strong block">
              {p('חסר מספר WhatsApp עסקי')}
            </span>
            {p(
              'בלי מספר לא נוצרים קישורי QR תקינים. הגדירו ב־Ops → הגדרות → WhatsApp ואז רעננו את העמוד.',
            )}
            <div className="mt-3">
              <Button asChild variant="secondary" size="sm">
                <Link href="/ops/settings">{p('מעבר להגדרות')}</Link>
              </Button>
            </div>
          </Notice>
        ) : null}

        <Panel elevated className="print:border-0 print:p-0 print:shadow-none">
          <p className="t-body mb-4 text-ink-2 print:hidden">
            {p(
              'כל כרטיס כולל QR ל־WhatsApp עם טקסט STORE_CODE. לחיצה על ה־QR פותחת את אותו קישור לכתיבת תג NFC. השתמשו בהדפסה מהדפדפן (PDF). מומלץ PNG לסריקה אמינה מהמסך.',
            )}
          </p>
          {!phoneReady ? (
            <EmptyState
              title={p('QR לא זמין')}
              description={p('הגדירו מספר WhatsApp עסקי לפני הדפסה.')}
            />
          ) : active.length === 0 ? (
            <EmptyState
              title={p('אין חנויות פעילות')}
              description={p('הוסיפו חנות לפני הדפסת QR.')}
            />
          ) : (
            <ul
              role="list"
              className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-2"
            >
              {active.map((s) => {
                const deepLink = storeWhatsAppDeepLink(s.code, businessPhone)
                return (
                  <li key={s.id}>
                    <div className="break-inside-avoid rounded-[var(--radius-lg)] border border-border bg-surface p-4 text-center">
                      <a
                        href={deepLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={p('פתיחת קישור NFC / WhatsApp')}
                        aria-label={p('קישור NFC לסניף {code}', { code: s.code })}
                        className="mx-auto inline-block rounded-[var(--radius-md)] outline-none ring-[var(--tenant)] transition-opacity hover:opacity-90 focus-visible:ring-2 print:pointer-events-none"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/stores/qr?code=${encodeURIComponent(s.code)}&format=png`}
                          alt={`QR ${s.code}`}
                          width={160}
                          height={160}
                          className="h-40 w-40"
                        />
                      </a>
                      <p className="t-body-strong mt-3 text-ink">{s.name}</p>
                      <p className="t-num t-meta text-ink-2">#{s.code}</p>
                      <p dir="ltr" className="t-caption t-num mt-1 text-ink-3">
                        STORE_{s.code}
                      </p>
                      <a
                        href={deepLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        dir="ltr"
                        className="t-caption t-num mt-2 block break-all text-ink-3 underline-offset-2 hover:text-[var(--tenant)] hover:underline print:hidden"
                      >
                        {deepLink}
                      </a>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>
      </PhoneDesktopOnly>
    </OpsAppShell>
  )
}
