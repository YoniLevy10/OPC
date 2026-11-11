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
  it('formats a short multi-line SMS with manager and full portal url', () => {
    const text = buildProAssignmentSms({
      storeName: 'תל אביב שינקין',
      storeCode: '6004',
      managerPhone: '050-3393839',
      faultLines: [
        '#OC-18183 — נזילה ליד הקופה הראשית',
        '#OC-18182 — מזגן באולם המכירות לא מקרר בכלל',
      ],
      portalUrl: 'https://example.com/pro?t=abc',
    })
    expect(text).toContain('תל אביב שינקין (#6004)')
    expect(text).toContain('ביקור אחד · 2 תקלות')
    expect(text).toContain('נזילה ליד הקופה הראשית')
    expect(text).toContain('מזגן באולם המכירות לא מקרר בכלל')
    expect(text).not.toMatch(/#?OC-\d+/i)
    expect(text).toContain('מנהל: 050-3393839')
    expect(text).toContain('קישור:')
    expect(text).toContain('https://example.com/pro?t=abc')
    expect(text).not.toMatch(/בכלל מנהל/)
    expect(text.endsWith('https://example.com/pro?t=abc')).toBe(true)
  })

  it('never truncates the portal url when the body is long', () => {
    const url = `https://example.com/pro?t=${'x'.repeat(200)}`
    const text = buildProAssignmentSms({
      storeName: 'תל אביב שינקין עם שם ארוך מאוד לסניף',
      storeCode: '6004',
      managerPhone: '050-3393839',
      faultLines: Array.from({ length: 8 }, (_, i) =>
        `#OC-${18180 + i} — תיאור תקלה ארוך מאוד שלא אמור לדחוף את הקישור`,
      ),
      portalUrl: url,
    })
    expect(text.endsWith(url)).toBe(true)
    expect(text.length).toBeLessThanOrEqual(480)
  })
})
