'use client'

import { CopyActionButton } from '@/components/ui/copy-action-button'
import { techHref } from '@/lib/tech-href'
import { TM } from '@/lib/toast-messages'

const TECH_ROLES = new Set(['internal_technician', 'external_provider'])

export function TechFieldLinkCopy({
  userId,
  role,
}: {
  userId: string
  role: string
}) {
  if (!TECH_ROLES.has(role)) return null

  const origin =
    typeof window !== 'undefined' ? window.location.origin : ''
  // Always include techId so HQ field-links open the correct personal queue
  // (logged-in technicians still resolve via session actor.id).
  const path = techHref('/tech', userId)
  const url = origin ? `${origin}${path}` : path

  return (
    <div className="flex flex-wrap items-center gap-2">
      <CopyActionButton
        value={url}
        successMessage={TM.linkCopied}
        label="העתק קישור שטח"
        mode="label"
        size="sm"
      />
      <span className="t-caption t-num max-w-[12rem] truncate text-ink-3" dir="ltr">
        {url}
      </span>
    </div>
  )
}
