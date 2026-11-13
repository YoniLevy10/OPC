'use client'

import { useRouter } from 'next/navigation'
import { ActionMenu } from '@/components/ui/action-menu'
import { usePhrase } from '@/components/i18n/locale-provider'

export function StoreSecondaryActions({
  code,
  storeId,
  isActive,
  canEdit,
  waLink,
}: {
  code: string
  storeId: string
  isActive: boolean
  canEdit: boolean
  waLink?: string | null
}) {
  const router = useRouter()
  const p = usePhrase()

  async function toggleActive() {
    try {
      const res = await fetch(`/api/stores/${storeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !isActive }),
      })
      if (!res.ok) return
      router.refresh()
    } catch {
      /* ignore — UI stays as-is */
    }
  }

  const whatsappHref = waLink || null

  return (
    <ActionMenu
      label={p('פעולות נוספות לסניף')}
      items={[
        ...(whatsappHref
          ? [
              {
                key: 'wa',
                label: p('פתיחת WhatsApp'),
                href: whatsappHref,
              },
            ]
          : []),
        {
          key: 'tickets',
          label: p('תקלות בתור'),
          href: `/ops/tickets?store=${encodeURIComponent(code)}`,
        },
        ...(canEdit
          ? [
              {
                key: 'edit',
                label: p('עריכה'),
                href: `?tab=overview#store-edit`,
              },
              {
                key: 'toggle',
                label: isActive ? p('השבתת סניף') : p('הפעלת סניף'),
                onSelect: () => void toggleActive(),
                tone: isActive ? ('critical' as const) : ('default' as const),
              },
            ]
          : []),
      ]}
    />
  )
}
