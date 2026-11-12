import { createSystemClient } from '@/lib/supabase/system'
import type { Actor } from '@/lib/auth/types'
import { AuthError, testAuthAllowed } from '@/lib/auth/types'
import { canAccessInboxSession } from './authorization'
import { canonicalStoreCode } from '@/modules/stores/israel-stores'
import {
  isMissingColumnError,
  isMissingTableError,
  isSupabaseSchemaError,
} from '@/lib/supabase/schema-fallback'
import {
  memListSessions,
  memGetSession,
  memSetSessionTakeover,
  memUpsertSession,
  memAddInboxMessage,
  memListInboxMessages,
  memDeleteSession,
  memListTickets,
  memListStores,
  MEM_COUNTRY_ID,
  supabaseReady,
  type MemSession,
} from '@/lib/data/memory-store'
import {
  sendWhatsAppText,
  sendWhatsAppTemplate,
} from '@/modules/whatsapp/send'
import { resolveWhatsAppPhoneNumberId } from '@/modules/whatsapp/phone-number-id'
import { defaultSessionTemplateName } from '@/modules/whatsapp/templates'
import { OPEN_TICKET_STATUSES } from '@/modules/tickets/constants'
import { DEMO_STORES } from '@/modules/stores/data'
import { dedupeThreadMessages } from './dedupe-messages'
import { humanizeMessageBody } from './display-labels'
import {
  humanPauseUntilIso,
  isHumanPauseActive,
} from '@/modules/whatsapp/human-pause'
import { phonesMatch } from '@/modules/whatsapp/classify'
import { resolveManagerStoreByPhone } from '@/modules/stores/manager-identity'
import { normalizePhoneDigits } from '@/lib/phone'

const CUSTOMER_CARE_WINDOW_MS = 24 * 60 * 60 * 1000

function isUuid(value: string | null | undefined): boolean {
  if (!value) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

function sanitizeOptionalUuid(
  value: string | null | undefined,
): string | undefined {
  if (value == null) return undefined
  const trimmed = String(value).trim()
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return undefined
  return isUuid(trimmed) ? trimmed : undefined
}

const SESSION_SELECT_FULL =
  'wa_id, country_id, store_id, store_code, customer_name, state, pending_description, expires_at, updated_at, human_takeover, human_takeover_until, last_inbound, stores(region_id, organization_id)'
const SESSION_SELECT_LEGACY =
  'wa_id, country_id, store_id, store_code, state, pending_description, expires_at, updated_at, stores(region_id, organization_id)'
const SESSION_SELECT_BARE =
  'wa_id, country_id, store_id, store_code, state, pending_description, expires_at, updated_at'

const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

function storeScopeFromRow(row: Record<string, unknown>): {
  region_id: string | null
  organization_id: string | null
} {
  const raw = row.stores
  const store = (Array.isArray(raw) ? raw[0] : raw) as
    | { region_id?: string | null; organization_id?: string | null }
    | null
    | undefined
  return {
    region_id: store?.region_id ?? null,
    organization_id: store?.organization_id ?? null,
  }
}

function mapSessionRow(
  row: Record<string, unknown>,
  opts?: {
    human_takeover?: boolean
    human_takeover_until?: string | null
    last_inbound?: string | null
  },
): InboxSession {
  const rawCountry = row.country_id
  const countryId =
    rawCountry == null || rawCountry === '' || rawCountry === 'null'
      ? ''
      : String(rawCountry)

  return {
    wa_id: String(row.wa_id),
    // Never stringify SQL NULL into the literal "null" (breaks UUID validation).
    country_id: countryId,
    store_id:
      row.store_id == null || row.store_id === 'null'
        ? null
        : String(row.store_id),
    store_code: (row.store_code as string | null) ?? null,
    customer_name: (row.customer_name as string | null) ?? null,
    state: row.state as InboxSession['state'],
    pending_description: (row.pending_description as string | null) ?? null,
    expires_at: String(row.expires_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    human_takeover: opts?.human_takeover ?? Boolean(row.human_takeover),
    human_takeover_until:
      opts?.human_takeover_until !== undefined
        ? opts.human_takeover_until
        : ((row.human_takeover_until as string | null | undefined) ?? null),
    last_inbound:
      opts?.last_inbound !== undefined
        ? opts.last_inbound
        : ((row.last_inbound as string | null | undefined) ?? null),
  }
}

function seedDemoInboxIfEmpty() {
  let sessions = memListSessions()
  if (sessions.length === 0) {
    memUpsertSession({
      wa_id: '972501112233',
      country_id: MEM_COUNTRY_ID,
      store_id: 'il-store-172',
      store_code: '172',
      state: 'awaiting_description',
      pending_description: null,
      human_takeover: false,
      last_inbound: 'המזגן לא מקרר באולם',
    })
    memUpsertSession({
      wa_id: '972509998877',
      country_id: MEM_COUNTRY_ID,
      store_id: 'il-store-101',
      store_code: '101',
      state: 'awaiting_description',
      pending_description: null,
      human_takeover: true,
      human_takeover_until: humanPauseUntilIso(),
      last_inbound: 'דלת הכניסה לא ננעלת',
    })
    memUpsertSession({
      wa_id: '972503334455',
      country_id: MEM_COUNTRY_ID,
      store_id: 'il-store-124',
      store_code: '124',
      state: 'done',
      pending_description: null,
      human_takeover: false,
      last_inbound: 'תודה, תוקן',
    })
    sessions = memListSessions()
  }
  return sessions
}

function resolveStoreName(
  storeId: string | null,
  storeCode: string | null,
  storeMap?: Map<
    string,
    {
      name: string
      code: string
      manager_name?: string | null
      manager_phone?: string | null
    }
  >,
): string | null {
  if (storeMap) {
    if (storeId && storeMap.has(storeId)) return storeMap.get(storeId)!.name
    if (storeCode) {
      for (const s of storeMap.values()) {
        if (s.code === storeCode) return s.name
      }
    }
  }
  const fromMem = memListStores().find(
    (s) =>
      (storeId && s.id === storeId) || (storeCode && s.code === storeCode),
  )
  if (fromMem) return fromMem.name
  const demo = DEMO_STORES.find(
    (s) =>
      (storeId && s.id === storeId) || (storeCode && s.code === storeCode),
  )
  return demo?.name ?? null
}

function formatWaDisplay(waId: string): string {
  const digits = waId.replace(/\D/g, '')
  if (digits.startsWith('972') && digits.length >= 11) {
    return `0${digits.slice(3, 5)}-${digits.slice(5, 8)}-${digits.slice(8)}`
  }
  return waId
}

function pickHighestPriority(priorities: string[]): string | null {
  if (priorities.length === 0) return null
  return [...priorities].sort(
    (a, b) => (PRIORITY_RANK[a] ?? 9) - (PRIORITY_RANK[b] ?? 9),
  )[0]
}

function enrichSession(
  session: InboxSession,
  ctx: {
    storeName: string | null
    lastMessage: string | null
    lastDirection: 'inbound' | 'outbound' | null
    openPriorities: string[]
    customerName: string | null
  },
): InboxSessionView {
  const storeLabel = ctx.storeName
    ? session.store_code
      ? `${ctx.storeName} (#${session.store_code})`
      : ctx.storeName
    : session.store_code
      ? `סניף #${session.store_code}`
      : null

  const display_name =
    ctx.customerName?.trim() ||
    storeLabel ||
    formatWaDisplay(session.wa_id)

  const paused = isHumanPauseActive(session)

  const unread =
    paused ||
    session.state === 'awaiting_description' ||
    ctx.lastDirection === 'inbound'

  return {
    ...session,
    // Expose effective pause only (legacy permanent flags look "off").
    human_takeover: paused,
    human_takeover_until: paused ? (session.human_takeover_until ?? null) : null,
    store_name: ctx.storeName,
    customer_name: ctx.customerName,
    display_name,
    last_message: humanizeMessageBody(
      ctx.lastMessage ?? session.last_inbound ?? '',
    ) || null,
    unread,
    priority: pickHighestPriority(ctx.openPriorities),
    /** waiting = private ops window active for this chat only */
    inbox_status: paused ? 'waiting' : 'handled',
    care_window_open: isCareWindowOpen(session.last_inbound),
  }
}

export type InboxSession = MemSession

export type InboxSessionView = InboxSession & {
  store_name: string | null
  customer_name: string | null
  display_name: string
  last_message: string | null
  unread: boolean
  priority: string | null
  /** Derived: waiting = private ops window active; handled = bot on. */
  inbox_status: 'waiting' | 'handled'
  /** False when last inbound is older than 24h — free-form reply blocked. */
  care_window_open: boolean
}

export function isCareWindowOpen(
  lastInboundAt: string | null | undefined,
): boolean {
  if (!lastInboundAt) return true
  const lastMs = Date.parse(lastInboundAt)
  if (!Number.isFinite(lastMs)) return true
  return Date.now() - lastMs <= CUSTOMER_CARE_WINDOW_MS
}

export type InboxMessage = {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  created_at: string
  ticket_id?: string | null
}

export type InboxOpenTicket = {
  id: string
  display_number: string | null
  title: string | null
  status: string
  priority: string
  description: string
  store_code: string | null
  store_name: string | null
}

export type InboxSessionContext = {
  store_name: string | null
  store_code: string | null
  customer_name: string | null
  wa_display: string
  openTickets: InboxOpenTicket[]
}

function ticketsForWa(waId: string, storeId: string | null, organizationId?: string | null): InboxOpenTicket[] {
  return memListTickets()
    .filter((t) => t.reporter_phone === waId && t.stores?.id === storeId && (!organizationId || t.organization_id === organizationId))
    .filter((t) =>
      OPEN_TICKET_STATUSES.includes(
        t.status as (typeof OPEN_TICKET_STATUSES)[number],
      ),
    )
    .map((t) => ({
      id: t.id,
      display_number: t.display_number,
      title: t.title,
      status: t.status,
      priority: t.priority,
      description: t.description,
      store_code: t.stores?.code ?? null,
      store_name: t.stores?.name ?? null,
    }))
}

function enrichMemorySessions(sessions: InboxSession[]): InboxSessionView[] {
  return sessions.map((session) => {
    const messages = memListInboxMessages(session.wa_id)
    const last = messages[messages.length - 1]
    const open = ticketsForWa(session.wa_id, session.store_id)
    const customer =
      memListTickets().find((t) => t.reporter_phone === session.wa_id && t.stores?.id === session.store_id)
        ?.reporter_name ?? null
    const store = memListStores().find((s) => s.id === session.store_id)
    const managerName =
      store?.manager_phone && phonesMatch(session.wa_id, store.manager_phone)
        ? store.manager_name?.trim() || null
        : null
    return enrichSession(session, {
      storeName: resolveStoreName(session.store_id, session.store_code),
      lastMessage: last?.body ?? session.last_inbound ?? null,
      lastDirection: last?.direction ?? (session.last_inbound ? 'inbound' : null),
      openPriorities: open.map((t) => t.priority),
      customerName:
        session.customer_name?.trim() || customer || managerName || null,
    })
  })
}

export async function listInboxSessions(actor: Actor): Promise<{
  sessions: InboxSessionView[]
  backend: 'memory' | 'supabase'
}> {
  if (!(await supabaseReady())) {
    if (!testAuthAllowed()) throw new AuthError('Inbox backend unavailable', 503)
    return {
      sessions: enrichMemorySessions(seedDemoInboxIfEmpty()).filter((s) => canAccessInboxSession(actor, s)),
      backend: 'memory',
    }
  }

  const supabase = createSystemClient('inbox_sessions_list')
  const full = await supabase
    .from('intake_sessions')
    .select(SESSION_SELECT_FULL)
    .order('updated_at', { ascending: false })
    .limit(100)

  let rows: Record<string, unknown>[] | null = (full.data ?? null) as Record<
    string,
    unknown
  >[] | null
  let error = full.error

  if (
    error &&
    (isMissingColumnError(error, 'human_takeover') ||
      isMissingColumnError(error, 'customer_name') ||
      isMissingColumnError(error, 'human_takeover_until') ||
      isMissingColumnError(error, 'last_inbound'))
  ) {
    const legacy = await supabase
      .from('intake_sessions')
      .select(SESSION_SELECT_LEGACY)
      .order('updated_at', { ascending: false })
      .limit(100)
    rows = (legacy.data ?? null) as Record<string, unknown>[] | null
    error = legacy.error
  }

  if (error && (isMissingTableError(error, 'stores') || /stores/i.test(error.message))) {
    const bare = await supabase
      .from('intake_sessions')
      .select(SESSION_SELECT_BARE)
      .order('updated_at', { ascending: false })
      .limit(100)
    rows = (bare.data ?? null) as Record<string, unknown>[] | null
    error = bare.error
  }

  if (error) {
    if (isSupabaseSchemaError(error)) {
      if (!testAuthAllowed()) throw new AuthError('Inbox backend unavailable', 503)
      return {
        sessions: enrichMemorySessions(seedDemoInboxIfEmpty()).filter((s) => canAccessInboxSession(actor, s)),
        backend: 'memory',
      }
    }
    throw new Error(error.message)
  }

  const scopedRows = (rows ?? []).map((row) => ({
    session: mapSessionRow(row),
    scope: storeScopeFromRow(row),
  }))
  if (scopedRows.length === 0) {
    if (!testAuthAllowed()) return { sessions: [], backend: 'supabase' }
    return {
      sessions: enrichMemorySessions(seedDemoInboxIfEmpty()).filter((s) => canAccessInboxSession(actor, s)),
      backend: 'memory',
    }
  }

  // Filter AFTER joining store region/org — regional_manager otherwise always saw [].
  const visibleSessions = scopedRows
    .filter(({ session, scope }) =>
      canAccessInboxSession(actor, {
        store_id: session.store_id,
        country_id: session.country_id || null,
        region_id: scope.region_id,
        organization_id: scope.organization_id,
      }),
    )
    .map(({ session }) => session)
  const waIds = [...new Set(visibleSessions.map((s) => s.wa_id))]
  const storeIds = [
    ...new Set(
      scopedRows.map(({ session }) => session.store_id).filter(Boolean),
    ),
  ] as string[]

  const storeMap = new Map<
    string,
    {
      name: string
      code: string
      manager_name?: string | null
      manager_phone?: string | null
    }
  >()
  const ticketBySession = new Map<string, { priorities: string[]; customerName: string | null }>()
  const sessionKey = (session: InboxSession, organizationId: string | null) => `${session.wa_id}\u0000${session.store_id ?? ''}\u0000${organizationId ?? ''}`
  const lastMsgByWa = new Map<
    string,
    { body: string; direction: 'inbound' | 'outbound' }
  >()

  const [storesRes, ticketsRes, recentRes] = await Promise.all([
    storeIds.length > 0
      ? supabase
          .from('stores')
          .select('id, code, name, manager_name, manager_phone')
          .in('id', storeIds)
      : Promise.resolve({
          data: [] as {
            id: string
            code: string
            name: string
            manager_name: string | null
            manager_phone: string | null
          }[],
        }),
    waIds.length > 0
      ? supabase
          .from('tickets')
          .select('id, reporter_phone, reporter_name, priority, status, store_id, organization_id')
          .in('reporter_phone', waIds)
          .in('store_id', storeIds)
          .in('status', [...OPEN_TICKET_STATUSES])
          .limit(200)
      : Promise.resolve({
          data: [] as {
            id: string
            reporter_phone: string | null
            reporter_name: string | null
            priority: string
            status: string
            store_id: string | null
            organization_id: string | null
          }[],
        }),
    waIds.length > 0
      ? supabase
          .from('inbox_messages')
          .select('wa_id, body, direction, created_at')
          .in('wa_id', waIds)
          .order('created_at', { ascending: false })
          .limit(300)
      : Promise.resolve({
          data: [] as {
            wa_id: string
            body: string
            direction: string
            created_at: string
          }[],
        }),
  ])

  for (const s of storesRes.data ?? []) {
    storeMap.set(s.id, {
      name: s.name,
      code: s.code,
      manager_name: s.manager_name ?? null,
      manager_phone: s.manager_phone ?? null,
    })
  }

  for (const t of ticketsRes.data ?? []) {
    const phone = t.reporter_phone as string | null
    if (!phone || !t.store_id || !t.organization_id) continue
    for (const session of visibleSessions) {
      if (session.wa_id !== phone || session.store_id !== t.store_id) continue
      const key = sessionKey(session, t.organization_id as string)
      const cur = ticketBySession.get(key) ?? { priorities: [], customerName: null }
      if (t.priority) cur.priorities.push(t.priority)
      if (!cur.customerName && t.reporter_name) cur.customerName = t.reporter_name as string
      ticketBySession.set(key, cur)
    }
  }

  for (const m of recentRes.data ?? []) {
    if (lastMsgByWa.has(m.wa_id)) continue
    lastMsgByWa.set(m.wa_id, {
      body: m.body,
      direction: m.direction === 'outbound' ? 'outbound' : 'inbound',
    })
  }

  const views = visibleSessions.map((session) => {
    const ticketCtx = [...ticketBySession.entries()].find(([key]) => key.startsWith(`${session.wa_id}\u0000${session.store_id ?? ''}\u0000`))?.[1]
    const last = lastMsgByWa.get(session.wa_id)
    const storeMeta = session.store_id ? storeMap.get(session.store_id) : undefined
    const managerName =
      storeMeta?.manager_phone &&
      phonesMatch(session.wa_id, storeMeta.manager_phone)
        ? storeMeta.manager_name?.trim() || null
        : null
    return enrichSession(session, {
      storeName: resolveStoreName(
        session.store_id,
        session.store_code,
        storeMap,
      ),
      lastMessage: last?.body ?? session.last_inbound ?? null,
      lastDirection:
        last?.direction ?? (session.last_inbound ? 'inbound' : null),
      openPriorities: ticketCtx?.priorities ?? [],
      customerName:
        session.customer_name?.trim() ||
        ticketCtx?.customerName ||
        managerName ||
        null,
    })
  })

  return { sessions: views, backend: 'supabase' }
}

async function assertSessionAccess(waId: string, actor: Actor): Promise<void> {
  if (!(await supabaseReady())) {
    if (!testAuthAllowed()) throw new AuthError('Inbox backend unavailable', 503)
    const session = memListSessions().find((s) => s.wa_id === waId)
    if (session && canAccessInboxSession(actor, session)) return
    throw new AuthError('אין הרשאה לשיחה זו', 403)
  }
  const { data, error } = await createSystemClient('inbox_authorize').from('intake_sessions').select('store_id, country_id, stores(region_id, organization_id)').eq('wa_id', waId).maybeSingle()
  if (error || !data) throw new AuthError('השיחה לא נמצאה', 404)
  const store = Array.isArray(data.stores) ? data.stores[0] : data.stores
  if (!canAccessInboxSession(actor, { ...data, region_id: store?.region_id, organization_id: store?.organization_id })) throw new AuthError('אין הרשאה לשיחה זו', 403)
}

export async function setSessionTakeover(
  waId: string,
  actor: Actor,
  humanTakeover: boolean,
  opts?: { state?: InboxSession['state'] },
): Promise<InboxSession> {
  await assertSessionAccess(waId, actor)
  const until = humanTakeover ? humanPauseUntilIso() : null

  if (!(await supabaseReady())) {
    return memSetSessionTakeover(waId, humanTakeover, {
      ...opts,
      human_takeover_until: until,
    })
  }

  const supabase = createSystemClient('inbox_takeover')
  const payload: Record<string, unknown> = {
    human_takeover: humanTakeover,
    human_takeover_until: until,
    updated_at: new Date().toISOString(),
  }
  if (opts?.state) payload.state = opts.state

  const { data, error } = await supabase
    .from('intake_sessions')
    .update(payload)
    .eq('wa_id', waId)
    .select(SESSION_SELECT_FULL)
    .single()

  if (error) {
    if (isMissingColumnError(error, 'human_takeover_until')) {
      // Pre-migration: still flip the flag; window expiry needs the column.
      const { data: legacy, error: legacyError } = await supabase
        .from('intake_sessions')
        .update({
          human_takeover: humanTakeover,
          updated_at: new Date().toISOString(),
          ...(opts?.state ? { state: opts.state } : {}),
        })
        .eq('wa_id', waId)
        .select(
          'wa_id, country_id, store_id, store_code, state, pending_description, expires_at, updated_at, human_takeover, last_inbound',
        )
        .single()
      if (legacyError) {
        if (isSupabaseSchemaError(legacyError)) {
          return memSetSessionTakeover(waId, humanTakeover, {
            ...opts,
            human_takeover_until: until,
          })
        }
        throw new Error(legacyError.message)
      }
      return mapSessionRow(legacy as Record<string, unknown>, {
        human_takeover: humanTakeover,
        human_takeover_until: until,
      })
    }
    if (isMissingColumnError(error, 'human_takeover')) {
      const { data: legacy, error: legacyError } = await supabase
        .from('intake_sessions')
        .select(SESSION_SELECT_LEGACY)
        .eq('wa_id', waId)
        .single()
      if (legacyError) {
        if (isSupabaseSchemaError(legacyError)) {
          return memSetSessionTakeover(waId, humanTakeover, {
            ...opts,
            human_takeover_until: until,
          })
        }
        throw new Error(legacyError.message)
      }
      return mapSessionRow(legacy as Record<string, unknown>, {
        human_takeover: humanTakeover,
        human_takeover_until: until,
      })
    }
    if (isSupabaseSchemaError(error)) {
      return memSetSessionTakeover(waId, humanTakeover, {
        ...opts,
        human_takeover_until: until,
      })
    }
    throw new Error(error.message)
  }
  return mapSessionRow(data as Record<string, unknown>)
}

/** Keep ticket reporter names aligned when inbox contact is saved. */
async function syncReporterNameForWa(
  waId: string,
  customerName: string | null | undefined,
) {
  if (customerName === undefined) return
  const name = customerName?.trim() || null
  if (!(await supabaseReady())) {
    for (const ticket of memListTickets()) {
      if (ticket.reporter_phone && phonesMatch(ticket.reporter_phone, waId)) {
        ticket.reporter_name = name
      }
    }
    return
  }
  const digits = waId.replace(/\D/g, '')
  const clauses = [`reporter_phone.eq.${waId}`]
  if (digits.length >= 9) clauses.push(`reporter_phone.ilike.%${digits.slice(-9)}`)
  if (digits.startsWith('972') && digits.length >= 12) {
    clauses.push(`reporter_phone.eq.0${digits.slice(3)}`)
  }
  const supabase = createSystemClient('inbox_sync_reporter_name')
  await supabase.from('tickets').update({ reporter_name: name }).or(clauses.join(','))
}

/** Assign an inbox number to a store, after checking both session and target scope. */
export async function assignSessionStore(
  waId: string,
  storeId: string | null | undefined,
  customerName: string | null | undefined,
  actor: Actor,
): Promise<{ wa_id: string; store_id: string | null; store_code: string | null }> {
  await assertSessionAccess(waId, actor)

  if (!(await supabaseReady())) {
    if (!testAuthAllowed()) throw new AuthError('Inbox backend unavailable', 503)
    const session = memGetSession(waId)
    if (!session) throw new AuthError('השיחה לא נמצאה', 404)
    if (storeId === undefined) {
      const updated = memUpsertSession({ ...session, ...(customerName !== undefined ? { customer_name: customerName } : {}) })
      await syncReporterNameForWa(waId, customerName)
      return { wa_id: waId, store_id: updated.store_id, store_code: updated.store_code }
    }
    if (storeId) {
      const store = memListStores().find((item) => item.id === storeId)
      if (!store || !canAccessInboxSession(actor, { store_id: store.id, country_id: store.country_id, region_id: store.region_id, organization_id: store.organization_id })) throw new AuthError('אין הרשאה לסניף זה', 403)
      const updated = memUpsertSession({ ...session, store_id: store.id, store_code: store.code, ...(customerName !== undefined ? { customer_name: customerName } : {}) })
      await syncReporterNameForWa(waId, customerName)
      return { wa_id: waId, store_id: updated.store_id, store_code: updated.store_code }
    }
    const updated = memUpsertSession({ ...session, store_id: null, store_code: null, ...(customerName !== undefined ? { customer_name: customerName } : {}) })
    await syncReporterNameForWa(waId, customerName)
    return { wa_id: waId, store_id: updated.store_id, store_code: updated.store_code }
  }

  const supabase = createSystemClient('inbox_assign_store')
  if (storeId === undefined) {
    const { data: current, error: currentError } = await supabase.from('intake_sessions').select('store_id, store_code').eq('wa_id', waId).single()
    if (currentError) throw new Error(currentError.message)
    storeId = (current.store_id as string | null) ?? null
  }
  if (!storeId) {
    const { data, error } = await supabase.from('intake_sessions').update({ store_id: null, store_code: null, ...(customerName !== undefined ? { customer_name: customerName } : {}), updated_at: new Date().toISOString() }).eq('wa_id', waId).select('wa_id, store_id, store_code').single()
    if (error) throw new Error(error.message)
    await syncReporterNameForWa(waId, customerName)
    return data as { wa_id: string; store_id: string | null; store_code: string | null }
  }
  const { data: store, error: storeError } = await supabase.from('stores').select('id, code, country_id, region_id, organization_id, manager_name, manager_phone').eq('id', storeId).maybeSingle()
  if (storeError || !store) throw new AuthError('הסניף לא נמצא', 404)
  if (!canAccessInboxSession(actor, { store_id: store.id, country_id: store.country_id, region_id: store.region_id, organization_id: store.organization_id })) throw new AuthError('אין הרשאה לסניף זה', 403)

  // If this WA is the store manager, keep store_phones primary in sync.
  if (store.manager_phone && phonesMatch(waId, store.manager_phone)) {
    const digits = normalizePhoneDigits(waId) || waId.replace(/\D/g, '')
    if (digits) {
      await supabase
        .from('store_phones')
        .update({ is_primary: false })
        .eq('store_id', store.id)
        .eq('is_primary', true)
        .neq('wa_id', digits)
      const { data: existingPhone } = await supabase
        .from('store_phones')
        .select('id')
        .eq('wa_id', digits)
        .maybeSingle()
      if (existingPhone) {
        await supabase
          .from('store_phones')
          .update({
            store_id: store.id,
            is_primary: true,
            label: 'מנהל חנות',
          })
          .eq('id', existingPhone.id)
      } else {
        await supabase.from('store_phones').insert({
          store_id: store.id,
          wa_id: digits,
          is_primary: true,
          label: 'מנהל חנות',
        })
      }
    }
    if (customerName === undefined && store.manager_name?.trim()) {
      customerName = store.manager_name.trim()
    }
  }

  const { data, error } = await supabase.from('intake_sessions').update({ store_id: store.id, store_code: canonicalStoreCode(store.code), ...(customerName !== undefined ? { customer_name: customerName } : {}), updated_at: new Date().toISOString() }).eq('wa_id', waId).select('wa_id, store_id, store_code').single()
  if (error) throw new Error(error.message)
  await syncReporterNameForWa(waId, customerName)
  return data as { wa_id: string; store_id: string | null; store_code: string | null }
}

/**
 * Private ops window for one chat only (bot stays on elsewhere).
 * waiting → open/extend 30m pause for this wa_id
 * handled → clear pause immediately (bot resumes on this number)
 */
export async function markSessionInboxStatus(
  waId: string,
  actor: Actor,
  status: 'handled' | 'waiting',
): Promise<InboxSession> {
  if (status === 'waiting') {
    return setSessionTakeover(waId, actor, true)
  }
  return setSessionTakeover(waId, actor, false)
}

export async function listSessionMessages(waId: string, actor: Actor): Promise<{
  messages: InboxMessage[]
  ticketIds: string[]
  openTickets: InboxOpenTicket[]
  context: InboxSessionContext
  backend: 'memory' | 'supabase'
}> {
  if (!(await supabaseReady())) {
    if (!testAuthAllowed()) throw new AuthError('Inbox backend unavailable', 503)
    const session = memListSessions().find((s) => s.wa_id === waId)
    if (!session || !canAccessInboxSession(actor, session)) throw new AuthError('אין הרשאה לשיחה זו', 403)
    const messages = dedupeThreadMessages(memListInboxMessages(waId)).map((m) => ({
      ...m,
      body: humanizeMessageBody(m.body),
    }))
    const ticketIds = [
      ...new Set(messages.map((m) => m.ticket_id).filter(Boolean)),
    ] as string[]
    const openTickets = ticketsForWa(waId, session.store_id, memListStores().find((store) => store.id === session.store_id)?.organization_id)
    const store_name = resolveStoreName(
      session?.store_id ?? null,
      session?.store_code ?? null,
    )
    const fromTicket =
      memListTickets().find(
        (t) =>
          t.reporter_phone === waId &&
          t.stores?.id === session.store_id &&
          t.organization_id ===
            memListStores().find((store) => store.id === session.store_id)
              ?.organization_id,
      )?.reporter_name ?? null
    const manager =
      !session.customer_name && !fromTicket
        ? await resolveManagerStoreByPhone(waId)
        : null
    const customer_name =
      session.customer_name?.trim() ||
      fromTicket ||
      manager?.managerName?.trim() ||
      null
    for (const id of openTickets.map((t) => t.id)) {
      if (!ticketIds.includes(id)) ticketIds.push(id)
    }
    return {
      messages,
      ticketIds,
      openTickets,
      context: {
        store_name,
        store_code: session?.store_code ?? null,
        customer_name,
        wa_display: formatWaDisplay(waId),
        openTickets,
      },
      backend: 'memory',
    }
  }

  const supabase = createSystemClient('inbox_messages_list')
  const { data: accessSessions, error: accessError } = await supabase.from('intake_sessions').select('store_id, country_id, stores(region_id, organization_id)').eq('wa_id', waId)
  if (accessError || !accessSessions?.length) throw new AuthError('השיחה לא נמצאה', 404)
  const authorizedCandidates = accessSessions.map((row) => { const st = Array.isArray(row.stores) ? row.stores[0] : row.stores; return { ...row, region_id: st?.region_id, organization_id: st?.organization_id } }).filter((row) => canAccessInboxSession(actor, row))
  if (authorizedCandidates.length !== 1) throw new AuthError('אין הרשאה לשיחה זו', 403)
  const accessSession = authorizedCandidates[0]
  const accessStore = Array.isArray(accessSession.stores) ? accessSession.stores[0] : accessSession.stores
  const authorizedSession = { ...accessSession, region_id: accessStore?.region_id, organization_id: accessStore?.organization_id }
  if (!canAccessInboxSession(actor, authorizedSession)) throw new AuthError('אין הרשאה לשיחה זו', 403)
  const [inboxResult, ticketsResult, sessionResult, waResult] = await Promise.all([
    supabase
      .from('inbox_messages')
      .select('id, direction, body, created_at, ticket_id')
      .eq('wa_id', waId)
      .order('created_at', { ascending: true }),
    supabase
      .from('tickets')
      .select(
        'id, display_number, title, status, priority, description, reporter_name, store_id, stores(code, name)',
      )
      .eq('reporter_phone', waId)
      .eq('store_id', authorizedSession.store_id)
      .eq('organization_id', authorizedSession.organization_id)
      .limit(20),
    supabase
      .from('intake_sessions')
      .select('store_id, store_code, customer_name')
      .eq('wa_id', waId)
      .maybeSingle(),
    supabase
      .from('whatsapp_messages')
      .select('id, direction, body, created_at, ticket_id')
      .eq('wa_id', waId)
      .order('created_at', { ascending: true }),
  ])

  const { data: inboxRows, error } = inboxResult

  if (error) {
    if (
      isMissingTableError(error, 'inbox_messages') ||
      isSupabaseSchemaError(error)
    ) {
      const messages = memListInboxMessages(waId)
      const ticketIds = [
        ...new Set(messages.map((m) => m.ticket_id).filter(Boolean)),
      ] as string[]
      const session = memListSessions().find((s) => s.wa_id === waId)
      if (!session || !canAccessInboxSession(actor, session)) throw new AuthError('אין הרשאה לשיחה זו', 403)
      const openTickets = ticketsForWa(waId, session.store_id, memListStores().find((store) => store.id === session.store_id)?.organization_id)
      return {
        messages,
        ticketIds,
        openTickets,
        context: {
          store_name: resolveStoreName(
            session?.store_id ?? null,
            session?.store_code ?? null,
          ),
          store_code: session?.store_code ?? null,
          customer_name:
            session?.customer_name ?? memListTickets().find((t) => t.reporter_phone === waId && t.stores?.id === session?.store_id && t.organization_id === memListStores().find((store) => store.id === session?.store_id)?.organization_id)
              ?.reporter_name ?? null,
          wa_display: formatWaDisplay(waId),
          openTickets,
        },
        backend: 'memory',
      }
    }
    throw new Error(error.message)
  }

  const tickets = ticketsResult.data ?? []

  const ticketIds = tickets.map((t) => t.id)
  const openTickets: InboxOpenTicket[] = tickets
    .filter((t) =>
      OPEN_TICKET_STATUSES.includes(
        t.status as (typeof OPEN_TICKET_STATUSES)[number],
      ),
    )
    .map((t) => {
      const stores = t.stores as
        | { code: string; name: string }
        | { code: string; name: string }[]
        | null
      const store = Array.isArray(stores) ? stores[0] : stores
      return {
        id: t.id,
        display_number: t.display_number,
        title: t.title,
        status: t.status,
        priority: t.priority,
        description: t.description ?? '',
        store_code: store?.code ?? null,
        store_name: store?.name ?? null,
      }
    })

  const ticketMessages: InboxMessage[] = []

  if (ticketIds.length > 0) {
    const { data: tMsgs } = await supabase
      .from('ticket_messages')
      .select('id, direction, body, created_at, ticket_id')
      .in('ticket_id', ticketIds)
      .order('created_at', { ascending: true })

    for (const m of tMsgs ?? []) {
      if (!m.body) continue
      ticketMessages.push({
        id: m.id,
        direction: m.direction === 'outbound' ? 'outbound' : 'inbound',
        body: m.body,
        created_at: m.created_at,
        ticket_id: m.ticket_id,
      })
    }
  }

  const { count: waSessionCount } = await supabase.from('intake_sessions').select('wa_id', { count: 'exact', head: true }).eq('wa_id', waId)
  const safeInboxRows = waSessionCount === 1 ? (inboxRows ?? []) : []
  const waMessages: InboxMessage[] = []
  if (!waResult.error) {
    for (const m of waResult.data ?? []) {
      if (!m.body) continue
      waMessages.push({
        id: `wa-${m.id}`,
        direction: m.direction === 'outbound' ? 'outbound' : 'inbound',
        body: m.body,
        created_at: m.created_at,
        ticket_id: m.ticket_id,
      })
    }
  }
  const combined = [
    ...safeInboxRows.map((m) => ({
      id: m.id,
      direction: m.direction as 'inbound' | 'outbound',
      body: m.body,
      created_at: m.created_at,
      ticket_id: m.ticket_id,
    })),
    ...ticketMessages,
    ...waMessages,
  ].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  // Ops replies / intake may land in multiple tables — collapse near-duplicates.
  const messages = dedupeThreadMessages(combined).map((m) => ({
    ...m,
    body: humanizeMessageBody(m.body),
  }))

  const sessionRow = sessionResult.data

  const store_name = resolveStoreName(
    (sessionRow?.store_id as string | null) ?? null,
    (sessionRow?.store_code as string | null) ?? null,
  )
  const fromTicket = tickets.find((t) => t.reporter_name)?.reporter_name ?? null
  const fromSession = (sessionRow?.customer_name as string | null)?.trim() || null
  const manager =
    !fromSession && !fromTicket
      ? await resolveManagerStoreByPhone(waId)
      : null
  const customer_name =
    fromSession ||
    fromTicket ||
    manager?.managerName?.trim() ||
    null

  return {
    messages,
    ticketIds,
    openTickets,
    context: {
      store_name,
      store_code: (sessionRow?.store_code as string | null) ?? null,
      customer_name,
      wa_display: formatWaDisplay(waId),
      openTickets,
    },
    backend: 'supabase',
  }
}


async function assertTicketBelongsToSession(ticketId: string, waId: string, actor: Actor): Promise<void> {
  if (!(await supabaseReady())) {
    const session = memListSessions().find((s) => s.wa_id === waId)
    const ticket = memListTickets().find((t) => t.id === ticketId && t.reporter_phone === waId && t.stores?.id === session?.store_id && t.organization_id === memListStores().find((store) => store.id === session?.store_id)?.organization_id)
    if (!session || !canAccessInboxSession(actor, session) || !ticket) throw new AuthError('אין הרשאה לקריאה זו', 403)
    return
  }
  const supabase = createSystemClient('inbox_ticket_authorize')
  const { data: session } = await supabase.from('intake_sessions').select('store_id, country_id, stores(region_id, organization_id)').eq('wa_id', waId).maybeSingle()
  if (!session) throw new AuthError('השיחה לא נמצאה', 404)
  const store = Array.isArray(session.stores) ? session.stores[0] : session.stores
  const scoped = { ...session, region_id: store?.region_id, organization_id: store?.organization_id }
  const { data: ticket } = await supabase.from('tickets').select('id, store_id, country_id, region_id, organization_id, reporter_phone').eq('id', ticketId).maybeSingle()
  if (!canAccessInboxSession(actor, scoped) || !ticket || ticket.reporter_phone !== waId || ticket.store_id !== scoped.store_id || ticket.organization_id !== scoped.organization_id || ticket.country_id !== scoped.country_id || ticket.region_id !== scoped.region_id) throw new AuthError('אין הרשאה לקריאה זו', 403)
}

export async function replyToSession(input: {
  actor: Actor
  waId: string
  text: string
  countryId?: string
  ticketId?: string | null
}): Promise<{ message: InboxMessage; send: Awaited<ReturnType<typeof sendWhatsAppText>> }> {
  const text = input.text.trim()
  await assertSessionAccess(input.waId, input.actor)
  if (!text) throw new Error('הודעה ריקה')

  const waId = input.waId.replace(/\D/g, '') || input.waId
  if (!waId) throw new Error('מזהה WhatsApp חסר')

  const ticketIdInput = sanitizeOptionalUuid(input.ticketId ?? undefined) ?? null
  if (input.ticketId && !ticketIdInput) throw new AuthError('אין הרשאה לקריאה זו', 403)
  if (ticketIdInput) await assertTicketBelongsToSession(ticketIdInput, input.waId, input.actor)
  // Israel-only pilot: ignore client countryId entirely.
  void input.countryId

  if (!(await supabaseReady())) {
    const message = memAddInboxMessage({
      wa_id: waId,
      direction: 'outbound',
      body: text,
      ticket_id: ticketIdInput,
    })
    const send = await sendWhatsAppText({
      toWaId: waId,
      text,
      ticketId: ticketIdInput,
      purpose: 'ops_reply',
      forceDryRun: true,
    })
    // Pause only after a completed ops reply (even dry-run in memory mode).
    const existing = memListSessions().find((s) => s.wa_id === waId)
    if (existing) {
      memSetSessionTakeover(waId, true, {
        human_takeover_until: humanPauseUntilIso(),
      })
    }
    return { message, send }
  }

  const supabase = createSystemClient('inbox_reply')

  // Israel-only pilot: always resolve IL.
  let countryId: string
  let phoneNumberIdCandidate: string | null = null
  let lastInboundAt: string | null = null

  {
    const { data: il } = await supabase
      .from('countries')
      .select('id, whatsapp_phone_number_id')
      .eq('code', 'IL')
      .maybeSingle()
    if (!il?.id) throw new Error('לא נמצאה מדינה לשליחה (IL)')
    countryId = il.id
    phoneNumberIdCandidate = il.whatsapp_phone_number_id ?? null
  }

  // Last inbound timestamp (message body lives in last_inbound — do NOT Date.parse it).
  {
    const { data: lastIn } = await supabase
      .from('inbox_messages')
      .select('created_at')
      .eq('wa_id', waId)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    lastInboundAt = (lastIn?.created_at as string | undefined) ?? null
    if (!lastInboundAt) {
      const { data: waIn } = await supabase
        .from('whatsapp_messages')
        .select('created_at')
        .eq('wa_id', waId)
        .eq('direction', 'inbound')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      lastInboundAt = (waIn?.created_at as string | undefined) ?? null
    }
  }

  // Prefer valid Meta ID from IL country; otherwise env (never demo placeholders).
  const phoneNumberId = resolveWhatsAppPhoneNumberId(phoneNumberIdCandidate)

  // Active customer-care window: free-form text is allowed for 24h after last inbound.
  if (lastInboundAt) {
    const lastMs = Date.parse(lastInboundAt)
    if (Number.isFinite(lastMs) && Date.now() - lastMs > CUSTOMER_CARE_WINDOW_MS) {
      throw new Error(
        'חלון 24 השעות של WhatsApp פג עבור שיחה זו. יש לשלוח תבנית (template) מאושרת, או לבקש מהלקוח לשלוח הודעה חדשה.',
      )
    }
  }

  // Send first — never mute the bot if Graph delivery failed.
  const send = await sendWhatsAppText({
    toWaId: waId,
    text,
    phoneNumberId,
    ticketId: ticketIdInput,
    supabase,
    purpose: 'ops_reply',
  })

  if (!send.ok || send.dryRun) {
    throw new Error(
      send.dryRun
        ? 'ההודעה לא נשלחה ללקוח כרגע. בדקו את חיבור WhatsApp בהגדרות.'
        : 'שליחת ההודעה נכשלה. נסו שוב בעוד רגע.',
    )
  }

  // Open / extend a short private window for THIS chat only.
  // Bot keeps running on every other number.
  const pauseUntil = humanPauseUntilIso()
  {
    const { error: pauseError } = await supabase
      .from('intake_sessions')
      .update({
        human_takeover: true,
        human_takeover_until: pauseUntil,
        updated_at: new Date().toISOString(),
      })
      .eq('wa_id', waId)
    if (pauseError && isMissingColumnError(pauseError, 'human_takeover_until')) {
      await supabase
        .from('intake_sessions')
        .update({
          human_takeover: true,
          updated_at: new Date().toISOString(),
        })
        .eq('wa_id', waId)
    }
  }

  let ticketId = ticketIdInput
  if (ticketId) {
    const { data: ticket } = await supabase
      .from('tickets')
      .select('id')
      .eq('id', ticketId)
      .maybeSingle()
    if (!ticket) ticketId = null
  }

  const { data, error } = await supabase
    .from('inbox_messages')
    .insert({
      country_id: countryId,
      wa_id: waId,
      direction: 'outbound',
      body: text,
      ticket_id: ticketId,
    })
    .select('id, direction, body, created_at, ticket_id')
    .single()

  if (error) {
    if (isMissingTableError(error, 'inbox_messages') || isSupabaseSchemaError(error)) {
      const message = memAddInboxMessage({
        wa_id: waId,
        direction: 'outbound',
        body: text,
        ticket_id: ticketId,
      })
      return { message, send }
    }
    throw new Error(error.message)
  }

  // Also mirror on whatsapp_messages when present (best-effort audit).
  const { data: countryRow } = await supabase
    .from('countries')
    .select('organization_id')
    .eq('id', countryId)
    .maybeSingle()
  if (countryRow?.organization_id) {
    await supabase.from('whatsapp_messages').insert({
      organization_id: countryRow.organization_id,
      country_id: countryId,
      wa_id: waId,
      direction: 'outbound',
      body: text,
      meta_message_id: send.waMessageId,
      ticket_id: ticketId,
    })
  }

  return {
    message: {
      id: data.id,
      direction: 'outbound',
      body: data.body,
      created_at: data.created_at,
      ticket_id: data.ticket_id,
    },
    send,
  }
}

/** Remove a conversation from the ops inbox (does not delete Meta history). */
export async function clearInboxSession(
  waIdRaw: string, actor: Actor,
): Promise<{ cleared: boolean; backend: 'memory' | 'supabase' }> {
  const waId = waIdRaw.replace(/\D/g, '') || waIdRaw
  if (!waId) throw new Error('מזהה WhatsApp חסר')
  await assertSessionAccess(waId, actor)

  if (!(await supabaseReady())) {
    const cleared = memDeleteSession(waId)
    return { cleared, backend: 'memory' }
  }

  const supabase = createSystemClient('inbox_clear_session')
  await supabase.from('inbox_messages').delete().eq('wa_id', waId)
  const { error } = await supabase
    .from('intake_sessions')
    .delete()
    .eq('wa_id', waId)

  if (error) {
    if (isSupabaseSchemaError(error)) {
      const cleared = memDeleteSession(waId)
      return { cleared, backend: 'memory' }
    }
    throw new Error(error.message)
  }

  memDeleteSession(waId)
  return { cleared: true, backend: 'supabase' }
}

/**
 * Send an approved Meta template when the 24h care window has closed.
 * Template name: WHATSAPP_SESSION_TEMPLATE (default maintainos_followup).
 * @see docs/META_WHATSAPP_TEMPLATE_FOLLOWUP.md
 */
export async function sendSessionTemplate(input: {
  actor: Actor
  waId: string
  templateName?: string
  ticketId?: string | null
  bodyParameters?: string[]
}): Promise<{
  message: InboxMessage
  send: Awaited<ReturnType<typeof sendWhatsAppTemplate>>
}> {
  const waId = input.waId.replace(/\D/g, '') || input.waId
  if (!waId) throw new Error('מזהה WhatsApp חסר')
  await assertSessionAccess(waId, input.actor)

  const templateName =
    input.templateName?.trim() || defaultSessionTemplateName()
  const ticketId = sanitizeOptionalUuid(input.ticketId ?? undefined) ?? null
  if (input.ticketId && !ticketId) throw new AuthError('אין הרשאה לקריאה זו', 403)
  if (ticketId) await assertTicketBelongsToSession(ticketId, waId, input.actor)
  const bodyParameters = input.bodyParameters
  // Persist Meta name for audit; desk UI humanizes via humanizeMessageBody.
  const label = `[תבנית] ${templateName}`

  if (!(await supabaseReady())) {
    const send = await sendWhatsAppTemplate({
      toWaId: waId,
      templateName,
      bodyParameters,
      ticketId,
      purpose: 'ops_reply',
      forceDryRun: true,
    })
    const message = memAddInboxMessage({
      wa_id: waId,
      direction: 'outbound',
      body: label,
      ticket_id: ticketId,
    })
    return { message, send }
  }

  const supabase = createSystemClient('inbox_template')
  const phoneNumberId = resolveWhatsAppPhoneNumberId(null)
  const send = await sendWhatsAppTemplate({
    toWaId: waId,
    templateName,
    bodyParameters,
    phoneNumberId,
    ticketId,
    supabase,
    purpose: 'ops_reply',
  })

  if (!send.ok || send.dryRun) {
    throw new Error(
      send.dryRun
        ? 'ההודעה לא נשלחה ללקוח כרגע. בדקו את חיבור WhatsApp בהגדרות.'
        : 'שליחת הודעת מעקב נכשלה',
    )
  }

  const countryId = MEM_COUNTRY_ID
  const { data, error } = await supabase
    .from('inbox_messages')
    .insert({
      country_id: countryId,
      wa_id: waId,
      direction: 'outbound',
      body: label,
      ticket_id: ticketId,
    })
    .select('id, direction, body, created_at, ticket_id')
    .single()

  if (error) {
    if (
      isMissingTableError(error, 'inbox_messages') ||
      isSupabaseSchemaError(error)
    ) {
      const message = memAddInboxMessage({
        wa_id: waId,
        direction: 'outbound',
        body: label,
        ticket_id: ticketId,
      })
      return { message, send }
    }
    throw new Error(error.message)
  }

  return {
    message: {
      id: data.id,
      direction: 'outbound',
      body: data.body,
      created_at: data.created_at,
      ticket_id: data.ticket_id,
    },
    send,
  }
}
