import { describe, expect, it } from 'vitest'
import { formatPersonalRating, parsePersonalRating } from './personal-rating'

describe('personal rating notes encoding', () => {
  it('round-trips rating and note', () => {
    const notes = formatPersonalRating(4, 'עובד מהר')
    expect(notes).toContain('[דירוג אישי: 4]')
    expect(parsePersonalRating(notes)).toEqual({
      rating: 4,
      note: 'עובד מהר',
    })
  })

  it('treats plain notes as note-only', () => {
    expect(parsePersonalRating('רק הערה')).toEqual({
      rating: 0,
      note: 'רק הערה',
    })
  })
})
