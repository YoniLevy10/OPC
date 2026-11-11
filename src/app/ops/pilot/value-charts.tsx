import { formatIls } from '@/modules/spend/true-cost'
import type { ValueBar } from '@/modules/pilot/story'

export function ValueBars({
  title,
  bars,
}: {
  title: string
  bars: ValueBar[]
}) {
  const active = bars.filter((bar) => bar.amount > 0)
  const max = Math.max(...active.map((bar) => bar.amount), 1)
  if (active.length === 0) return null

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="t-section text-ink">{title}</figcaption>
      <ul className="flex flex-col gap-2.5">
        {active.map((bar) => (
          <li
            key={bar.label}
            className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3"
          >
            <span className="t-meta truncate text-ink-2">{bar.label}</span>
            <span
              className="h-2 overflow-hidden rounded-full"
              style={{
                background:
                  'color-mix(in srgb, var(--tenant-soft) 55%, transparent)',
              }}
            >
              <span
                className="block h-full rounded-full bg-[var(--tenant)]"
                style={{
                  width: `${Math.max(6, Math.round((bar.amount / max) * 100))}%`,
                }}
              />
            </span>
            <span className="t-meta t-num text-ink">{formatIls(bar.amount)}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

export function MoneyTiles({
  bars,
}: {
  bars: ValueBar[]
}) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
      {bars.map((bar) => (
        <li
          key={bar.label}
          className="flex min-h-[4.75rem] flex-col justify-between rounded-[var(--radius-lg)] border border-border bg-surface px-3.5 py-3"
        >
          <span className="t-meta text-ink-3">{bar.label}</span>
          <span
            className={`t-num mt-2 block text-[1.375rem] font-semibold leading-none tracking-tight ${
              bar.amount > 0 ? 'text-ink' : 'text-ink-3'
            }`}
          >
            {formatIls(bar.amount)}
          </span>
        </li>
      ))}
    </ul>
  )
}
