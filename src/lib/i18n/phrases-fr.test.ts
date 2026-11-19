import { describe, expect, it } from 'vitest'
import { phrase } from '@/lib/i18n/phrases'

const HEBREW = /[\u0590-\u05FF]/

/** Smoke: critical Ari / ops chrome keys must resolve to non-Hebrew in FR. */
const CRITICAL = [
  'הכל שקט',
  'תקלות פתוחות',
  'מחכות לאישור',
  'פעולות פתוחות',
  'הנה הבית — לוח הבקרה שלך.',
  'הנה תור התקלות.',
  'אין תקלה דחופה שמחכה לאישור.',
  'למסך',
  'אין מענה קולי. התשובה בהודעה הזו.',
  'שמירת קטגוריה',
]

describe('French phrase catalog', () => {
  it('translates critical Ari / ops keys without leftover Hebrew', () => {
    for (const key of CRITICAL) {
      const fr = phrase('fr', key)
      expect(fr, key).not.toMatch(HEBREW)
      expect(fr.length).toBeGreaterThan(0)
    }
  })
})
