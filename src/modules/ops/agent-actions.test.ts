import { beforeEach, describe, expect, it } from 'vitest'
import { listTasks, resetOpsLedger } from '@/lib/data/ops-ledger'
import { memListTickets } from '@/lib/data/memory-store'
import { actForAri, parseDueAt, parseRepeatDays } from './agent-actions'

process.env.MAINTAINOS_FORCE_MEMORY = '1'

const aboutHaifa = [
  {
    role: 'assistant' as const,
    text: 'ארי, חיפה הרצל דורש אותך: המדפסת של המרשמים תקועה. אחת שם כבר חורגת.',
  },
]

describe('actForAri', () => {
  beforeEach(() => {
    resetOpsLedger()
  })

  it('ignores a question', async () => {
    expect(await actForAri({ message: 'איזה סניף הכי דחוף?' })).toBeNull()
  })

  it('writes a task, and a second copy of the same line stays one task', async () => {
    const first = await actForAri({ message: 'תפתח משימה לבדוק את המנעול בחדרה' })
    expect(first?.reply).toContain('רשמתי משימה')
    expect(first?.reply).toContain('חדרה')
    expect(first?.links[0]?.href).toMatch(/^\/ops\/tasks#task-/)
    expect(first?.links[0]?.label).toBe('למשימה')
    expect(listTasks().some((task) => task.title.includes('מנעול') && task.storeCode === '6005')).toBe(
      true,
    )
    const again = await actForAri({ message: 'תפתח משימה לבדוק את המנעול בחדרה' })
    expect(again?.reply).toContain('כבר רשומה')
    expect(again?.links[0]?.label).toBe('למשימה')
  })

  it('writes a recurring maintenance task with due + repeatDays', async () => {
    const reply = await actForAri({
      message: 'תפתח משימה כיול אודיומטר בחדרה כל 30 ימים ל-2026-12-01',
    })
    expect(reply?.reply).toContain('רשמתי משימה')
    expect(reply?.reply).toContain('חוזר כל 30 ימים')
    expect(reply?.reply).toContain('2026-12-01')
    const task = listTasks().find((row) => row.title.includes('אודיומטר'))
    expect(task?.storeCode).toBe('6005')
    expect(task?.storeId).toBeTruthy()
    expect(task?.repeatDays).toBe(30)
    expect(task?.dueAt?.startsWith('2026-12-01')).toBe(true)
  })

  it('prefers create_task over fire-permit intake when both match', async () => {
    const reply = await actForAri({
      message: 'תפתח משימה לבדוק כיבוי אש בחדרה כל 90 ימים',
    })
    expect(reply?.reply).toContain('רשמתי משימה')
    expect(reply?.reply).toContain('חוזר כל 90 ימים')
    expect(reply?.reply).not.toContain('רשמתי אישור')
    expect(reply?.links[0]?.href).toMatch(/^\/ops\/tasks#task-/)
    const task = listTasks().find((row) => row.title.includes('כיבוי אש'))
    expect(task?.repeatDays).toBe(90)
    expect(task?.storeCode).toBe('6005')
  })

  it('opens a fault at the store he names', async () => {
    const before = memListTickets().length
    const reply = await actForAri({
      message: 'תפתח תקלה בחדרה הנזילה בברז',
      open: [],
    })
    expect(reply?.reply).toContain('פתחתי תקלה בחדרה')
    expect(reply?.reply).toContain('OC-')
    expect(reply?.reply).toContain('לאשר')
    expect(reply?.reply).toContain('טווח משוער לתיקון')
    expect(reply?.links[0]?.href).toMatch(/^\/ops\/tickets\//)
    expect(reply?.links[0]?.label).toMatch(/^OC-/)
    expect(memListTickets().length).toBe(before + 1)
    const created = memListTickets()[0]
    expect(created?.category).toBe('plumbing')
    expect(created?.priority).toBe('high')
  })

  it('classifies HVAC urgency from the fault text', async () => {
    await actForAri({
      message: 'תפתח תקלה בחדרה המזגן לא מקרר',
      open: [],
    })
    const created = memListTickets()[0]
    expect(created?.category).toBe('hvac')
    expect(created?.priority).toBe('high')
  })

  it('uses the store already in the conversation and does not open the same fault twice', async () => {
    const reply = await actForAri({
      message: 'תפתח על זה תקלה',
      history: aboutHaifa,
      open: [
        {
          id: 'ticket-printer',
          storeName: 'חיפה הרצל',
          summary: 'המדפסת של המרשמים תקועה',
          displayNumber: 'OC-18008',
        },
      ],
    })
    expect(reply?.reply).toContain('כבר פתוחה')
    expect(reply?.reply).toContain('OC-18008')
    expect(reply?.links[0]).toEqual({ href: '/ops/tickets/ticket-printer', label: 'OC-18008' })
  })

  it('asks which Haifa when the city alone is not a store', async () => {
    const reply = await actForAri({ message: 'תפתח תקלה בחיפה המזגן לא מקרר' })
    expect(reply?.reply).toContain('חיפה הרצל')
    expect(reply?.reply).toContain('חיפה ביג')
  })

  it('turns the same conversation into a task', async () => {
    const reply = await actForAri({
      message: 'תפתח על זה משימה',
      history: aboutHaifa,
    })
    expect(reply?.reply).toContain('רשמתי משימה')
    expect(reply?.reply).toContain('המדפסת')
    expect(reply?.reply).toContain('חיפה הרצל')
    expect(reply?.links[0]?.label).toBe('למשימה')
  })
})

describe('parseDueAt / parseRepeatDays', () => {
  it('reads tomorrow and day offsets', () => {
    const now = new Date('2026-11-11T12:00:00.000Z')
    expect(parseDueAt('מחר', now)?.startsWith('2026-11-12')).toBe(true)
    expect(parseDueAt('בעוד 3 ימים', now)?.startsWith('2026-11-14')).toBe(true)
    expect(parseDueAt('ל-2026-12-01')?.startsWith('2026-12-01')).toBe(true)
  })

  it('reads Agent A cadence presets', () => {
    expect(parseRepeatDays('כל 30 ימים')).toBe(30)
    expect(parseRepeatDays('כל שנה')).toBe(365)
    expect(parseRepeatDays('כל חודש')).toBe(30)
    expect(parseRepeatDays('חוזר כל 90 ימים')).toBe(90)
  })
})
