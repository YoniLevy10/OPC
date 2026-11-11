import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memCreate, memReset } from '@/lib/data/memory-store'
import { israelStoresAsRows } from '@/modules/stores/israel-stores'
import {
  clearHandoffCacheForTests,
  lockEngagement,
  resetEngagementsForTests,
} from './service'

process.env.MAINTAINOS_FORCE_MEMORY = '1'

const sendWhatsAppText = vi.hoisted(() => vi.fn())

vi.mock('@/modules/whatsapp/send', async () => {
  const actual = await vi.importActual<typeof import('@/modules/whatsapp/send')>(
    '@/modules/whatsapp/send',
  )
  return { ...actual, sendWhatsAppText }
})

function openFault() {
  const store = israelStoresAsRows().find((row) => row.code === '6006')
  if (!store) throw new Error('missing store')
  return memCreate({
    store,
    description: 'המזגן לא מקרר',
    priority: 'high',
    category: 'hvac',
  })
}

describe('store handoff idempotency', () => {
  beforeEach(() => {
    process.env.MAINTAINOS_FORCE_MEMORY = '1'
    memReset()
    resetEngagementsForTests()
    sendWhatsAppText.mockReset()
  })

  it('does not send a successful handoff twice, and retries a failed one', async () => {
    sendWhatsAppText.mockResolvedValue({
      ok: true,
      dryRun: false,
      waMessageId: 'wamid-ok',
      skippedByPolicy: false,
    })
    const first = openFault()
    await lockEngagement({
      ticketId: first.id,
      professionalName: 'פבל',
      professionalPhone: '0501234567',
      approvedAmount: 450,
      approvedBy: 'ארי',
    })
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1)

    clearHandoffCacheForTests()
    await expect(
      lockEngagement({
        ticketId: first.id,
        professionalName: 'אחר',
        professionalPhone: '0501234567',
        approvedAmount: 900,
        approvedBy: 'ארי',
      }),
    ).rejects.toThrow(/נעול/)
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1)

    sendWhatsAppText.mockResolvedValue({
      ok: false,
      dryRun: false,
      waMessageId: null,
      error: 'graph down',
    })
    const second = openFault()
    const failed = await lockEngagement({
      ticketId: second.id,
      professionalName: 'פבל',
      professionalPhone: '0501234567',
      approvedAmount: 180,
      approvedBy: 'ארי',
    })
    expect(failed.handoff?.ok).toBe(false)
    expect(sendWhatsAppText).toHaveBeenCalledTimes(2)

    clearHandoffCacheForTests()
    await expect(
      lockEngagement({
        ticketId: second.id,
        professionalName: 'פבל',
        professionalPhone: '0501234567',
        approvedAmount: 180,
        approvedBy: 'ארי',
      }),
    ).rejects.toThrow(/נעול/)
    expect(sendWhatsAppText).toHaveBeenCalledTimes(3)
  })
})
