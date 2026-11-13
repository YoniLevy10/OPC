import { Panel } from '@/components/ui/primitives'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { listCatalog, listStock } from '@/lib/data/ops-ledger'
import { availableQuantity } from '@/modules/inventory/stock'
import { moveStockAction } from '../work-actions'
import { CatalogAddForm } from './catalog-add-form'
import { getLocale } from '@/lib/i18n/server'
import { phrase } from '@/lib/i18n/phrases'

export async function PartsStock() {
  const locale = await getLocale()
  const p = (text: string, vars?: Record<string, string | number>) =>
    phrase(locale, text, vars)

  const catalog = listCatalog()
  const stock = listStock()

  return (
    <div id="parts" className="flex flex-col gap-4">
      <div>
        <h2 className="t-section text-ink">{p('במחסן')}</h2>
        <p className="t-meta mt-1 text-ink-2">
          {p('כמות של חלקים. סורקים מק״ט במצלמה או מקלידים.')}
        </p>
      </div>
      <Panel elevated>
        <CatalogAddForm />
      </Panel>
      {catalog.map((item) => (
        <Panel key={item.id} elevated>
          <p className="t-body">
            {item.name} · {item.sku}
          </p>
          <p className="t-meta text-ink-2">
            {p('זמין במחסן: {qty}', {
              qty: availableQuantity(stock, item.id, 'warehouse'),
            })}
            {stock.some((row) => row.itemId === item.id && !row.verified)
              ? p(' · כמות שטרם אומתה')
              : ''}
          </p>
          <form action={moveStockAction} className="mt-2 flex flex-wrap gap-2">
            <input type="hidden" name="itemId" value={item.id} />
            <select
              name="kind"
              className="h-11 rounded-md border border-border px-2"
              aria-label={p('סוג תנועה')}
            >
              <option value="in">{p('כניסה למלאי')}</option>
              <option value="out">{p('יציאה ממלאי')}</option>
              <option value="transfer">{p('העברה')}</option>
            </select>
            <Input name="from" placeholder={p('מאיפה')} defaultValue="warehouse" />
            <Input name="to" placeholder={p('לאן')} />
            <Input name="quantity" type="number" placeholder={p('כמות')} required />
            <Input name="ticketId" placeholder={p('תקלה')} />
            <Button type="submit" size="sm">
              {p('תנועה')}
            </Button>
          </form>
        </Panel>
      ))}
    </div>
  )
}
