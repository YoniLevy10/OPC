'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/primitives'
import { usePhrase } from '@/components/i18n/locale-provider'

export function ReportsSaveButton({
  from,
  to,
  month,
  disabled,
}: {
  from?: string
  to?: string
  month?: string
  disabled?: boolean
}) {
  const p = usePhrase()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const body = month
        ? { month, format: 'pdf' }
        : { from, to, format: 'pdf' }
      const res = await fetch('/api/reports/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as { error?: string; snapshot?: { label?: string } }
      if (!res.ok) throw new Error(json.error || p('שמירה נכשלה'))
      setNotice(p('נשמר: {label}', { label: json.snapshot?.label ?? p('דוח') }))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : p('שמירה נכשלה'))
    } finally {
      setBusy(false)
    }
  }

  const canSave = Boolean(month || (from && to))

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="primary"
        size="sm"
        disabled={disabled || busy || !canSave}
        onClick={() => void save()}
      >
        {busy ? p('שומר…') : p('שמירת דוח לטווח')}
      </Button>
      {!canSave ? (
        <p className="t-caption text-ink-3">
          {p('בחרו טווח תאריכים מלא או חודש כדי לשמור.')}
        </p>
      ) : null}
      {error ? <Notice tone="critical">{error}</Notice> : null}
      {notice ? <Notice tone="progress">{notice}</Notice> : null}
    </div>
  )
}
