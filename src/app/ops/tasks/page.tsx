import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { PhoneFold, PhoneFoldStack } from '@/components/layout/phone-fold'
import { OpsPageHero } from '@/components/ops/ops-page-hero'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { hydrateOpsLedger, persistOpsLedger } from '@/lib/data/ops-db'
import { addTask, listTasks } from '@/lib/data/ops-ledger'
import { ISRAEL_STORES, israelStoreId } from '@/modules/stores/israel-stores'
import { readTaskStatus } from '@/modules/tasks/status'
import { voiceTasksAction } from '../work-actions'
import { TaskBoard } from './task-board'
import { getLocale } from '@/lib/i18n/server'
import { phrase } from '@/lib/i18n/phrases'

export const dynamic = 'force-dynamic'

const REPEAT_PRESETS = [
  { days: 30, label: 'כל 30 יום' },
  { days: 90, label: 'כל 90 יום' },
  { days: 365, label: 'כל שנה (365)' },
] as const

async function addMaintenanceTaskAction(formData: FormData) {
  'use server'
  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) throw new Error('נדרשת כניסה')

  const storeCode = String(formData.get('storeCode') || '').trim()
  const store = ISRAEL_STORES.find((row) => row.code === storeCode)
  const storeId = store
    ? israelStoreId(store.stableKey ?? store.code)
    : storeCode
      ? israelStoreId(storeCode)
      : null

  const customRepeat = Number(formData.get('repeatDaysCustom'))
  const presetRepeat = Number(formData.get('repeatDays'))
  const repeatDays =
    customRepeat > 0 ? customRepeat : presetRepeat > 0 ? presetRepeat : null

  addTask({
    title: String(formData.get('title') || ''),
    storeId,
    storeCode: store?.code || storeCode || null,
    assignee: String(formData.get('assignee') || '') || null,
    dueAt: String(formData.get('due') || '') || null,
    ticketId: String(formData.get('ticketId') || '') || null,
    documentId: null,
    spendId: null,
    needsClarification: !formData.get('assignee') || !formData.get('due'),
    clarification:
      !formData.get('assignee') || !formData.get('due')
        ? 'חסר אחראי או מועד'
        : null,
    repeatDays,
  })
  await persistOpsLedger()
  revalidatePath('/ops/tasks')
  revalidatePath('/ops/dashboard')
  revalidatePath('/ops/documents')
}

export default async function TasksPage() {
  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) redirect('/login')
  await hydrateOpsLedger()
  const tasks = listTasks()
  const counts = { open: 0, doing: 0, waiting: 0, done: 0 }
  for (const task of tasks) counts[readTaskStatus(task)] += 1

  const locale = await getLocale()
  const p = (text: string, vars?: Record<string, string | number>) =>
    phrase(locale, text, vars)
  const statusLine = tasks.length
    ? `${counts.open} ${p('פתוחות')} · ${counts.doing} ${p('בטיפול')} · ${counts.waiting} ${p('ממתינות')} · ${counts.done} ${p('הושלמו')}`
    : p('אין משימות פתוחות')

  return (
    <OpsAppShell>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 overflow-x-clip lg:max-w-4xl">
        <OpsPageHero largeTitle title={p('משימות')} status={statusLine} />
        {tasks.length ? <TaskBoard tasks={tasks} /> : null}
        <PhoneFoldStack>
        <PhoneFold
          title={p('תחזוקה מונעת')}
          summary={p('כיבוי אש · כיול · מחזור')}
        >
          <form action={addMaintenanceTaskAction} className="grid gap-3">
            <p className="t-meta text-ink-2">
              {p(
                'משימת תחזוקה שחוזרת — למשל בדיקת כיבוי אש או כיול ציוד. אחרי השלמה נפתח המופע הבא לפי המחזור.',
              )}
            </p>
            <Field
              label={p('משימה')}
              htmlFor="task-title"
              hint={p('למשל: בדיקת כיבוי אש · כיול אודיומטר')}
            >
              <Input
                id="task-title"
                name="title"
                placeholder={p('בדיקת כיבוי אש')}
                required
              />
            </Field>
            <Field label={p('סניף')} htmlFor="task-store">
              <Select id="task-store" name="storeCode" required defaultValue="">
                <option value="" disabled>
                  {p('בחירת סניף')}
                </option>
                {ISRAEL_STORES.map((store) => (
                  <option key={store.code} value={store.code}>
                    {store.code} · {store.name}
                  </option>
                ))}
              </Select>
            </Field>
            {/* Real storeId is resolved from storeCode in addMaintenanceTaskAction */}
            <Field label={p('אחראי')} htmlFor="task-owner">
              <Input id="task-owner" name="assignee" placeholder={p('שם')} />
            </Field>
            <Field label={p('מועד')} htmlFor="task-due">
              <Input id="task-due" name="due" type="date" />
            </Field>
            <Field
              label={p('מחזור חזרה')}
              htmlFor="task-repeat"
              hint={p('30 יום · 90 יום · שנה — או מספר ימים מותאם')}
            >
              <div className="grid gap-2">
                <Select id="task-repeat" name="repeatDays" defaultValue="365">
                  <option value="">{p('בלי מחזור')}</option>
                  {REPEAT_PRESETS.map((preset) => (
                    <option key={preset.days} value={preset.days}>
                      {p(preset.label)}
                    </option>
                  ))}
                </Select>
                <Input
                  id="task-repeat-custom"
                  name="repeatDaysCustom"
                  type="number"
                  min={1}
                  placeholder={p('או מספר ימים מותאם (אופציונלי)')}
                  aria-label={p('מספר ימים מותאם')}
                />
              </div>
            </Field>
            <Field label={p('תקלה מקושרת')} htmlFor="task-ticket">
              <Input
                id="task-ticket"
                name="ticketId"
                placeholder={p('מספר תקלה, אם יש')}
              />
            </Field>
            <Button type="submit">{p('הוספת משימת תחזוקה')}</Button>
          </form>
        </PhoneFold>
        <PhoneFold
          title={p('פיצול מהקלטה')}
          summary={p('כמה משימות במשפט')}
        >
          <form action={voiceTasksAction} className="grid gap-3">
            <Field
              label={p('פיצול מהקלטה')}
              htmlFor="task-transcript"
              hint={p('כמה משימות במשפט אחד, מופרדות ב«וגם».')}
            >
              <Input
                id="task-transcript"
                name="transcript"
                placeholder={p('לבדוק מזגן בסניף 6018 וגם להזמין מנעולן')}
                required
              />
            </Field>
            <Button type="submit" variant="secondary">
              {p('פיצול מהקלטה')}
            </Button>
          </form>
        </PhoneFold>
        </PhoneFoldStack>
      </div>
    </OpsAppShell>
  )
}
