import { describe, expect, it } from 'vitest'
import {
  proPortalPath,
  signProPortalToken,
  verifyProPortalToken,
} from '@/modules/pro/token'
import { buildProAssignmentSms } from '@/modules/pro/sms-copy'

describe('pro portal token', () => {
  it('signs and verifies a phone token', () => {
    const token = signProPortalToken('050-1234567')
    const payload = verifyProPortalToken(token)
    expect(payload?.phone).toBe('972501234567')
    expect(proPortalPath(token)).toContain('/pro?t=')
  })

  it('rejects tampered tokens', () => {
    const token = signProPortalToken('0501234567')
    expect(verifyProPortalToken(`${token}x`)).toBeNull()
    expect(verifyProPortalToken('not.a.token')).toBeNull()
  })
})

describe('buildProAssignmentSms', () => {
  it('formats full multi-line SMS with manager name, phone, and portal url', () => {
    const text = buildProAssignmentSms({
      storeName: 'ניסיון',
      storeCode: '100',
      managerName: 'אריאל לוי',
      managerPhone: '054-8174688',
      faultLines: [
        'יש צורך בתיקון דלת הכניסה.',
        'ידית שבורה בדלת כניסה לחנות ואי אפשר לפתוח אותה מהחוץ בלי מפתח חירום',
      ],
      portalUrl: 'https://example.com/pro?t=abc',
    })
    expect(text).toContain('Optical Center · חנות: ניסיון (#100)')
    expect(text).not.toContain('כתובת:')
    expect(text).toContain('2 תקלות:')
    expect(text).toContain('- יש צורך בתיקון דלת הכניסה.')
    expect(text).toContain(
      '- ידית שבורה בדלת כניסה לחנות ואי אפשר לפתוח אותה מהחוץ בלי מפתח חירום',
    )
    expect(text).not.toMatch(/#?OC-\d+/i)
    expect(text).toContain('מנהל חנות: אריאל לוי')
    expect(text).toContain('טלפון: 054-8174688')
    expect(text).toContain('קישור:')
    expect(text).toContain('https://example.com/pro?t=abc')
    expect(text.endsWith('https://example.com/pro?t=abc')).toBe(true)
  })

  it('uses singular תקלה for one fault and keeps long descriptions intact', () => {
    const long =
      'ידית שבורה בדלת כניסה לחנות ואי אפשר לפתוח אותה מהחוץ בלי מפתח חירום וצריך להחליף את כל המנגנון'
    const url = `https://example.com/pro?t=${'x'.repeat(200)}`
    const text = buildProAssignmentSms({
      storeName: 'תל אביב שינקין',
      storeCode: '6004',
      managerName: 'אמיר',
      managerPhone: '050-3393839',
      faultLines: [`#OC-18183 — ${long}`],
      portalUrl: url,
    })
    expect(text).toContain('1 תקלה:')
    expect(text).toContain(`- ${long}`)
    expect(text).not.toMatch(/…/)
    expect(text.endsWith(url)).toBe(true)
  })

  it('strips internal OC codes but does not truncate fault detail', () => {
    const text = buildProAssignmentSms({
      storeName: 'חולון',
      storeCode: '6010',
      managerName: null,
      managerPhone: '050-5884881',
      faultLines: [
        '#OC-18182 — מזגן באולם המכירות לא מקרר בכלל וצריך טכנאי דחוף',
      ],
      portalUrl: 'https://example.com/pro?t=tok',
    })
    expect(text).not.toMatch(/#?OC-\d+/i)
    expect(text).toContain(
      'מזגן באולם המכירות לא מקרר בכלל וצריך טכנאי דחוף',
    )
    expect(text).toContain('טלפון: 050-5884881')
    expect(text).not.toContain('מנהל חנות:')
  })

  it('includes store address when provided', () => {
    const text = buildProAssignmentSms({
      storeName: 'ירושלים כיכר ציון',
      storeCode: '6001',
      storeCity: 'ירושלים',
      storeAddress: 'כיכר ציון',
      managerName: 'קרן',
      managerPhone: '054-7718456',
      faultLines: ['דלת לא נסגרת'],
      portalUrl: 'https://example.com/pro?t=tok',
    })
    expect(text).toContain('כתובת: ירושלים · כיכר ציון')
  })
})
