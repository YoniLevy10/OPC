'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { copyText } from '@/lib/copy-to-clipboard'
import { TM } from '@/lib/toast-messages'
import { cn } from '@/lib/utils'

type Mode = 'icon' | 'label'

type Props = {
  value: string
  /** Toast title on success — defaults to TM.copied. */
  successMessage?: string
  /** Visible label when mode=label and not yet copied. */
  label?: string
  /** Aria / title when mode=icon. */
  ariaLabel?: string
  mode?: Mode
  size?: ButtonProps['size']
  variant?: ButtonProps['variant']
  className?: string
  disabled?: boolean
}

/**
 * Copy control with inline flip + success toast (Bino-style feedback).
 */
export function CopyActionButton({
  value,
  successMessage = TM.copied,
  label = 'העתק',
  ariaLabel,
  mode = 'label',
  size = 'sm',
  variant = 'secondary',
  className,
  disabled,
}: Props) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const trimmed = value.trim()
  if (!trimmed) return null

  async function onCopy() {
    const ok = await copyText(trimmed)
    if (!ok) {
      toast.push({ title: TM.copyFailed, tone: 'critical' })
      return
    }
    setCopied(true)
    toast.push({ title: successMessage, tone: 'success' })
    window.setTimeout(() => setCopied(false), 1800)
  }

  const a11y = ariaLabel ?? (mode === 'icon' ? 'העתק' : label)

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={disabled || copied}
      className={cn(
        mode === 'icon' && 'min-h-[44px] min-w-[44px] px-0',
        className,
      )}
      aria-label={a11y}
      title={a11y}
      onClick={() => void onCopy()}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
      {mode === 'label' ? (copied ? 'הועתק' : label) : null}
    </Button>
  )
}
