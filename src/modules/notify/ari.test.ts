import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const send = vi.hoisted(() => ({ text: vi.fn(), template: vi.fn() }))
vi.mock('@/lib/data/ops-ledger', () => ({ deskNotifyPhones: () => ['0501234567'] }))
vi.mock('@/modules/whatsapp/send', () => ({
  sendWhatsAppText: send.text, sendWhatsAppTemplate: send.template,
  isWhatsAppOutsideWindowError: (_error: unknown, code: number) => code === 131047,
}))
vi.mock('@/lib/logging', () => ({ logEvent: vi.fn() }))
import { notifyAri, notifyPhone } from './ari'

describe('desk notification outcomes', () => {
  const previousMode = process.env.MAINTAINOS_FORCE_MEMORY
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.MAINTAINOS_FORCE_MEMORY
    send.text.mockResolvedValue({ ok: true, dryRun: false, waMessageId: 'wa-1' })
  })
  afterEach(() => {
    if (previousMode === undefined) delete process.env.MAINTAINOS_FORCE_MEMORY
    else process.env.MAINTAINOS_FORCE_MEMORY = previousMode
  })

  it('returns provider acceptance evidence', async () => {
    expect(await notifyAri('reminder')).toEqual({ ok: true, outcomes: [{
      to: '0501234567', status: 'sent', messageId: 'wa-1', error: null,
    }] })
  })

  it('returns thrown transport failures instead of claiming success', async () => {
    send.text.mockRejectedValue(new Error('network failed'))
    expect(await notifyPhone('0501234567', 'reminder')).toMatchObject({ status: 'failed', error: 'network failed' })
  })

  it('reports a failed template fallback', async () => {
    send.text.mockResolvedValue({ ok: false, dryRun: false, errorCode: 131047 })
    send.template.mockResolvedValue({ ok: false, dryRun: false, error: 'template rejected', waMessageId: null })
    expect(await notifyPhone('0501234567', 'reminder')).toMatchObject({ status: 'failed', error: 'template rejected' })
  })

  it('does not call a dry run sent', async () => {
    send.text.mockResolvedValue({ ok: true, dryRun: true, waMessageId: null })
    expect(await notifyAri('reminder')).toMatchObject({ ok: false, outcomes: [{ status: 'dry_run' }] })
  })

  it('requires a provider message id before reporting a send as accepted', async () => {
    send.text.mockResolvedValue({ ok: true, dryRun: false, waMessageId: null })
    expect(await notifyPhone('0501234567', 'reminder')).toMatchObject({ status: 'failed', error: 'missing_provider_message_id' })
  })
})
