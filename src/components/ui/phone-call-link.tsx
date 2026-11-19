'use client'

import { Phone } from 'lucide-react'
import { CopyActionButton } from '@/components/ui/copy-action-button'
import { TM } from '@/lib/toast-messages'
import { cn } from '@/lib/utils'

/** Dial CTA — uses tel: for mobile PWA / HQ desk phones. Optional copy button. */
export function PhoneCallLink({
  phone,
  label = 'חיוג',
  className,
  showCopy = false,
}: {
  phone: string
  label?: string
  className?: string
  /** When true, show an adjacent copy control with toast feedback. */
  showCopy?: boolean
}) {
  const digits = phone.replace(/[^\d+]/g, '')
  if (!digits) return null
  const href = digits.startsWith('+') ? `tel:${digits}` : `tel:+${digits}`

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
      <a
        href={href}
        dir="ltr"
        className="t-control inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface px-3 text-ink transition-colors hover:bg-surface-sunken"
      >
        <Phone className="h-3.5 w-3.5 text-[var(--tenant)]" aria-hidden />
        <span className="t-num">{label === 'חיוג' ? phone : label}</span>
      </a>
      {showCopy ? (
        <CopyActionButton
          value={phone}
          successMessage={TM.phoneCopied}
          mode="icon"
          ariaLabel="העתק טלפון"
          size="sm"
        />
      ) : null}
    </span>
  )
}
