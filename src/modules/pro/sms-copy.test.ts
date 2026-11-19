import { describe, expect, it } from 'vitest'
import {
  buildProPaymentSms,
  PRO_RECEIPT_EMAIL,
} from './sms-copy'

describe('buildProPaymentSms', () => {
  it('includes bank transfer within 10 days and Ari receipt email', () => {
    const text = buildProPaymentSms({
      storeName: 'כרמיאל',
      storeCode: '6018',
      faultLines: ['מזגן לא מקרר'],
    })
    expect(text).toMatch(/העברה בנקאית/)
    expect(text).toMatch(/10 ימים/)
    expect(text).toContain(PRO_RECEIPT_EMAIL)
    expect(text).toContain('כרמיאל')
    expect(text).toContain('מזגן לא מקרר')
  })
})
