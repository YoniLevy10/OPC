import { describe, expect, it } from 'vitest'
import { addTask, listTasks, setTaskStatus } from '@/lib/data/ops-ledger'
import { israelStoreId } from '@/modules/stores/israel-stores'
import { readTaskStatus, taskStatusMoves } from './status'

describe('readTaskStatus', () => {
  it('keeps an explicit status', () => {
    expect(readTaskStatus({ done: false, needsClarification: false, status: 'doing' })).toBe('doing')
  })

  it('derives waiting and done from the older flags', () => {
    expect(readTaskStatus({ done: true, needsClarification: false })).toBe('done')
    expect(readTaskStatus({ done: false, needsClarification: true })).toBe('waiting')
    expect(readTaskStatus({ done: false, needsClarification: false })).toBe('open')
  })
})

describe('recurring maintenance', () => {
  it('opens the next task when a repeating one is done', () => {
    const storeCode = '172'
    const storeId = israelStoreId(storeCode)
    const dueAt = new Date().toISOString()
    const task = addTask({
      title: 'בדיקת כיבוי אש',
      storeId,
      storeCode,
      assignee: null,
      dueAt,
      ticketId: null,
      documentId: null,
      spendId: null,
      needsClarification: false,
      clarification: null,
      repeatDays: 30,
    })
    setTaskStatus(task.id, 'done')
    const open = listTasks().filter((row) => row.title === 'בדיקת כיבוי אש' && !row.done)
    expect(open).toHaveLength(1)
    expect(open[0]?.repeatDays).toBe(30)
    expect(open[0]?.storeId).toBe(storeId)
    expect(open[0]?.storeCode).toBe(storeCode)
    expect(task.status).toBe('done')
    expect(task.nextOpened).toBe(true)
    expect(open[0]?.status).toBe('open')
    expect(open[0]?.nextOpened).toBe(false)
    const nextDue = open[0]?.dueAt ? new Date(open[0].dueAt).getTime() : NaN
    const expected = new Date()
    expected.setDate(expected.getDate() + 30)
    expect(Math.abs(nextDue - expected.getTime())).toBeLessThan(60_000)
    // Re-saving a completed recurring task must not open another successor.
    setTaskStatus(task.id, 'done')
    expect(listTasks().filter((row) => row.title === 'בדיקת כיבוי אש' && !row.done)).toHaveLength(1)
  })

  it('carries storeId into the next calibration cycle instance', () => {
    const storeCode = '6018'
    const storeId = israelStoreId(storeCode)
    const task = addTask({
      title: 'כיול אודיומטר',
      storeId,
      storeCode,
      assignee: 'ארי',
      dueAt: new Date().toISOString(),
      ticketId: null,
      documentId: null,
      spendId: null,
      needsClarification: false,
      clarification: null,
      repeatDays: 365,
    })
    setTaskStatus(task.id, 'done')
    const next = listTasks().find((row) => row.title === 'כיול אודיומטר' && !row.done)
    expect(next?.storeId).toBe(storeId)
    expect(next?.storeCode).toBe(storeCode)
    expect(next?.repeatDays).toBe(365)
    expect(task.nextOpened).toBe(true)
  })
})

describe('taskStatusMoves', () => {
  it('offers a different set of buttons for each status', () => {
    expect(taskStatusMoves('open').map((row) => row.label)).toEqual(['בטיפול', 'ממתין', 'הושלם'])
    expect(taskStatusMoves('doing').map((row) => row.status)).toEqual(['done', 'waiting', 'open'])
    expect(taskStatusMoves('waiting')[0]?.label).toBe('חזרה לטיפול')
    expect(taskStatusMoves('done').map((row) => row.label)).toEqual(['פתיחה מחדש'])
  })
})
