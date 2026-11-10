import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  calls: [] as { table: string; method: string; args: unknown[] }[],
  journalMissing: false,
  countryPhone: 'phone_other',
}))

vi.mock('@/lib/data/memory-store', () => ({ supabaseReady: vi.fn(async () => true) }))
vi.mock('@/modules/stores/business-phone', () => ({ resolveWhatsAppBusinessPhone: vi.fn(async () => '15550000000') }))
vi.mock('@/modules/whatsapp/agent', () => ({
  isWhatsAppAiIntakeEnabled: () => true,
  resolveIntakeLlmProvider: () => 'gateway',
}))
vi.mock('@/lib/supabase/system', () => ({
  createSystemClient: () => ({
    from(table: string) {
      const result = () => ({
        data: table === 'countries' ? { code: 'IL', whatsapp_phone_number_id: state.countryPhone }
          : table === 'whatsapp_templates' ? { id: 'template' }
            : { wa_id: '15559998888', body: 'private customer report' },
        error: table === 'document_reminder_deliveries' && state.journalMissing ? { code: '42P01' } : null,
        count: 1,
      })
      const query = new Proxy({}, {
        get(_target, method: string) {
          if (method === 'then') return (resolve: (value: unknown) => void) => resolve(result())
          return (...args: unknown[]) => {
            state.calls.push({ table, method, args })
            return query
          }
        },
      })
      return query
    },
    storage: { getBucket: vi.fn(async () => ({ data: { id: 'ticket-media' }, error: null })) },
  }),
}))

import { GET } from './route'

describe('public pilot health is read only and protects message content', () => {
  beforeEach(() => {
    state.calls = []
    state.journalMissing = false
    state.countryPhone = 'phone_other'
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'test-token')
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'phone_configured')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'phone_configured' }), { status: 200 })))
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  it('reports a country mismatch without changing country configuration', async () => {
    const body = await (await GET()).json()
    expect(body.checks.find((check: { id: string }) => check.id === 'country_phone_matches_env').ok).toBe(false)
    expect(state.calls.some((call) => ['update', 'insert', 'upsert', 'delete'].includes(call.method))).toBe(false)
    expect(body.checks.some((check: { id: string }) => check.id === 'country_phone_auto_healed')).toBe(false)
    expect(body.webhookUrl).toBe('https://opc-jerusalem.vercel.app/api/whatsapp/webhook')
  })

  it('does not load or expose customer phone numbers or report text', async () => {
    const text = JSON.stringify(await (await GET()).json())
    expect(text).not.toContain('private customer report')
    expect(text).not.toContain('15559998888')
    expect(state.calls.filter((call) => call.table === 'whatsapp_messages' && call.method === 'select')
      .some((call) => /wa_id|body/.test(String(call.args[0])))).toBe(false)
  })

  it('marks the missing reminder journal as a release prerequisite', async () => {
    state.journalMissing = true
    const body = await (await GET()).json()
    expect(body.readyForPilot).toBe(false)
    expect(body.nextSteps.some((check: { id: string }) => check.id === 'schema_document_reminder_journal')).toBe(true)
  })

  it('checks journal access without fetching reminder recipients or rows', async () => {
    const body = await (await GET()).json()
    expect(body.checks.find((check: { id: string }) => check.id === 'schema_document_reminder_journal').ok).toBe(true)
    expect(state.calls).toContainEqual({ table: 'document_reminder_deliveries', method: 'select', args: ['delivery_key', { head: true }] })
    expect(state.calls).toContainEqual({ table: 'document_reminder_deliveries', method: 'limit', args: [0] })
  })
})
