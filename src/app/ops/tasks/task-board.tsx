'use client'

import Link from 'next/link'
import { ListFinder } from '@/components/ops/list-finder'
import { Button } from '@/components/ui/button'
import type { OpsTask } from '@/lib/data/ops-ledger'
import { ISRAEL_STORES } from '@/modules/stores/israel-stores'
import {
  TASK_STATUS_LABEL,
  readTaskStatus,
  taskStatusMoves,
  type TaskStatus,
} from '@/modules/tasks/status'
import { setTaskStatusAction } from '../work-actions'
import { PhoneFold, PhoneFoldStack } from '@/components/layout/phone-fold'
import { useLocale, usePhrase } from '@/components/i18n/locale-provider'
import type { Locale } from '@/lib/i18n/locale'

export function TaskBoard({ tasks, now = new Date() }: { tasks: OpsTask[]; now?: Date }) {
  const p = usePhrase()
  const ranked = [...tasks].sort((a, b) => rank(a, now) - rank(b, now) || dueTime(a) - dueTime(b))
  const open = ranked.filter((task) => readTaskStatus(task) !== 'done')
  const done = ranked.filter((task) => readTaskStatus(task) === 'done')

  return (
    <ListFinder
      placeholder={p('חיפוש משימה או סניף')}
      one={p('משימה אחת')}
      many={p('משימות')}
    >
      <PhoneFoldStack>
      <div className="store-stack">
        {open.map((task) => (
          <TaskCard key={task.id} task={task} tasks={tasks} now={now} />
        ))}
        {done.map((task) => (
          <TaskCard key={task.id} task={task} tasks={tasks} now={now} />
        ))}
      </div>
      </PhoneFoldStack>
    </ListFinder>
  )
}

function TaskCard({ task, tasks, now }: { task: OpsTask; tasks: OpsTask[]; now: Date }) {
  const p = usePhrase()
  const { locale } = useLocale()
  const status = readTaskStatus(task)
  const store = ISRAEL_STORES.find((row) => row.code === task.storeCode)
  const overdue = status !== 'done' && task.dueAt != null && new Date(task.dueAt).getTime() < now.getTime()
  const moves = taskStatusMoves(status)
  const repeatDays = task.repeatDays && task.repeatDays > 0 ? task.repeatDays : null
  const next = findNextInstance(task, tasks)
  const storeLabel = store?.name || p('בלי סניף')

  return (
    <article
      data-find-group
      data-find={`${task.title} ${store?.name || ''} ${task.storeCode || ''} ${task.assignee || ''} ${p(TASK_STATUS_LABEL[status])}`}
      id={`task-${task.id}`}
      className={
        overdue
          ? 'max-md:contents md:sheet md:scroll-mt-24 md:overflow-hidden md:rounded-[var(--radius-lg)] md:border md:border-border md:bg-surface md:edge md:edge-overdue'
          : 'max-md:contents md:sheet md:scroll-mt-24 md:overflow-hidden md:rounded-[var(--radius-lg)] md:border md:border-border md:bg-surface'
      }
    >
      <PhoneFold
        title={task.title}
        summary={`${storeLabel} · ${formatDue(task.dueAt, locale, p)}`}
      >
      <div className="flex flex-col gap-2 px-4 py-3 max-md:px-0 max-md:py-0">
        <p className="t-meta hidden text-ink-2 md:block">
          {storeLabel}
          {task.storeCode ? ` · ${task.storeCode}` : ''}
          {task.assignee ? ` · ${task.assignee}` : ` · ${p('בלי אחראי')}`}
        </p>
        <h2 className={`hidden md:block ${status === 'done' ? 't-body text-ink-3 line-through' : 't-body text-ink'}`}>
          {task.title}
        </h2>
        <span aria-hidden className="clay-rule hidden md:block" />
        <p className="t-meta text-ink-2">
          <StatusChip status={status} overdue={overdue} />
          {repeatDays ? (
            <>
              {' · '}
              <span className="inline-flex rounded-full border border-border px-2 py-0.5 text-ink">
                {p('חוזר כל {days} ימים', { days: repeatDays })}
              </span>
            </>
          ) : null}
          <span className="hidden md:inline">
            {' · '}
            {formatDue(task.dueAt, locale, p)}
            {overdue ? ` · ${p('באיחור')}` : ''}
          </span>
        </p>
        {status === 'done' && task.nextOpened && next ? (
          <p className="t-meta text-ink">
            {p('נפתח הבא ל־{date}', { date: formatDueDate(next.dueAt, locale, p) })}
            {' · '}
            <Link href={`#task-${next.id}`} className="underline">
              {p('למשימה הבאה')}
            </Link>
          </p>
        ) : status === 'done' && task.nextOpened ? (
          <p className="t-meta text-ink">{p('נפתח המופע הבא במחזור')}</p>
        ) : null}
        {task.clarification ? <p className="t-meta text-ink">{task.clarification}</p> : null}
        {task.spendId ? (
          <Link href="/ops/approvals" className="t-meta text-ink underline">
            {p('לבקשת הכסף')}
          </Link>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-2">
          {moves.map((move) => (
            <form key={move.status} action={setTaskStatusAction}>
              <input type="hidden" name="id" value={task.id} />
              <input type="hidden" name="status" value={move.status} />
              <Button type="submit" size="sm" variant={move.tone} aria-label={`${p(move.label)} · ${task.title}`}>
                {p(move.label)}
              </Button>
            </form>
          ))}
        </div>
      </div>
      </PhoneFold>
    </article>
  )
}

function findNextInstance(task: OpsTask, tasks: OpsTask[]): OpsTask | null {
  if (!task.nextOpened || !task.repeatDays) return null
  const created = new Date(task.createdAt).getTime()
  const siblings = tasks.filter((row) => {
    if (row.id === task.id) return false
    if (row.title !== task.title) return false
    if (readTaskStatus(row) === 'done') return false
    if ((row.repeatDays ?? null) !== (task.repeatDays ?? null)) return false
    if ((row.storeCode || '') !== (task.storeCode || '')) return false
    if ((row.storeId || '') !== (task.storeId || '')) return false
    return new Date(row.createdAt).getTime() >= created
  })
  siblings.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  return siblings[0] ?? null
}

function StatusChip({ status, overdue }: { status: TaskStatus; overdue: boolean }) {
  const p = usePhrase()
  const hot = overdue || status === 'waiting'
  return (
    <span
      className={
        hot
          ? 'inline-flex rounded-full border border-[var(--tenant-line)] bg-[var(--tenant-soft)] px-2 py-0.5 font-semibold text-[var(--tenant)]'
          : 'inline-flex rounded-full border border-border px-2 py-0.5 text-ink'
      }
    >
      {p(TASK_STATUS_LABEL[status])}
    </span>
  )
}

function rank(task: OpsTask, now: Date): number {
  const status = readTaskStatus(task)
  if (status === 'done') return 4
  if (task.dueAt && new Date(task.dueAt).getTime() < now.getTime()) return 0
  if (status === 'waiting') return 1
  if (status === 'doing') return 2
  return 3
}

function dueTime(task: OpsTask): number {
  if (!task.dueAt) return Number.POSITIVE_INFINITY
  const time = new Date(task.dueAt).getTime()
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
}

type PhraseFn = (hebrew: string, vars?: Record<string, string | number>) => string

function localeTag(locale: Locale): string {
  if (locale === 'he') return 'he-IL'
  if (locale === 'fr') return 'fr-FR'
  return 'en-GB'
}

function formatDue(iso: string | null, locale: Locale, p: PhraseFn): string {
  if (!iso) return p('בלי מועד')
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return p('בלי מועד')
  return date.toLocaleString(localeTag(locale), {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDueDate(iso: string | null, locale: Locale, p: PhraseFn): string {
  if (!iso) return p('בלי מועד')
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return p('בלי מועד')
  return date.toLocaleDateString(localeTag(locale), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}
