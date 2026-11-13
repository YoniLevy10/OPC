import { describe, expect, it } from 'vitest'
import { isCareWindowOpen } from './service'

describe('isCareWindowOpen', () => {
  it('is closed when there is no inbound timestamp', () => {
    expect(isCareWindowOpen(null)).toBe(false)
    expect(isCareWindowOpen(undefined)).toBe(false)
    expect(isCareWindowOpen('')).toBe(false)
  })

  it('is closed when the value is message body text, not a date', () => {
    expect(isCareWindowOpen('המזגן לא מקרר באולם')).toBe(false)
  })

  it('is open for a recent inbound ISO timestamp', () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    expect(isCareWindowOpen(recent)).toBe(true)
  })

  it('is closed after 24 hours', () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    expect(isCareWindowOpen(old)).toBe(false)
  })
})
