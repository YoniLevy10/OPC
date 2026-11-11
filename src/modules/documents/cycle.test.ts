import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as getFile } from '@/app/api/ops/document-file/[id]/route'
import { GET as remind } from '@/app/api/cron/document-reminders/route'
import { addDocument, renewStoredDocument, resetOpsLedger } from '@/lib/data/ops-ledger'
import { documentReminderStage, isDocumentOverdue } from './rules'

process.env.MAINTAINOS_FORCE_MEMORY = '1'

const actorBox = vi.hoisted(() => ({
  current: {
    id: 'hq',
    email: 'ari@example.com',
    memberships: [
      {
        role: 'global_maintenance',
        organization_id: 'org',
        country_id: 'il-country' as string | null,
        region_id: null as string | null,
        store_id: null as string | null,
      },
    ],
  },
}))

vi.mock('@/lib/auth/request-actor', () => ({
  requireActor: vi.fn(async () => actorBox.current),
  authErrorResponse: (err: { status?: number; message?: string }) =>
    Response.json({ error: err.message }, { status: err.status ?? 500 }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ eq: (_key: string, id: string) => ({ maybeSingle: async () => ({ data: id === 'store-a' ? { id, organization_id: 'org', country_id: 'il-country', region_id: null } : null }) }) }) }) }),
}))

vi.mock('@/lib/data/ops-db', () => ({
  hydrateOpsLedger: vi.fn(async () => undefined),
}))

function paper(storeId: string, expiry: string) {
  return addDocument({
    storeId,
    storeCode: '6006',
    storeName: 'אבן גבירול',
    docType: 'fire',
    sourceUrl: 'https://files.example/fire.pdf',
    extractedExpiry: expiry,
    computedNextCheck: null,
    owner: 'ארי',
    intakeStatus: 'ingested',
    intakeReason: null,
  })
}

describe('document cycle', () => {
  beforeEach(() => {
    process.env.MAINTAINOS_FORCE_MEMORY = '1'
    resetOpsLedger()
    actorBox.current = {
      id: 'hq',
      email: 'ari@example.com',
      memberships: [
        { role: 'global_maintenance', organization_id: 'org', country_id: 'il-country', region_id: null, store_id: null },
      ],
    }
  })

  it('checks the store, marks expiry, fires the reminder, and renews', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const expired = paper('store-a', yesterday)
    expect(isDocumentOverdue(expired)).toBe(true)

    const upcoming = new Date()
    upcoming.setUTCMonth(upcoming.getUTCMonth() + 5)
    const staged = paper('store-a', upcoming.toISOString())
    expect(documentReminderStage(staged)).toBe('six')

    actorBox.current = {
      id: 'other-store',
      email: 'other@example.com',
      memberships: [
        { role: 'store_manager', organization_id: 'org', country_id: 'il-country', region_id: null, store_id: 'store-b' },
      ],
    }
    const denied = await getFile(new Request(`http://localhost/api/ops/document-file/${expired.id}`), {
      params: Promise.resolve({ id: expired.id }),
    })
    expect(denied.status).toBe(403)

    actorBox.current = {
      id: 'hq',
      email: 'ari@example.com',
      memberships: [{ role: 'global_admin', organization_id: 'org', country_id: 'il-country', region_id: null, store_id: null }],
    }
    const hq = await getFile(new Request(`http://localhost/api/ops/document-file/${expired.id}`), {
      params: Promise.resolve({ id: expired.id }),
    })
    expect(hq.status).not.toBe(403)

    actorBox.current = {
      id: 'same-store',
      email: 'store@example.com',
      memberships: [
        { role: 'store_employee', organization_id: 'org', country_id: 'il-country', region_id: null, store_id: 'store-a' },
      ],
    }
    const own = await getFile(new Request(`http://localhost/api/ops/document-file/${expired.id}`), {
      params: Promise.resolve({ id: expired.id }),
    })
    expect(own.status).not.toBe(403)

    const reminded = await remind(new Request('http://localhost/api/cron/document-reminders'))
    const body = (await reminded.json()) as {
      ok: boolean
      overdue: { id: string }[]
      sixMonths: number
    }
    expect(reminded.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.overdue.some((row) => row.id === expired.id)).toBe(true)
    expect(body.sixMonths).toBeGreaterThanOrEqual(1)

    const renewed = renewStoredDocument(expired.id, {
      sourceUrl: 'https://files.example/fire-renewed.pdf',
      extractedExpiry: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString(),
    })
    expect(renewed.closed.renewed).toBe(true)
    expect(renewed.next.extractedExpiry).not.toBe(expired.extractedExpiry)
    expect(isDocumentOverdue(renewed.next)).toBe(false)
    expect(documentReminderStage(renewed.next)).toBeNull()
  })
})
