import { describe, expect, it } from 'vitest'
import { addTask, listTasks, setTaskStatus } from '@/lib/data/ops-ledger'
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
    const task = addTask({
      title: 'בדיקת כיבוי אש',
      storeId: null,
      storeCode: '172',
      assignee: null,
      dueAt: new Date().toISOString(),
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
