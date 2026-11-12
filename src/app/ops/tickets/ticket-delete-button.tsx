'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePhrase } from '@/components/i18n/locale-provider'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

export function TicketDeleteButton({
  ticketId,
  label,
  className,
  size = 'sm',
  variant = 'secondary',
  redirectTo = '/ops/tickets',
  iconOnly = false,
}: {
  ticketId: string
  /** Shown in the confirm dialog, e.g. OC-12 or short title. */
  label: string
  className?: string
  size?: 'sm' | 'md'
  variant?: 'secondary' | 'critical' | 'ghost'
  redirectTo?: string | null
  iconOnly?: boolean
}) {
  const p = usePhrase()
  const toast = useToast()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)

  async function remove() {
    const ok = window.confirm(
      p('למחוק את התקלה {label}? הפעולה סופית.', { label }),
    )
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        throw new Error(data?.error || p('המחיקה נכשלה'))
      }
      toast.push({ title: p('התקלה נמחקה'), tone: 'success' })
      startTransition(() => {
        if (redirectTo) router.push(redirectTo)
        else router.refresh()
      })
    } catch (err) {
      toast.push({
        title: err instanceof Error ? err.message : p('המחיקה נכשלה'),
        tone: 'critical',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={busy || pending}
      onClick={() => void remove()}
      className={cn(className)}
      aria-label={p('מחיקת תקלה')}
    >
      <Trash2 className="h-4 w-4" aria-hidden />
      {iconOnly ? null : (
        <span>{busy || pending ? p('מוחק…') : p('מחיקה')}</span>
      )}
    </Button>
  )
}
