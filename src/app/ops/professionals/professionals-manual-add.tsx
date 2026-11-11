'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { usePhrase } from '@/components/i18n/locale-provider'

export function ProfessionalsManualAdd() {
  const p = usePhrase()
  const router = useRouter()
  const toast = useToast()
  const [, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [trade, setTrade] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) {
      toast.push({ title: p('הזינו שם איש מקצוע'), tone: 'critical' })
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/professionals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          full_name: name.trim(),
          phone: phone.trim() || null,
          trade: trade.trim() || null,
          source: 'manual',
        }),
      })
      const data = (await res.json().catch(() => null)) as {
        error?: string
      } | null
      if (!res.ok) {
        throw new Error(data?.error || p('השמירה נכשלה'))
      }
      setName('')
      setPhone('')
      setTrade('')
      toast.push({ title: p('איש המקצוע נשמר'), tone: 'success' })
      startTransition(() => router.refresh())
    } catch {
      toast.push({
        title: p('השמירה נכשלה'),
        tone: 'critical',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={p('שם מלא')}
          autoComplete="name"
          aria-label={p('שם מלא')}
        />
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={p('טלפון')}
          inputMode="tel"
          autoComplete="tel"
          dir="ltr"
          aria-label={p('טלפון')}
        />
        <Input
          value={trade}
          onChange={(e) => setTrade(e.target.value)}
          placeholder={p('מקצוע (אופציונלי)')}
          aria-label={p('מקצוע')}
          className="sm:col-span-2"
        />
      </div>
      <div className="mt-auto">
        <Button
          type="button"
          variant="primary"
          size="touch"
          className="w-full"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? p('שומר…') : p('שמור לספר')}
        </Button>
      </div>
    </div>
  )
}
