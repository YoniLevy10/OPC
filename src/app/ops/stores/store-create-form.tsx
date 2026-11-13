'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import { Modal } from '@/components/ui/overlay'
import { Notice } from '@/components/ui/primitives'
import {
  IL_REGION_LABELS_HE,
  IL_REGION_CODES,
  regionCodeFromId,
  type IlRegionCode,
} from '@/modules/stores/regions'
import { usePhrase } from '@/components/i18n/locale-provider'

type TriggerSize = 'sm' | 'md' | 'touch' | 'block'
type TriggerVariant = 'primary' | 'secondary' | 'ghost' | 'critical' | 'resolve'

export type StoreFormSeed = {
  id: string
  code: string
  name: string
  city?: string | null
  address?: string | null
  region_id?: string | null
  area_manager?: string | null
  manager_name?: string | null
  manager_phone?: string | null
}

function regionForForm(regionId: string | null | undefined): IlRegionCode {
  return regionCodeFromId(regionId) ?? 'TA'
}

function emptyFields() {
  return {
    code: '',
    name: '',
    city: '',
    address: '',
    region: 'TA' as IlRegionCode,
    areaManager: '',
    managerName: '',
    managerPhone: '',
  }
}

function fieldsFromStore(store: StoreFormSeed) {
  return {
    code: store.code,
    name: store.name,
    city: store.city?.trim() ?? '',
    address: store.address?.trim() ?? '',
    region: regionForForm(store.region_id),
    areaManager: store.area_manager?.trim() ?? '',
    managerName: store.manager_name?.trim() ?? '',
    managerPhone: store.manager_phone?.trim() ?? '',
  }
}

export function StoreCreateForm({
  triggerLabel,
  triggerVariant = 'primary',
  triggerSize = 'touch',
  store = null,
}: {
  triggerLabel?: string
  triggerVariant?: TriggerVariant
  triggerSize?: TriggerSize
  /** When set, the modal edits this store (PATCH) instead of creating. */
  store?: StoreFormSeed | null
} = {}) {
  const p = usePhrase()
  const router = useRouter()
  const resolvedTriggerLabel = triggerLabel ?? p('הוספת סניף')
  const editing = Boolean(store?.id)
  const [open, setOpen] = useState(false)
  const [fields, setFields] = useState(() =>
    store ? fieldsFromStore(store) : emptyFields(),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setFields(store ? fieldsFromStore(store) : emptyFields())
    setError(null)
  }, [open, store])

  function reset() {
    setFields(store ? fieldsFromStore(store) : emptyFields())
    setError(null)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (editing && store) {
        const res = await fetch(`/api/stores/${store.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: fields.name.trim(),
            city: fields.city.trim() || null,
            address: fields.address.trim() || null,
            region_id: fields.region,
            area_manager: fields.areaManager.trim() || null,
            manager_name: fields.managerName.trim(),
            manager_phone: fields.managerPhone.trim(),
            replace_manager: true,
          }),
        })
        const json = (await res.json()) as { error?: string }
        if (!res.ok) throw new Error(json.error || 'עדכון נכשל')
        setOpen(false)
        router.refresh()
        return
      }

      const res = await fetch('/api/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: fields.code.trim(),
          name: fields.name.trim(),
          city: fields.city.trim() || null,
          address: fields.address.trim() || null,
          region_id: fields.region,
          area_manager: fields.areaManager.trim(),
          manager_name: fields.managerName.trim(),
          manager_phone: fields.managerPhone.trim(),
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
      setError(
        err instanceof Error
          ? err.message
          : editing
            ? 'עדכון נכשל'
            : 'יצירה נכשלה',
      )
    } finally {
      setBusy(false)
    }
  }

  const title = editing ? 'עריכת סניף' : 'פתיחת סניף חדש'
  const description = editing
    ? `מעדכנים את סניף ${store?.code ?? ''} · ${store?.name ?? ''} — כולל מנהל חנות וטלפון לזיהוי WhatsApp`
    : 'כולל מנהל מחוז + מנהל חנות וטלפון — כדי שדיווחי WhatsApp יזהו את הסניף אוטומטית'

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        size={triggerSize}
        className={triggerSize === 'touch' ? 'md:h-9 md:px-3.5' : undefined}
        onClick={() => setOpen(true)}
      >
        {editing ? (
          <Pencil className="h-4 w-4" aria-hidden />
        ) : (
          <Plus className="h-4 w-4" aria-hidden />
        )}
        {resolvedTriggerLabel}
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) reset()
        }}
        title={title}
        description={description}
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
                autoFocus={!editing}
                readOnly={editing}
                value={fields.code}
                onChange={(e) =>
                  setFields((prev) => ({ ...prev, code: e.target.value }))
                }
                placeholder="6050"
                className={editing ? 'bg-surface-sunken text-ink-2' : undefined}
              />
            </Field>
            <Field label="מחוז" htmlFor="store-region">
              <Select
                id="store-region"
                value={fields.region}
                onChange={(e) =>
                  setFields((prev) => ({
                    ...prev,
                    region: e.target.value as IlRegionCode,
                  }))
                }
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
              autoFocus={editing}
              value={fields.name}
              onChange={(e) =>
                setFields((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder="למשל: רעננה"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="עיר" htmlFor="store-city">
              <Input
                id="store-city"
                value={fields.city}
                onChange={(e) =>
                  setFields((prev) => ({ ...prev, city: e.target.value }))
                }
                placeholder="רעננה"
              />
            </Field>
            <Field label="כתובת (אופציונלי)" htmlFor="store-address">
              <Input
                id="store-address"
                value={fields.address}
                onChange={(e) =>
                  setFields((prev) => ({ ...prev, address: e.target.value }))
                }
                placeholder="רחוב…"
              />
            </Field>
          </div>

          <Field label="מנהל/ת מחוז" htmlFor="store-area-manager">
            <Input
              id="store-area-manager"
              required
              value={fields.areaManager}
              onChange={(e) =>
                setFields((prev) => ({ ...prev, areaManager: e.target.value }))
              }
              placeholder="ונסה / ארמנד / אלכס…"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="מנהל/ת חנות" htmlFor="store-manager-name">
              <Input
                id="store-manager-name"
                required
                value={fields.managerName}
                onChange={(e) =>
                  setFields((prev) => ({
                    ...prev,
                    managerName: e.target.value,
                  }))
                }
                placeholder="שם פרטי"
              />
            </Field>
            <Field label="טלפון מנהל/ת חנות" htmlFor="store-manager-phone">
              <Input
                id="store-manager-phone"
                required
                dir="ltr"
                inputMode="tel"
                value={fields.managerPhone}
                onChange={(e) =>
                  setFields((prev) => ({
                    ...prev,
                    managerPhone: e.target.value,
                  }))
                }
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
              {busy
                ? editing
                  ? 'שומר…'
                  : 'פותח סניף…'
                : editing
                  ? 'שמירת סניף'
                  : 'פתיחת סניף'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
