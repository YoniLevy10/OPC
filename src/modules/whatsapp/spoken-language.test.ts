import { describe, expect, it } from 'vitest'
import { intakeLanguage, reportLanguage } from './spoken-language'

describe('reportLanguage', () => {
  it('detects Hebrew, English, and French', () => {
    expect(reportLanguage('המזגן לא עובד')).toBe('he')
    expect(reportLanguage('the AC is not cooling')).toBe('en')
    expect(reportLanguage("il y a une fuite d'eau")).toBe('fr')
    expect(reportLanguage('bonjour')).toBe('fr')
  })
})

describe('intakeLanguage', () => {
  it('keeps country default for STORE_ only', () => {
    expect(intakeLanguage('STORE_172', 'IL')).toBe('he')
    expect(intakeLanguage('STORE_172', 'FR')).toBe('fr')
    expect(intakeLanguage(null, 'FR')).toBe('fr')
  })

  it('follows the fault text language', () => {
    expect(intakeLanguage('the lock is stuck', 'IL')).toBe('en')
    expect(intakeLanguage('panne de clim', 'IL')).toBe('fr')
    expect(intakeLanguage('נזילה מהתקרה', 'FR')).toBe('he')
  })
})
