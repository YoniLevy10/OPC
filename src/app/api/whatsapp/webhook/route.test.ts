import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { processInboundMessage, verifyWhatsAppSignature } = vi.hoisted(() => ({
  processInboundMessage: vi.fn(),
  verifyWhatsAppSignature: vi.fn(),
}))

vi.mock('@/modules/whatsapp', () => ({
  parseWhatsAppWebhook: (body: unknown) => {
    const payload = body as { messages?: unknown[] }
    return payload.messages ?? []
  },
  processInboundMessage,
  verifyWhatsAppSignature,
}))
vi.mock('@/lib/monitoring', () => ({ captureError: vi.fn() }))
vi.mock('@/lib/logging', () => ({ logEvent: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true, resetMs: 0 }),
  clientIpFromRequest: () => '127.0.0.1',
}))

import { POST } from './route'

function request(body: string) {
  return new NextRequest('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
}

describe('POST /api/whatsapp/webhook reliability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyWhatsAppSignature.mockReturnValue(true)
  })

  it('rejects an invalid signature without processing the payload', async () => {
    verifyWhatsAppSignature.mockReturnValue(false)
    const response = await POST(request('{"messages":[]}'))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ ok: false, error: 'invalid_signature' })
    expect(processInboundMessage).not.toHaveBeenCalled()
  })

  it('returns a retryable failure when intake fails', async () => {
    processInboundMessage.mockResolvedValue({ ok: false, error: 'storage_unavailable' })
    const response = await POST(request('{"messages":[{"messageId":"wamid.1","waId":"123"}]}'))

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ ok: false, processed: 1 })
  })

  it('returns a retryable failure when intake throws', async () => {
    processInboundMessage.mockRejectedValue(new Error('storage_unavailable'))
    const response = await POST(request('{"messages":[{"messageId":"wamid.1","waId":"123"}]}'))

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ ok: false, processed: 1 })
  })
})
