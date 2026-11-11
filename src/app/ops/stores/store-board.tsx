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
  /** Open-tickets queue for this store (same slice as /ops/tickets). */
  href?: string
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
    <div className="flex flex-col gap-4">
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
          <ul className="grid grid-cols-2 gap-2 p-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {group.stores.map((store) => (
              <li key={store.id}>
                <Link
                  href={
                    store.href ??
                    `/ops/tickets?view=open&store=${encodeURIComponent(store.code)}`
                  }
                  aria-label={`${store.name}, ${store.code}`}
                  className={cn(
                    'flex h-full min-h-[5.5rem] flex-col justify-between gap-2 rounded-[var(--radius-md)] border border-border/80 px-3 py-3 transition-colors hover:border-[color-mix(in_srgb,var(--tenant)_35%,var(--border))] hover:bg-[var(--tenant-soft)]',
                    store.inactive && 'opacity-60',
                    store.openCount > 0 ? 'bg-surface' : 'bg-surface-sunken',
                  )}
                >
                  <span className="min-w-0">
                    <span className="t-body-strong block truncate text-ink">
                      {store.name}
                    </span>
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
