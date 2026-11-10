import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memCreate, memGet, memReset, memFindStoreById } from '@/lib/data/memory-store'
import { DEMO_STORES } from '@/modules/stores/data'
import { annualMaintenanceCost } from './cost'
import { parseEngagementApproval } from './parse'
import {
  cancelEngagement,
  lockEngagement,
  listEngagements,
  getEngagementHandoffs,
  retryEngagementHandoffs,
  resumeEngagementApproval,
  resetEngagementsForTests,
} from './service'
import { sendWhatsAppText } from '@/modules/whatsapp/send'
import * as ticketService from '@/modules/tickets/service'

vi.mock('@/modules/whatsapp/send', () => ({ sendWhatsAppText: vi.fn() }))
const send = vi.mocked(sendWhatsAppText)

process.env.MAINTAINOS_FORCE_MEMORY = '1'

describe('parseEngagementApproval', () => {
  it('reads a price, a mobile number, and a name', () => {
    const parsed = parseEngagementApproval('אשר 450 0501234567 פבל')
    expect(parsed.amount).toBe(450)
    expect(parsed.phone).toContain('0501234567')
    expect(parsed.name).toBe('פבל')
  })

  it('does not treat a missing price as zero', () => {
    expect(parseEngagementApproval('לאשר').amount).toBeNull()
  })
})

describe('lockEngagement', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.MAINTAINOS_FORCE_MEMORY = '1'
    memReset()
    resetEngagementsForTests()
    send.mockReset().mockResolvedValue({ ok: true, dryRun: true, waMessageId: 'demo-message' })
  })

  it('locks the price, moves the fault to the store, and writes the handoff', async () => {
    const store = DEMO_STORES[0]
    if (!store) throw new Error('missing demo store')
    const ticket = memCreate({
      store,
      description: 'המזגן לא מקרר',
      priority: 'high',
      category: 'hvac',
      reporterPhone: '0501111111',
    })
    const side = memCreate({
      store,
      description: 'ניקוי פילטר מזגן',
      priority: 'low',
      category: 'hvac',
    })

    const locked = await lockEngagement({
      ticketId: ticket.id,
      bundledTicketIds: [side.id],
      professionalName: 'פבל',
      professionalPhone: '0501234567',
      approvedAmount: 450,
      approvedBy: 'ארי',
      midragSpId: '137520',
    })

    expect(locked.approvedAmount).toBe(450)
    expect(locked.status).toBe('locked')
    expect(memGet(ticket.id)?.status).toBe('engaged')
    expect(memGet(side.id)?.status).toBe('engaged')
    expect(memGet(ticket.id)?.messages.some((row) => row.body?.includes('ארי אישר'))).toBe(
      true,
    )
    await expect(
      lockEngagement({
        ticketId: ticket.id,
        professionalName: 'אחר',
        professionalPhone: '0501234567',
        approvedAmount: 900,
        approvedBy: 'ארי',
      }),
    ).rejects.toThrow(/נעול/)

    await cancelEngagement(ticket.id)
    expect(memGet(ticket.id)?.status).toBe('new')
    expect(memGet(side.id)?.status).toBe('new')
  })

  function fault(storeCode = '6006', category = 'hvac') {
    const store = DEMO_STORES.find((row) => row.code === storeCode)!
    return memCreate({ store, description: `עבודה בחנות ${storeCode}`, category, priority: 'high' })
  }

  function approve(ticketId: string, bundledTicketIds: string[] = [], approvedAmount = 450) {
    return lockEngagement({ ticketId, bundledTicketIds, professionalName: 'פבל', professionalPhone: '0501234567', approvedAmount, approvedBy: 'ארי' })
  }

  it('hands each store only its approved work and scheduling responsibility, with persisted outcomes', async () => {
    const lead = fault('6006')
    const sameStore = fault('6006')
    const otherStore = fault('6004')
    memFindStoreById(lead.store_id)!.manager_phone = '0521111111'
    memFindStoreById(otherStore.store_id)!.manager_phone = '0522222222'
    send.mockResolvedValue({ ok: true, dryRun: false, waMessageId: 'wamid.accepted' })

    const locked = await approve(lead.id, [sameStore.id, otherStore.id])
    expect(locked.handoffs).toHaveLength(2)
    expect(locked.handoffs?.every((row) => row.status === 'sent' && !row.canRetry)).toBe(true)
    expect(send).toHaveBeenCalledTimes(2)
    const first = send.mock.calls[0]![0]
    const second = send.mock.calls[1]![0]
    expect(first.toWaId).toBe('972521111111')
    expect(second.toWaId).toBe('972522222222')
    expect(first.text).toContain(lead.display_number!)
    expect(first.text).toContain(sameStore.display_number!)
    expect(first.text).not.toContain(otherStore.display_number!)
    expect(second.text).toContain(otherStore.display_number!)
    expect(second.text).not.toContain(lead.display_number!)
    expect(first.text).toContain('לכל העבודות בביקור המשולב')
    expect(first.text).toContain('מנהל החנות אחראי לתאם')
    expect(first.buttons).toBeUndefined()
    expect(second.buttons).toBeUndefined()
    expect(await getEngagementHandoffs(lead.id)).toEqual(locked.handoffs)
  })

  it('accepts electrical hazards and electrical repairs as the same professional trade', async () => {
    const lead = fault('6006', 'electrical_hazard')
    const side = fault('6004', 'electrical')
    const locked = await approve(lead.id, [side.id])
    expect(locked.bundledTicketIds).toEqual([side.id])
  })

  it.each(['missing', 'trade', 'city', 'organization', 'country', 'closed', 'unknown_trade', 'missing_city'])(
    'rejects invalid bundle (%s) before any price/status/message write', async (kind) => {
      const lead = fault()
      const side = fault('6004')
      if (kind === 'trade') side.category = 'plumbing'
      if (kind === 'city') side.stores!.city = 'חיפה'
      if (kind === 'organization') side.organization_id = 'another-organization'
      if (kind === 'country') side.country_id = 'another-country'
      if (kind === 'closed') side.status = 'closed'
      if (kind === 'unknown_trade') lead.category = side.category = 'other'
      if (kind === 'missing_city') side.stores!.city = null
      const before = side.status

      await expect(approve(lead.id, [kind === 'missing' ? 'missing-ticket' : side.id])).rejects.toThrow()
      expect(await listEngagements()).toEqual([])
      expect(memGet(lead.id)?.status).toBe('new')
      expect(memGet(side.id)?.status).toBe(before)
      expect(memGet(lead.id)?.events.some((event) => event.event_type === 'engagement_locked')).toBe(false)
      expect(send).not.toHaveBeenCalled()
    },
  )

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1])('rejects a non-finite/non-positive price (%s)', async (amount) => {
    const lead = fault()
    await expect(approve(lead.id, [], amount)).rejects.toThrow(/מחיר/)
    expect(await listEngagements()).toEqual([])
    expect(memGet(lead.id)?.status).toBe('new')
  })

  it('keeps the approved price on delivery failure and retries only the failed store', async () => {
    const lead = fault('6006')
    const side = fault('6004')
    send.mockResolvedValueOnce({ ok: true, dryRun: false, waMessageId: 'first-message' })
      .mockResolvedValueOnce({ ok: false, dryRun: false, waMessageId: null, error: 'Meta rejected' })
    const locked = await approve(lead.id, [side.id])
    expect(locked.handoffs?.map((row) => row.status)).toEqual(['sent', 'failed'])
    expect(locked.handoffs?.[1]?.error).toBe('Meta rejected')
    expect(memGet(side.id)?.status).toBe('engaged')

    send.mockResolvedValueOnce({ ok: true, dryRun: false, waMessageId: 'second-message' })
    const retried = await retryEngagementHandoffs(lead.id)
    expect(send).toHaveBeenCalledTimes(3)
    expect(retried.id).toBe(locked.id)
    expect(retried.approvedAmount).toBe(450)
    expect(retried.handoffs?.map((row) => row.status)).toEqual(['sent', 'sent'])
    expect(await getEngagementHandoffs(lead.id)).toEqual(retried.handoffs)
    await retryEngagementHandoffs(lead.id)
    expect(send).toHaveBeenCalledTimes(3)
    expect(await listEngagements()).toHaveLength(1)
  })

  it('reports missing manager contact instead of sending to the reporter, then retries after correction', async () => {
    const lead = fault()
    lead.reporter_phone = '0523333333'
    memFindStoreById(lead.store_id)!.manager_phone = null
    const locked = await approve(lead.id)
    expect(locked.handoffs?.[0]).toMatchObject({ status: 'missing_contact', canRetry: true })
    expect(send).not.toHaveBeenCalled()
    expect(memGet(lead.id)?.messages.some((message) => message.direction === 'outbound')).toBe(false)
    memFindStoreById(lead.store_id)!.manager_phone = '0524444444'
    const retried = await retryEngagementHandoffs(lead.id)
    expect(retried.handoffs?.[0]?.status).toBe('dry_run')
    expect(send.mock.calls[0]?.[0].toWaId).toBe('972524444444')
  })

  it('captures thrown send failures and prevents overlapping same-worker approvals', async () => {
    const lead = fault()
    send.mockRejectedValue(new Error('network unavailable'))
    const results = await Promise.allSettled([approve(lead.id), approve(lead.id)])
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((row) => row.status === 'rejected')).toHaveLength(1)
    const locked = results.find((row) => row.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof approve>>>
    expect(locked.value.handoffs?.[0]).toMatchObject({ status: 'failed', error: 'network unavailable', canRetry: true })
    expect(await listEngagements()).toHaveLength(1)
  })

  it('does not send an untracked message when saving the attempt fails, and supports later recovery', async () => {
    const lead = fault()
    const append = ticketService.appendEvent
    const spy = vi.spyOn(ticketService, 'appendEvent').mockImplementation((id, type, actor, payload) => {
      if (type === 'engagement_handoff') return Promise.reject(new Error('event storage unavailable'))
      return append(id, type, actor, payload)
    })
    const locked = await approve(lead.id)
    expect(locked.handoffs?.[0]).toMatchObject({ status: 'failed', canRetry: true })
    expect(send).not.toHaveBeenCalled()
    expect((await getEngagementHandoffs(lead.id))[0]).toMatchObject({ status: 'failed', canRetry: true })
    spy.mockRestore()
    const recovered = await retryEngagementHandoffs(lead.id)
    expect(recovered.handoffs?.[0]?.status).toBe('dry_run')
    expect(send).toHaveBeenCalledTimes(1)
    expect(recovered.approvedAmount).toBe(450)
  })

  it('does not automatically resend when Meta accepted but saving the final result failed', async () => {
    const lead = fault()
    const append = ticketService.appendEvent
    vi.spyOn(ticketService, 'appendEvent').mockImplementation((id, type, actor, payload) => {
      if (type === 'engagement_handoff' && payload?.attempt === 2) return Promise.reject(new Error('result storage unavailable'))
      return append(id, type, actor, payload)
    })
    send.mockResolvedValue({ ok: true, dryRun: false, waMessageId: 'accepted-before-storage-failed' })
    const locked = await approve(lead.id)
    expect(locked.handoffs?.[0]).toMatchObject({ status: 'failed', canRetry: false, waMessageId: 'accepted-before-storage-failed' })
    expect(locked.handoffs?.[0]?.error).toContain('לא נשמרה')
    const reloaded = await getEngagementHandoffs(lead.id)
    expect(reloaded[0]).toMatchObject({ status: 'failed', canRetry: false })
    expect(reloaded[0]?.error).toContain('ללא תוצאה שמורה')
    await retryEngagementHandoffs(lead.id)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('does not claim a live send without a Meta message ID', async () => {
    const lead = fault()
    send.mockResolvedValue({ ok: true, dryRun: false, waMessageId: null })
    const locked = await approve(lead.id)
    expect(locked.handoffs?.[0]).toMatchObject({ status: 'failed', canRetry: true })
  })

  it.each(['status', 'event'])('replays one saved approval after a partial %s write without duplicate price or messages', async (failure) => {
    const lead = fault('6006')
    const side = fault('6004')
    let failed = false
    const update = ticketService.updateStatus
    const append = ticketService.appendEvent
    vi.spyOn(ticketService, 'updateStatus').mockImplementation((...args) => {
      if (failure === 'status' && args[0] === side.id && !failed) {
        failed = true
        return Promise.reject(new Error('status write failed'))
      }
      return update(...args)
    })
    vi.spyOn(ticketService, 'appendEvent').mockImplementation((...args) => {
      if (failure === 'event' && args[0] === side.id && args[1] === 'engagement_locked' && !failed) {
        failed = true
        return Promise.reject(new Error('approval audit write failed'))
      }
      return append(...args)
    })
    await expect(approve(lead.id, [side.id])).rejects.toThrow(/write failed/)
    const [saved] = await listEngagements()
    expect(saved?.approvedAmount).toBe(450)
    expect(send).not.toHaveBeenCalled()

    const recovered = await resumeEngagementApproval(lead.id)
    expect(recovered.id).toBe(saved?.id)
    expect(await listEngagements()).toHaveLength(1)
    for (const ticket of [lead, side]) {
      expect(memGet(ticket.id)?.status).toBe('engaged')
      expect(memGet(ticket.id)?.events.filter((event) => event.event_type === 'engagement_locked')).toHaveLength(1)
    }
    expect(send).toHaveBeenCalledTimes(2)
    await resumeEngagementApproval(lead.id)
    await retryEngagementHandoffs(side.id)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('reconciles an incomplete approval before a handoff retry', async () => {
    const lead = fault('6006')
    const side = fault('6004')
    const update = ticketService.updateStatus
    const spy = vi.spyOn(ticketService, 'updateStatus').mockImplementation((...args) => {
      if (args[0] === side.id) return Promise.reject(new Error('status write failed'))
      return update(...args)
    })
    await expect(approve(lead.id, [side.id])).rejects.toThrow('status write failed')
    spy.mockRestore()
    const recovered = await retryEngagementHandoffs(lead.id)
    expect(memGet(side.id)?.status).toBe('engaged')
    expect(recovered.handoffs?.every((handoff) => handoff.status === 'dry_run')).toBe(true)
    expect(await listEngagements()).toHaveLength(1)
  })

  it('preserves a confirmed closed sibling and rejects divergent resolved work before changing any ticket', async () => {
    const lead = fault('6006')
    const side = fault('6004')
    await approve(lead.id, [side.id])
    side.status = 'closed'
    side.store_confirmed_at = new Date().toISOString()
    await resumeEngagementApproval(lead.id)
    expect(memGet(side.id)?.status).toBe('closed')
    expect(send).toHaveBeenCalledTimes(2)

    side.status = 'resolved'
    const update = vi.spyOn(ticketService, 'updateStatus')
    await expect(resumeEngagementApproval(lead.id)).rejects.toThrow(/בדיקה ידנית/)
    expect(update).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(2)
    expect(memGet(side.id)?.status).toBe('resolved')
  })

  it('keeps demo approvals visible across separate route and page module instances', async () => {
    const lead = fault()
    const locked = await approve(lead.id)
    vi.resetModules()
    const pageService = await import('./service')
    expect((await pageService.lockedEngagementFor(lead.id))?.id).toBe(locked.id)
    expect(await pageService.getEngagementHandoffs(lead.id)).toEqual(locked.handoffs)
    resetEngagementsForTests()
    expect(await pageService.listEngagements()).toEqual([])
  })
})

describe('annualMaintenanceCost', () => {
  it('sums closed visits per store and for the network', () => {
    const report = annualMaintenanceCost(
      [
        {
          storeCode: '6004',
          storeName: 'שינקין',
          approvedAmount: 400,
          closedAt: '2026-03-01T00:00:00.000Z',
        },
        {
          storeCode: '6004',
          storeName: 'שינקין',
          approvedAmount: 150,
          closedAt: '2026-11-01T00:00:00.000Z',
        },
        {
          storeCode: '6014',
          storeName: 'אשקלון',
          approvedAmount: 200,
          closedAt: '2025-12-01T00:00:00.000Z',
        },
      ],
      2026,
    )
    expect(report.network).toBe(550)
    expect(report.stores[0]).toMatchObject({ storeCode: '6004', amount: 550 })
    expect(report.stores).toHaveLength(1)
  })
})
