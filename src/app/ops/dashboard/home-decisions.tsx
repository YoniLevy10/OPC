import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Tx } from '@/components/i18n/tx'
import type { OpsAlert } from '@/modules/alerts/types'
import type { HomeDecisionModel } from '@/modules/ops/home-decisions'

const PREVIEW_COUNT = 4

function DecisionRow({ item }: { item: OpsAlert }) {
  return (
    <li className="flex min-w-0 flex-col gap-3 border-b border-border px-4 py-4 last:border-b-0 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="t-caption mb-1 text-ink-3">{item.storeName}{item.storeCode && item.storeCode !== '—' ? ` · ${item.storeCode}` : ''}</p>
        <p className="t-body-strong break-words text-ink">{item.title}</p>
        <p className="t-meta mt-1 break-words text-ink-2">{item.reasons.join(' · ')}</p>
        <p className="t-caption mt-1 text-ink-3"><Tx text="באחריות" />: {item.owner}</p>
      </div>
      <Button asChild variant="primary" size="sm" className="shrink-0 max-sm:w-full">
        <Link href={item.href}>{item.nextAction}</Link>
      </Button>
    </li>
  )
}

/** The full action list lives on home; no extra tab is needed to find it. */
export function HomeDecisions({ model }: { model: HomeDecisionModel }) {
  const preview = model.decisions.slice(0, PREVIEW_COUNT)
  const rest = model.decisions.slice(PREVIEW_COUNT)
  return (
    <section id="decisions" aria-labelledby="home-decisions-title" className="scroll-mt-4">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 id="home-decisions-title" className="t-section text-ink"><Tx text="הפעולה הבאה שלך" /></h2>
        <span className="t-caption t-num text-ink-2">{model.decisions.length}</span>
      </header>
      {model.partialFailure ? (
        <p role="alert" className="t-meta mb-3 rounded-[var(--radius-md)] border border-[var(--signal-warning-line)] bg-[var(--signal-warning-soft)] px-4 py-3 text-ink">
          <Tx text="חלק מהנתונים לא נטענו. הרשימה חלקית; אי אפשר לקבוע שאין פעולות פתוחות." />
        </p>
      ) : null}
      {preview.length > 0 ? (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface">
          <ul>{preview.map((item) => <DecisionRow key={item.id} item={item} />)}</ul>
          {rest.length > 0 ? (
            <details className="border-t border-border">
              <summary className="t-body-strong cursor-pointer px-4 py-3 text-ink focus-visible:outline-2 focus-visible:outline-[var(--tenant)]">
                <Tx text="כל הפעולות" /> <span className="t-num">({model.decisions.length})</span>
              </summary>
              <ul>{rest.map((item) => <DecisionRow key={item.id} item={item} />)}</ul>
            </details>
          ) : null}
        </div>
      ) : !model.partialFailure ? (
        <p className="t-body rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-5 text-ink-2"><Tx text="אין כרגע החלטות שמחכות לך." /></p>
      ) : null}
      {model.waiting.length > 0 ? (
        <details className="mt-3 rounded-[var(--radius-lg)] border border-border bg-surface">
          <summary className="t-body cursor-pointer px-4 py-3 text-ink-2 focus-visible:outline-2 focus-visible:outline-[var(--tenant)]">
            <Tx text="במעקב — החנות או איש המקצוע ממשיכים מכאן" /> <span className="t-num">({model.waiting.length})</span>
          </summary>
          <ul className="divide-y divide-border">
            {model.waiting.map((item) => (
              <li key={item.id} className="px-4 py-3">
                <Link href={item.href} className="block min-w-0">
                  <p className="t-body-strong break-words text-ink">{item.title}</p>
                  <p className="t-meta mt-1 text-ink-2">{item.storeName} · {item.nextAction}</p>
                  <p className="t-caption mt-1 text-ink-3"><Tx text="באחריות" />: {item.owner}</p>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}
