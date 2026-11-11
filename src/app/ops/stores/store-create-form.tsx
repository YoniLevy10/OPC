'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import { Modal } from '@/components/ui/overlay'
import { Notice } from '@/components/ui/primitives'
import { IL_REGION_LABELS_HE, IL_REGION_CODES } from '@/modules/stores/regions'

export function StoreCreateForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [address, setAddress] = useState('')
  const [region, setRegion] = useState('TA')
  const [areaManager, setAreaManager] = useState('')
  const [managerName, setManagerName] = useState('')
  const [managerPhone, setManagerPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setCode('')
    setName('')
    setCity('')
    setAddress('')
    setRegion('TA')
    setAreaManager('')
    setManagerName('')
    setManagerPhone('')
    setError(null)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          city: city.trim() || null,
          address: address.trim() || null,
          region_id: region,
          area_manager: areaManager.trim(),
          manager_name: managerName.trim(),
          manager_phone: managerPhone.trim(),
        }),
      })
      const json = (await res.json()) as {
        error?: string
        store?: { code?: string }
      }
      if (!res.ok) throw new Error(json.error || 'יצירה נכשלה')
      const createdCode = json.store?.code
      reset()
      setOpen(false)
      router.refresh()
      if (createdCode) {
        router.push(`/ops/stores/${encodeURIComponent(createdCode)}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'יצירה נכשלה')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="primary"
        size="touch"
        className="md:h-9 md:px-3.5"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-4 w-4" aria-hidden />
        הוספת סניף
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) reset()
        }}
        title="פתיחת סניף חדש"
        description="כולל מנהל מחוז + מנהל חנות וטלפון — כדי שדיווחי WhatsApp יזהו את הסניף אוטומטית"
      >
        <form onSubmit={onSubmit} className="space-y-3">
          <Notice tone="neutral">
            אחרי השמירה המספר של מנהל החנות מקושר לסניף ב־store_phones. בלי טלפון
            תקין — לא ייפתחו תקלות בוואטסאפ ממספר המנהל.
          </Notice>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="קוד סניף" htmlFor="store-code">
              <Input
                id="store-code"
                dir="ltr"
                inputMode="numeric"
                pattern="\d{1,6}"
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="6050"
              />
            </Field>
            <Field label="מחוז" htmlFor="store-region">
              <Select
                id="store-region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full"
                required
              >
                {IL_REGION_CODES.map((codeKey) => (
                  <option key={codeKey} value={codeKey}>
                    {IL_REGION_LABELS_HE[codeKey]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="שם הסניף" htmlFor="store-name">
            <Input
              id="store-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="למשל: רעננה"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="עיר" htmlFor="store-city">
              <Input
                id="store-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="רעננה"
              />
            </Field>
            <Field label="כתובת (אופציונלי)" htmlFor="store-address">
              <Input
                id="store-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="רחוב…"
              />
            </Field>
          </div>

          <Field label="מנהל/ת מחוז" htmlFor="store-area-manager">
            <Input
              id="store-area-manager"
              required
              value={areaManager}
              onChange={(e) => setAreaManager(e.target.value)}
              placeholder="ונסה / ארמנד / אלכס…"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="מנהל/ת חנות" htmlFor="store-manager-name">
              <Input
                id="store-manager-name"
                required
                value={managerName}
                onChange={(e) => setManagerName(e.target.value)}
                placeholder="שם פרטי"
              />
            </Field>
            <Field label="טלפון מנהל/ת חנות" htmlFor="store-manager-phone">
              <Input
                id="store-manager-phone"
                required
                dir="ltr"
                inputMode="tel"
                value={managerPhone}
                onChange={(e) => setManagerPhone(e.target.value)}
                placeholder="05X-XXXXXXX"
              />
            </Field>
          </div>

          {error ? <Notice tone="warning">{error}</Notice> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                reset()
              }}
            >
              ביטול
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {busy ? 'פותח סניף…' : 'פתיחת סניף'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
