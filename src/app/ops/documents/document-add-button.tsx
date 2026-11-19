'use client'

import { useMemo, useState, useTransition } from 'react'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { usePhrase } from '@/components/i18n/locale-provider'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/overlay'
import { ErrorState } from '@/components/ui/primitives'
import { hearingCalibrationSlots } from '@/modules/documents/rules'
import { ISRAEL_STORES, israelStoreId } from '@/modules/stores/israel-stores'
import { addDocumentAction } from '../work-actions'

const CATEGORIES = hearingCalibrationSlots()

export function DocumentAddButton() {
  const p = usePhrase()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [storeCode, setStoreCode] = useState('')
  const [docType, setDocType] = useState(CATEGORIES[0]?.key ?? 'hearing_a')
  const [expiry, setExpiry] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [title, setTitle] = useState('')

  const stores = useMemo(
    () =>
      [...ISRAEL_STORES].sort((a, b) =>
        a.code.localeCompare(b.code, 'en', { numeric: true }),
      ),
    [],
  )

  const selected = stores.find((s) => s.code === storeCode) ?? null

  function reset() {
    setError(null)
    setStoreCode('')
    setDocType(CATEGORIES[0]?.key ?? 'hearing_a')
    setExpiry('')
    setSourceUrl('')
    setTitle('')
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const form = e.currentTarget
    const data = new FormData(form)
    if (selected) {
      data.set('storeId', israelStoreId(selected.stableKey ?? selected.code))
      data.set('storeCode', selected.code)
      data.set('storeName', selected.name)
    }
    startTransition(async () => {
      try {
        await addDocumentAction(data)
        setOpen(false)
        reset()
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : p('שמירה נכשלה'))
      }
    })
  }

  return (
    <>
      <Button
        type="button"
        variant="primary"
        size="touch"
        className="md:h-9 md:px-3.5"
        onClick={() => {
          reset()
          setOpen(true)
        }}
        aria-label={p('הבאת מסמך')}
      >
        <Plus className="h-4 w-4" aria-hidden />
        <span className="ms-1.5">{p('הבאת מסמך')}</span>
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) reset()
        }}
        title={p('הבאת מסמך')}
        description={p('שייכו לסניף, בחרו קטגוריה, וציינו תאריך פג תוקף.')}
      >
        <form onSubmit={onSubmit} className="grid gap-3" encType="multipart/form-data">
          <Field label={p('סניף')} htmlFor="add-doc-store">
            <select
              id="add-doc-store"
              name="storeCode"
              required
              value={storeCode}
              onChange={(e) => setStoreCode(e.target.value)}
              disabled={pending}
              className="h-11 w-full rounded-md border border-border bg-surface px-2"
            >
              <option value="">{p('בחרו סניף…')}</option>
              {stores.map((store) => (
                <option key={store.code} value={store.code}>
                  #{store.code} · {store.name}
                </option>
              ))}
            </select>
          </Field>

          <fieldset className="grid gap-2">
            <legend className="t-caption text-ink-2">{p('קטגוריה')}</legend>
            <div className="grid gap-1.5">
              {CATEGORIES.map((cat) => (
                <label
                  key={cat.key}
                  className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 py-2 has-[:checked]:border-[color-mix(in_srgb,var(--tenant)_45%,var(--border))] has-[:checked]:bg-[color-mix(in_srgb,var(--tenant-soft)_55%,var(--surface))]"
                >
                  <input
                    type="radio"
                    name="docType"
                    value={cat.key}
                    checked={docType === cat.key}
                    onChange={() => setDocType(cat.key)}
                    disabled={pending}
                    className="accent-[var(--tenant)]"
                  />
                  <span className="t-body text-ink">{p(cat.label)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <Field label={p('תאריך פג תוקף')} htmlFor="add-doc-expiry">
            <Input
              id="add-doc-expiry"
              name="expiry"
              type="date"
              required
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              disabled={pending}
            />
          </Field>

          <Field label={p('קובץ PDF')} htmlFor="add-doc-file">
            <Input
              id="add-doc-file"
              name="documentFile"
              type="file"
              accept="application/pdf,.pdf"
              disabled={pending}
            />
          </Field>

          <Field label={p('או קישור לדרייב')} htmlFor="add-doc-url">
            <Input
              id="add-doc-url"
              name="sourceUrl"
              dir="ltr"
              placeholder="https://drive.google.com/…"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              disabled={pending}
            />
          </Field>

          <Field label={p('שם לתצוגה (רשות)')} htmlFor="add-doc-title">
            <Input
              id="add-doc-title"
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={pending}
            />
          </Field>

          {error ? <ErrorState title={p('שגיאה')} description={error} /> : null}

          <Button type="submit" disabled={pending || !storeCode || !expiry}>
            {pending ? p('שומר…') : p('שמירת מסמך')}
          </Button>
        </form>
      </Modal>
    </>
  )
}
