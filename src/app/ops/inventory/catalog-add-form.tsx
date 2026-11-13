'use client'

import { useState } from 'react'
import { ScanBarcode } from 'lucide-react'
import { BarcodeScannerModal } from '@/components/assets/barcode-scanner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { addItemAction } from '../work-actions'
import { usePhrase } from '@/components/i18n/locale-provider'

export function CatalogAddForm() {
  const p = usePhrase()
  const [sku, setSku] = useState('')
  const [scanOpen, setScanOpen] = useState(false)

  return (
    <>
      <form action={addItemAction} className="flex flex-wrap items-center gap-2">
        <Input name="name" placeholder={p('שם פריט')} required />
        <Input
          name="sku"
          placeholder={p('מק״ט')}
          required
          value={sku}
          onChange={(event) => setSku(event.target.value)}
          dir="ltr"
          className="min-w-[8rem] flex-1"
        />
        <Button
          type="button"
          variant="secondary"
          aria-label={p('סריקת מק״ט במצלמה')}
          onClick={() => setScanOpen(true)}
        >
          <ScanBarcode className="h-4 w-4" aria-hidden />
          {p('סריקה')}
        </Button>
        <Button type="submit">{p('הוספה לקטלוג')}</Button>
      </form>
      <BarcodeScannerModal
        open={scanOpen}
        onOpenChange={setScanOpen}
        title={p('סריקת מק״ט')}
        description={p('כוונו את המצלמה לברקוד שעל החלק.')}
        onScan={(value) => setSku(value)}
      />
    </>
  )
}
