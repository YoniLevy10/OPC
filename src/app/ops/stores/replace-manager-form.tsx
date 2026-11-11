'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'

export function ReplaceManagerForm({
  storeId,
  managerName: initialName,
  managerPhone: initialPhone,
  managerNameEn: initialNameEn,
}: {
  storeId: string
  managerName: string | null
  managerPhone: string | null
  managerNameEn: string | null
}) {
  const router = useRouter()
  const [name, setName] = useState(initialName ?? '')
  const [nameEn, setNameEn] = useState(initialNameEn ?? '')
  const [phone, setPhone] = useState(initialPhone ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setOk(false)
    try {
      const res = await fetch(`/api/stores/${storeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          replace_manager: true,
          manager_name: name.trim(),
          manager_name_en: nameEn.trim() || null,
          manager_phone: phone.trim(),
        }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error || 'החלפת מנהל נכשלה')
      setOk(true)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'החלפת מנהל נכשלה')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <p className="t-meta text-ink-muted">
        החלפת מנהל מעדכנת את הזיהוי בוואטסאפ — המספר החדש יקושר לסניף אוטומטית;
        המספר הישן יפסיק לזהות את החנות.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="שם מנהל/ת" htmlFor={`mgr-name-${storeId}`}>
          <Input
            id={`mgr-name-${storeId}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="min-w-[8rem]"
          />
        </Field>
        <Field label="שם באנגלית" htmlFor={`mgr-en-${storeId}`}>
          <Input
            id={`mgr-en-${storeId}`}
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
            className="min-w-[7rem]"
          />
        </Field>
        <Field label="טלפון" htmlFor={`mgr-phone-${storeId}`}>
          <Input
            id={`mgr-phone-${storeId}`}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            inputMode="tel"
            dir="ltr"
            className="min-w-[9rem]"
          />
        </Field>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'שומר…' : 'החלף מנהל'}
        </Button>
      </div>
      {error ? (
        <p className="t-meta text-[var(--signal-critical)]">{error}</p>
      ) : null}
      {ok ? (
        <p className="t-meta text-[var(--signal-resolved)]">
          מנהל עודכן וסונכרן לזיהוי WhatsApp
        </p>
      ) : null}
    </form>
  )
}
