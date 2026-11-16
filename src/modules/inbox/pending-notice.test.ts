import { describe, expect, it } from 'vitest'
import { mergePendingNotice } from './service'

describe('mergePendingNotice', () => {
  it('stores pending_notice and keeps other draft keys', () => {
    expect(
      mergePendingNotice({ ratingTicketId: 't1' }, 'מה שלומך שירלי'),
    ).toEqual({
      ratingTicketId: 't1',
      pending_notice: 'מה שלומך שירלי',
    })
  })

  it('replaces a previous pending_notice', () => {
    expect(
      mergePendingNotice({ pending_notice: 'ישן' }, ' חדש '),
    ).toEqual({ pending_notice: 'חדש' })
  })
})
