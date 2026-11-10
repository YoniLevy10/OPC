import Link from 'next/link'
import { cn } from '@/lib/utils'

export type StoreCardModel = {
  id: string
  code: string
  name: string
  city: string | null
  inactive: boolean
  openCount: number
  status: string
}

export type StoreGroupModel = {
  code: string
  label: string
  stores: StoreCardModel[]
}

function showCity(name: string, city: string | null): boolean {
  const place = city?.trim()
  if (!place) return false
  return !name.includes(place)
}

export function StoreBoard({ groups }: { groups: StoreGroupModel[] }) {
  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      {groups.map((group) => (
        <section
          key={group.code}
          aria-labelledby={`region-${group.code}`}
          className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface shadow-[var(--shadow-1)]"
        >
          <header className="flex items-end justify-between gap-3 border-b border-border px-4 py-3">
            <h2 id={`region-${group.code}`} className="t-section text-ink">
              {group.label}
            </h2>
            <span className="t-meta t-num text-ink-3">{group.stores.length}</span>
          </header>
          <ul>
            {group.stores.map((store) => (
              <li key={store.id} className="border-b border-border last:border-b-0">
                <Link
                  href={`/ops/stores/${encodeURIComponent(store.code)}`}
                  aria-label={`${store.name}, ${store.code}`}
                  className={cn(
                    'flex items-center justify-between gap-3 px-4 py-3',
                    store.inactive && 'opacity-60',
                    store.openCount > 0 ? 'bg-surface' : 'bg-surface-sunken',
                  )}
                >
                  <span className="min-w-0">
                    <span className="t-body-strong block truncate text-ink">{store.name}</span>
                    <span className="t-meta t-num block text-ink-3">
                      {store.code}
                      {showCity(store.name, store.city) ? ` · ${store.city}` : ''}
                    </span>
                  </span>
                  <span
                    className={cn(
                      't-caption shrink-0',
                      store.openCount > 0
                        ? 'font-semibold text-[var(--tenant)]'
                        : 'text-ink-3',
                    )}
                  >
                    {store.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
