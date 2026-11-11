import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyWhatsAppSignature } from '@/modules/whatsapp/signature'

afterEach(() => vi.unstubAllEnvs())

describe('WhatsApp webhook signature', () => {
  it('allows when secret unset in non-production', () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', undefined)
    vi.stubEnv('WA_APP_SECRET', undefined)
    vi.stubEnv('MAINTAINOS_WA_PROD_STRICT', undefined)
    vi.stubEnv('NODE_ENV', 'test')
    expect(verifyWhatsAppSignature('{}', null)).toBe(true)
  })

  it('rejects missing secret even with production bypass flags', () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', undefined)
    vi.stubEnv('WA_APP_SECRET', undefined)
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('MAINTAINOS_FORCE_MEMORY', '1')
    vi.stubEnv('MAINTAINOS_WA_DEV_BYPASS', '1')
    expect(verifyWhatsAppSignature('{}', null)).toBe(false)
  })

  it('rejects missing/invalid signature when secret set', () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', 'test-secret')
    expect(verifyWhatsAppSignature('{"a":1}', null)).toBe(false)
    expect(verifyWhatsAppSignature('{"a":1}', 'sha256=deadbeef')).toBe(false)
  })

  it('accepts valid Meta signature', () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', 'test-secret')
    const body = '{"object":"whatsapp_business_account"}'
    const hex = createHmac('sha256', 'test-secret').update(body, 'utf8').digest('hex')
    expect(verifyWhatsAppSignature(body, `sha256=${hex}`)).toBe(true)
  })
})
