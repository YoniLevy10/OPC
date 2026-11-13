'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { ScanBarcode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import {
  EmptyState,
  ErrorState,
  Notice,
  Panel,
  PanelHeader,
} from '@/components/ui/primitives'
import { PhoneList } from '@/components/mobile'
import { AdminRow } from '@/components/ui/admin-row'
import { BarcodeScannerModal } from '@/components/assets/barcode-scanner'
import { findAssetByCode } from '@/modules/assets/barcode'
import { assetWhatsAppPrefill } from '@/modules/assets/service'
import { usePhrase } from '@/components/i18n/locale-provider'

type AssetRow = {
  id: string
  code: string
  name: string
  asset_type: string
  barcode?: string | null
}

export function StoreAssetsPanel({
  storeId,
  storeCode,
}: {
  storeId: string
  storeCode: string
}) {
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [barcode, setBarcode] = useState('')
  const [name, setName] = useState('')
  const [assetType, setAssetType] = useState('hvac')
  const [scanOpen, setScanOpen] = useState(false)
  const [scanTarget, setScanTarget] = useState<'lookup' | 'create'>('lookup')
  const p = usePhrase()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/assets?store=${encodeURIComponent(storeId)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || p('טעינה נכשלה'))
      setAssets(json.assets ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : p('טעינה נכשלה'))
    } finally {
      setLoading(false)
    }
  }, [storeId])

  useEffect(() => {
    void load()
  }, [load])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const res = await fetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: storeId,
          code,
          name,
          asset_type: assetType,
          barcode: barcode.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || p('יצירה נכשלה'))
      setCode('')
      setBarcode('')
      setName('')
      setNotice(p('הנכס נוסף'))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : p('יצירה נכשלה'))
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(id: string) {
    if (!confirm(p('למחוק נכס זה?'))) return
    setBusy(true)
    try {
      const res = await fetch(`/api/assets/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error || p('מחיקה נכשלה'))
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : p('מחיקה נכשלה'))
    } finally {
      setBusy(false)
    }
  }

  function onScan(raw: string) {
    if (!raw.trim()) return

    if (scanTarget === 'create') {
      setBarcode(raw)
      if (!code.trim()) setCode(raw.slice(0, 32))
      setNotice(p('ברקוד נסרק · {code}', { code: raw }))
      return
    }

    const match = findAssetByCode(assets, raw)
    if (match) {
      setNotice(
        p('נמצא · {code} — {name}', { code: match.code, name: match.name }),
      )
      return
    }

    setBarcode(raw)
    setCode(raw.slice(0, 32))
    setNotice(p('לא נמצא — הברקוד מולא בטופס הוספה'))
  }

  return (
    <Panel flush className="overflow-hidden">
      <PanelHeader title={p('נכסים בחנות')} meta={`#${storeCode}`} />
      <div className="space-y-4 p-4">
        {error ? <ErrorState title={p('שגיאה')} description={error} /> : null}
        {notice ? <Notice tone="progress">{notice}</Notice> : null}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setScanTarget('lookup')
              setScanOpen(true)
            }}
          >
            <ScanBarcode className="h-4 w-4" aria-hidden />
            {p('סריקת ברקוד')}
          </Button>
        </div>

        <form onSubmit={onCreate} className="grid gap-3 md:grid-cols-2">
          <Field label={p('קוד פנימי')} htmlFor="asset-code">
            <Input
              id="asset-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="HVAC-1"
              dir="ltr"
            />
          </Field>
          <Field label={p('ברקוד מוצר')} htmlFor="asset-barcode">
            <div className="flex gap-2">
              <Input
                id="asset-barcode"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="EAN / Code128"
                dir="ltr"
                className="flex-1"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="shrink-0"
                aria-label={p('סריקת ברקוד')}
                onClick={() => {
                  setScanTarget('create')
                  setScanOpen(true)
                }}
              >
                <ScanBarcode className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </Field>
          <Field label={p('שם')} htmlFor="asset-name">
            <Input
              id="asset-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={p('מזגן קדמי')}
            />
          </Field>
          <Field label={p('סוג')} htmlFor="asset-type">
            <Select
              id="asset-type"
              value={assetType}
              onChange={(e) => setAssetType(e.target.value)}
            >
              <option value="hvac">{p('מיזוג')}</option>
              <option value="electrical">{p('חשמל')}</option>
              <option value="optical">{p('ציוד אופטי')}</option>
              <option value="other">{p('אחר')}</option>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Button type="submit" variant="secondary" size="sm" disabled={busy}>
              {busy ? p('שומר…') : p('הוספת נכס')}
            </Button>
          </div>
        </form>

        {loading ? (
          <p className="t-body text-ink-2">{p('טוען…')}</p>
        ) : assets.length === 0 ? (
          <EmptyState
            title={p('אין נכסים')}
            description={p('ציוד לפי סניף — יופיע בטופס דיווח.')}
          />
        ) : (
          <>
            <PhoneList className="md:hidden">
              {assets.map((a) => (
                <AdminRow
                  key={a.id}
                  title={`${a.code} · ${a.name}`}
                  subtitle={
                    a.barcode
                      ? `${a.barcode} · ${assetWhatsAppPrefill(storeCode, a.code)}`
                      : assetWhatsAppPrefill(storeCode, a.code)
                  }
                  trailing={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void onDelete(a.id)}
                    >
                      {p('מחיקה')}
                    </Button>
                  }
                />
              ))}
            </PhoneList>
            <PhoneList className="hidden md:block">
              {assets.map((a) => (
                <AdminRow
                  key={a.id}
                  leading={a.code}
                  title={a.name}
                  subtitle={
                    a.barcode
                      ? `${a.barcode} · ${assetWhatsAppPrefill(storeCode, a.code)}`
                      : assetWhatsAppPrefill(storeCode, a.code)
                  }
                  trailing={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void onDelete(a.id)}
                    >
                      {p('מחיקה')}
                    </Button>
                  }
                />
              ))}
            </PhoneList>
          </>
        )}
      </div>

      <BarcodeScannerModal
        open={scanOpen}
        onOpenChange={setScanOpen}
        onScan={onScan}
        title={
          scanTarget === 'create'
            ? p('סריקת ברקוד לנכס חדש')
            : p('סריקת ברקוד בחנות')
        }
        description={
          scanTarget === 'create'
            ? p('הברקוד ייכנס לשדה ברקוד המוצר.')
            : p('חיפוש נכס קיים בחנות לפי ברקוד / קוד.')
        }
      />
    </Panel>
  )
}
