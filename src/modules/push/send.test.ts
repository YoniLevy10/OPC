import { afterEach, describe, expect, it } from 'vitest'
import webpush from 'web-push'
import {
  isWebPushConfigured,
  notifyOpsDeskPush,
  notifyTechnicianAssignedPush,
} from './send'

function clearVapidEnv() {
  delete process.env.VAPID_PUBLIC_KEY
  delete process.env.VAPID_PRIVATE_KEY
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
}

function setValidVapidEnv() {
  const keys = webpush.generateVAPIDKeys()
  process.env.VAPID_PUBLIC_KEY = keys.publicKey
  process.env.VAPID_PRIVATE_KEY = keys.privateKey
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = keys.publicKey
}

describe('push send', () => {
  const prevPub = process.env.VAPID_PUBLIC_KEY
  const prevPriv = process.env.VAPID_PRIVATE_KEY
  const prevNext = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

  afterEach(() => {
    if (prevPub === undefined) delete process.env.VAPID_PUBLIC_KEY
    else process.env.VAPID_PUBLIC_KEY = prevPub
    if (prevPriv === undefined) delete process.env.VAPID_PRIVATE_KEY
    else process.env.VAPID_PRIVATE_KEY = prevPriv
    if (prevNext === undefined) delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    else process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = prevNext
  })

  it('reports VAPID configuration', () => {
    clearVapidEnv()
    expect(isWebPushConfigured()).toBe(false)
    process.env.VAPID_PUBLIC_KEY = 'pub'
    process.env.VAPID_PRIVATE_KEY = 'priv'
    expect(isWebPushConfigured()).toBe(true)
  })

  it('skips ops desk push when VAPID is not configured', async () => {
    clearVapidEnv()
    const result = await notifyOpsDeskPush({
      body: 'יש פריט שמחכה להחלטה',
      url: '/ops/approvals',
    })
    expect(result).toEqual({ sent: 0, skipped: 'vapid_not_configured' })
  })

  it('skips ops desk push when body is empty', async () => {
    clearVapidEnv()
    const result = await notifyOpsDeskPush({ body: '   ' })
    expect(result).toEqual({ sent: 0, skipped: 'empty_body' })
  })

  it('skips ops desk push when there are no HQ subscriptions', async () => {
    setValidVapidEnv()
    const prevMem = process.env.MAINTAINOS_FORCE_MEMORY
    process.env.MAINTAINOS_FORCE_MEMORY = '1'
    const result = await notifyOpsDeskPush({
      body: 'תקציר יומי',
      url: '/ops',
    })
    expect(result.sent).toBe(0)
    expect(result.skipped).toBe('no_subscriptions')
    if (prevMem === undefined) delete process.env.MAINTAINOS_FORCE_MEMORY
    else process.env.MAINTAINOS_FORCE_MEMORY = prevMem
  })

  it('skips tech assign push when VAPID is not configured', async () => {
    clearVapidEnv()
    const result = await notifyTechnicianAssignedPush({
      profileId: 'tech-1',
      ticketId: 't1',
      displayNumber: 'OC-1',
      storeName: 'רמת אביב',
    })
    expect(result).toEqual({ sent: 0, skipped: 'vapid_not_configured' })
  })
})
