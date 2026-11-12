import { memAddMessage, memGet, supabaseReady } from '@/lib/data/memory-store'
import { createSystemClient } from '@/lib/supabase/system'
import { normalizePhoneDigits } from '@/lib/phone'
import { captureError } from '@/lib/monitoring'
import { managerPhoneForStoreCode } from '@/modules/stores/manager-identity'
import { upsertProfessional } from '@/modules/professionals/service'
import { notifyProfessionalSms } from '@/modules/pro/notify-sms'
import {
  appendEvent,
  getById,
  listTickets,
  updateStatus,
  type TicketDetail,
} from '@/modules/tickets/service'
import { ticketIsUrgent } from '@/modules/tickets/urgent'
import {
  STORE_CONFIRM_BUTTON_TITLE,
  STORE_REJECT_BUTTON_TITLE,
  storeConfirmButtonId,
  storeRejectButtonId,
} from '@/modules/tickets/wa-store-confirm'
import { sendWhatsAppText } from '@/modules/whatsapp/send'
import type { ClosedEngagementCost } from './cost'

export type Engagement = {
  id: string
  organizationId: string
  storeId: string
  storeCode: string
  storeName: string
  ticketId: string
  bundledTicketIds: string[]
  midragSpId: string | null
  professionalId: string | null
  professionalName: string
  professionalPhone: string
  approvedAmount: number
  approvedBy: string
  approvedAt: string
  status: 'locked' | 'cancelled'
  closedAt: string | null
  /** Present on the lock that just ran. Not a stored column. */
  handoff?: { ok: boolean; line: string }
  /** Present on the lock that just ran. Not a stored column. */
  proSms?: { ok: boolean; line: string; portalUrl?: string }
}

/**
 * Process-wide store (globalThis) — same pattern as memory-store tickets.
 * Plain module `const` breaks under Next.js server-action vs RSC module
 * duplication: lock writes to one instance, page read sees an empty other.
 */
type EngagementMem = {
  rows: Engagement[]
  handoffSent: Map<string, { ok: boolean; line: string }>
}

function engagementStore(): EngagementMem {
  const g = globalThis as typeof globalThis & {
    __maintainosEngagements?: EngagementMem
  }
  if (!g.__maintainosEngagements) {
    g.__maintainosEngagements = {
      rows: [],
      handoffSent: new Map(),
    }
  }
  return g.__maintainosEngagements
}

function memoryRows(): Engagement[] {
  return engagementStore().rows
}

function handoffSentMap(): Map<string, { ok: boolean; line: string }> {
  return engagementStore().handoffSent
}

export function resetEngagementsForTests() {
  const store = engagementStore()
  store.rows.splice(0, store.rows.length)
  store.handoffSent.clear()
}

/** Drops the process cache only. A successful send still lives on the ticket. */
export function clearHandoffCacheForTests() {
  handoffSentMap().clear()
}

const WAITING = new Set(['new', 'triaged', 'awaiting_info', 'assigned'])

function rowToEngagement(row: Record<string, unknown>): Engagement {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id ?? ''),
    storeId: String(row.store_id ?? ''),
    storeCode: String(row.store_code ?? ''),
    storeName: String(row.store_name ?? ''),
    ticketId: String(row.ticket_id),
    bundledTicketIds: Array.isArray(row.bundled_ticket_ids)
      ? row.bundled_ticket_ids.map(String)
      : [],
    midragSpId: (row.midrag_sp_id as string | null) ?? null,
    professionalId: (row.professional_id as string | null) ?? null,
    professionalName: String(row.professional_name ?? ''),
    professionalPhone: String(row.professional_phone ?? ''),
    approvedAmount: Number(row.approved_amount),
    approvedBy: String(row.approved_by ?? ''),
    approvedAt: String(row.approved_at ?? row.created_at ?? ''),
    status: row.status === 'cancelled' ? 'cancelled' : 'locked',
    closedAt: (row.closed_at as string | null) ?? null,
  }
}

export async function listEngagements(organizationId?: string): Promise<Engagement[]> {
  if (await supabaseReady()) {
    const supabase = createSystemClient('engagements')
    let query = supabase.from('engagements').select('*').order('approved_at', { ascending: false }).limit(2001)
    if (organizationId) query = query.eq('organization_id', organizationId)
    const { data, error } = await query
    if (!error && data) return data.map((row) => rowToEngagement(row))
  }
  return [...memoryRows()].sort((a, b) => (a.approvedAt < b.approvedAt ? 1 : -1))
}

/** Rebuild a locked engagement from the ticket timeline when the engagements row is missing. */
async function engagementFromTicketEvents(
  ticketId: string,
): Promise<Engagement | null> {
  const ticket = await getById(ticketId)
  if (!ticket || ticket.status !== 'engaged') return null
  for (const event of [...ticket.events].reverse()) {
    if (event.event_type !== 'engagement_locked') continue
    const payload = (event.payload ?? {}) as Record<string, unknown>
    const phone = String(payload.professionalPhone ?? '').trim()
    const name = String(payload.professionalName ?? '').trim()
    if (!name || phone.replace(/\D/g, '').length < 9) continue
    const bundled = Array.isArray(payload.bundled)
      ? payload.bundled.map(String).filter(Boolean)
      : []
    return {
      id: String(payload.engagementId ?? event.id),
      organizationId: ticket.organization_id,
      storeId: ticket.store_id,
      storeCode: ticket.stores?.code ?? '',
      storeName: ticket.stores?.name ?? '',
      ticketId: ticket.id,
      bundledTicketIds: bundled,
      midragSpId: null,
      professionalId: null,
      professionalName: name,
      professionalPhone: phone,
      approvedAmount: Number(payload.approvedAmount ?? 0) || 0,
      approvedBy: String(payload.approvedBy ?? ''),
      approvedAt: event.created_at,
      status: 'locked',
      closedAt: null,
    }
  }
  return null
}

export async function lockedEngagementFor(ticketId: string): Promise<Engagement | null> {
  const rows = await listEngagements()
  const found =
    rows.find(
      (row) =>
        row.status === 'locked' &&
        (row.ticketId === ticketId || row.bundledTicketIds.includes(ticketId)),
    ) ?? null
  if (found) return found
  return engagementFromTicketEvents(ticketId)
}

export async function findTicketAwaitingAri(): Promise<TicketDetail | null> {
  const { tickets } = await listTickets({
    limit: 150,
    statuses: [...WAITING],
  })
  const waiting = tickets
    .filter((ticket) => WAITING.has(ticket.status) && ticketIsUrgent(ticket))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  for (const ticket of waiting) {
    const locked = await lockedEngagementFor(ticket.id)
    if (!locked) {
      const full = await getById(ticket.id)
      if (full) return full
    }
  }
  return null
}

async function engagementFaultLabels(ticketId: string, bundledTicketIds: string[]): Promise<string[]> {
  const labels: string[] = []
  for (const id of [ticketId, ...bundledTicketIds]) {
    const ticket = await getById(id)
    if (!ticket) continue
    const number = ticket.display_number || ticket.number || ticket.id.slice(0, 8)
    labels.push(`#${number}${ticket.title || ticket.description ? ` — ${(ticket.title || ticket.description).slice(0, 100)}` : ''}`)
  }
  return labels
}

function handoffText(input: {
  name: string
  phone: string
  scope?: string | null
  faults?: string[]
}): string {
  // Store managers get pro + contact only — never the approved price.
  return [
    'ארי אישר שאיש המקצוע יגיע לטפל בתקלות:',
    ...(input.faults ?? []).map((fault) => `• ${fault}`),
    `איש המקצוע: ${input.name}`,
    `טלפון: ${input.phone}`,
    input.scope?.trim() ? `עבודה: ${input.scope.trim()}` : null,
    'תאמו איתו ישירות את מועד ההגעה.',
    'כשהעבודה תסתיים, אשרו אם התקלות סודרו.',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

export type StoreHandoff = { ok: boolean; line: string }

function handoffFromRaw(raw: unknown, idempotencyKey: string): StoreHandoff | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (row.delivered !== true || row.kind !== 'engagement_locked') return null
  if (row.idempotencyKey !== idempotencyKey) return null
  return {
    ok: true,
    line: typeof row.line === 'string' ? row.line : 'מנהל החנות קיבל את הפרטים',
  }
}

function handoffFromEvent(payload: unknown, engagementId: string): StoreHandoff | null {
  if (!payload || typeof payload !== 'object' || !engagementId) return null
  const row = payload as Record<string, unknown>
  if (row.ok !== true || String(row.engagementId ?? '') !== engagementId) return null
  return {
    ok: true,
    line: typeof row.line === 'string' ? row.line : 'מנהל החנות קיבל את הפרטים',
  }
}

function memorySuccessfulHandoff(
  ticketId: string,
  idempotencyKey: string,
  engagementId: string,
): StoreHandoff | null {
  const ticket = memGet(ticketId)
  if (!ticket) return null
  for (const message of [...ticket.messages].reverse()) {
    const found = handoffFromRaw(message.raw, idempotencyKey)
    if (found) return found
  }
  for (const event of [...ticket.events].reverse()) {
    if (event.event_type !== 'store_handoff') continue
    const found = handoffFromEvent(event.payload, engagementId)
    if (found) return found
  }
  return null
}

/** A successful send survives a process restart. A failed send does not. */
async function persistedSuccessfulHandoff(
  ticketId: string,
  idempotencyKey: string,
): Promise<StoreHandoff | null> {
  const engagementId = idempotencyKey.startsWith('engagement:')
    ? idempotencyKey.slice('engagement:'.length)
    : ''
  if (!(await supabaseReady())) {
    return memorySuccessfulHandoff(ticketId, idempotencyKey, engagementId)
  }
  try {
    const supabase = createSystemClient('engagements')
    const messages = await supabase
      .from('ticket_messages')
      .select('raw')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(40)
    if (!messages.error) {
      for (const row of messages.data ?? []) {
        const found = handoffFromRaw(row.raw, idempotencyKey)
        if (found) return found
      }
    }
    const events = await supabase
      .from('ticket_events')
      .select('payload')
      .eq('ticket_id', ticketId)
      .eq('event_type', 'store_handoff')
      .order('created_at', { ascending: false })
      .limit(20)
    if (!events.error) {
      for (const row of events.data ?? []) {
        const found = handoffFromEvent(row.payload, engagementId)
        if (found) return found
      }
    }
  } catch {
    return null
  }
  return null
}

async function recordHandoff(input: {
  ticketId: string
  body: string
  delivered: boolean
  line: string
  idempotencyKey: string
}) {
  const raw = {
    kind: 'engagement_locked',
    delivered: input.delivered,
    line: input.line,
    idempotencyKey: input.idempotencyKey,
  }
  const ready = await supabaseReady()
  if (ready) {
    const supabase = createSystemClient('engagements')
    await supabase.from('ticket_messages').insert({
      ticket_id: input.ticketId,
      channel: 'whatsapp',
      direction: 'outbound',
      body: input.body,
      raw,
    })
    return
  }
  if (memGet(input.ticketId)) {
    memAddMessage(input.ticketId, {
      channel: 'whatsapp',
      direction: 'outbound',
      body: input.body,
      raw,
    })
  }
}

/** Sends the store handoff only after the engagement row exists. A repeat of the same key does not send twice. */
async function tellStore(input: {
  ticketId: string
  storeCode: string
  reporterPhone: string | null
  body: string
  idempotencyKey: string
}): Promise<StoreHandoff> {
  const cached = handoffSentMap().get(input.idempotencyKey)
  if (cached?.ok) return cached
  const prior = await persistedSuccessfulHandoff(input.ticketId, input.idempotencyKey)
  if (prior) {
    handoffSentMap().set(input.idempotencyKey, prior)
    return prior
  }

  const manager = await managerPhoneForStoreCode(input.storeCode)
  const phones = [manager, input.reporterPhone]
    .map((phone) => normalizePhoneDigits(phone))
    .filter((phone): phone is string => phone != null && phone.length >= 9)
    .filter((phone, index, all) => all.indexOf(phone) === index)

  if (phones.length === 0) {
    const missed: StoreHandoff = {
      ok: false,
      line: 'אין מספר למנהל החנות. הפרטים נשמרו ולא נשלחו.',
    }
    await recordHandoff({
      ticketId: input.ticketId,
      body: input.body,
      delivered: false,
      line: missed.line,
      idempotencyKey: input.idempotencyKey,
    })
    return missed
  }

  const ready = await supabaseReady()
  let delivered = false
  let lastError = 'ההודעה למנהל החנות לא יצאה'
  for (const phone of phones) {
    try {
      const sent = await sendWhatsAppText({
        toWaId: phone,
        text: input.body,
        ticketId: input.ticketId,
        purpose: 'status_update',
        forceDryRun: !ready,
        buttons: [
          { id: storeConfirmButtonId(input.ticketId), title: STORE_CONFIRM_BUTTON_TITLE },
          { id: storeRejectButtonId(input.ticketId), title: STORE_REJECT_BUTTON_TITLE },
        ],
      })
      if (sent.ok && !sent.dryRun && !sent.skippedByPolicy) {
        delivered = true
      } else if (!sent.ok) {
        lastError = sent.error || lastError
      } else {
        lastError = 'הפרטים נשמרו. ההודעה לא נמסרה בוואטסאפ.'
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError
    }
  }

  const result: StoreHandoff = delivered
    ? { ok: true, line: 'מנהל החנות קיבל את הפרטים' }
    : { ok: false, line: lastError }
  await recordHandoff({
    ticketId: input.ticketId,
    body: input.body,
    delivered,
    line: result.line,
    idempotencyKey: input.idempotencyKey,
  })
  if (delivered) handoffSentMap().set(input.idempotencyKey, result)
  return result
}

export async function lockEngagement(input: {
  ticketId: string
  bundledTicketIds?: string[]
  midragSpId?: string | null
  professionalId?: string | null
  professionalName: string
  professionalPhone: string
  approvedAmount?: number
  approvedBy: string
  scope?: string | null
}): Promise<Engagement> {
  const name = input.professionalName.trim()
  const phone = input.professionalPhone.trim()
  if (name.length < 2) throw new Error('חסר שם של איש המקצוע')
  if (phone.replace(/\D/g, '').length < 9) throw new Error('חסר טלפון של איש המקצוע')
  const approvedAmount = Number.isFinite(input.approvedAmount) && (input.approvedAmount ?? 0) > 0
    ? input.approvedAmount!
    : 0

  const ticket = await getById(input.ticketId)
  if (!ticket) throw new Error('תקלה לא נמצאה')
  const existing = await lockedEngagementFor(ticket.id)
  if (existing) {
    await tellStore({
      ticketId: existing.ticketId,
      storeCode: existing.storeCode,
      reporterPhone: ticket.reporter_phone,
      idempotencyKey: `engagement:${existing.id}`,
      body: handoffText({
        name: existing.professionalName,
        phone: existing.professionalPhone,
        scope: input.scope,
        faults: await engagementFaultLabels(existing.ticketId, existing.bundledTicketIds),
      }),
    })
    throw new Error('המחיר כבר נעול. לשינוי צריך לבטל ולחזור לתור')
  }
  if (!WAITING.has(ticket.status) && ticket.status !== 'in_progress') {
    throw new Error('התקלה כבר לא ממתינה לאישור')
  }

  const bundled = [...new Set(input.bundledTicketIds ?? [])].filter(
    (id) => id && id !== ticket.id,
  )
  for (const id of bundled) {
    if (await lockedEngagementFor(id)) {
      throw new Error('אחת התקלות שסומנו כבר בביקור אחר')
    }
  }

  const now = new Date().toISOString()
  const engagement: Engagement = {
    id: crypto.randomUUID(),
    organizationId: ticket.organization_id,
    storeId: ticket.store_id,
    storeCode: ticket.stores?.code ?? '',
    storeName: ticket.stores?.name ?? '',
    ticketId: ticket.id,
    bundledTicketIds: bundled,
    midragSpId: input.midragSpId?.trim() || null,
    professionalId: input.professionalId?.trim() || null,
    professionalName: name,
    professionalPhone: phone,
    approvedAmount,
    approvedBy: input.approvedBy,
    approvedAt: now,
    status: 'locked',
    closedAt: null,
  }

  if (await supabaseReady()) {
    const supabase = createSystemClient('engagements')
    const insertRow: Record<string, unknown> = {
      organization_id: engagement.organizationId,
      store_id: engagement.storeId,
      store_code: engagement.storeCode,
      store_name: engagement.storeName,
      ticket_id: engagement.ticketId,
      bundled_ticket_ids: engagement.bundledTicketIds,
      midrag_sp_id: engagement.midragSpId,
      professional_name: engagement.professionalName,
      professional_phone: engagement.professionalPhone,
      approved_amount: engagement.approvedAmount,
      approved_by: engagement.approvedBy,
      approved_at: engagement.approvedAt,
      status: 'locked',
    }
    if (engagement.professionalId) {
      insertRow.professional_id = engagement.professionalId
    }
    const { data, error } = await supabase
      .from('engagements')
      .insert(insertRow)
      .select('*')
      .single()
    if (error || !data) throw new Error(error?.message || 'נעילת המחיר נכשלה')
    Object.assign(engagement, rowToEngagement(data))
  } else {
    memoryRows().unshift(engagement)
  }

  const ids = [engagement.ticketId, ...engagement.bundledTicketIds]
  for (const id of ids) {
    await updateStatus(id, 'engaged', null)
    await appendEvent(id, 'engagement_locked', null, {
      engagementId: engagement.id,
      professionalName: engagement.professionalName,
      professionalPhone: engagement.professionalPhone,
      approvedAmount: engagement.approvedAmount,
      approvedBy: engagement.approvedBy,
      scope: input.scope?.trim() || null,
      bundled: engagement.bundledTicketIds,
    })
  }

  const handoff = await tellStore({
    ticketId: engagement.ticketId,
    storeCode: engagement.storeCode,
    reporterPhone: ticket.reporter_phone,
    idempotencyKey: `engagement:${engagement.id}`,
    body: handoffText({
      name: engagement.professionalName,
      phone: engagement.professionalPhone,
      scope: input.scope,
      faults: await engagementFaultLabels(engagement.ticketId, engagement.bundledTicketIds),
    }),
  })
  engagement.handoff = handoff
  await appendEvent(engagement.ticketId, 'store_handoff', null, {
    engagementId: engagement.id,
    ok: handoff.ok,
    line: handoff.line,
  })

  // Every pro Ari locks + sends lands in the ranked book automatically.
  try {
    const saved = await upsertProfessional({
      full_name: engagement.professionalName,
      phone: engagement.professionalPhone,
      trade: input.scope?.trim() || null,
      source: engagement.midragSpId ? 'midrag' : 'manual',
      notes: `ננעל מאישור ארי · חנות #${engagement.storeCode}`,
    })
    if (!engagement.professionalId && saved.professional.id) {
      engagement.professionalId = saved.professional.id
      if (await supabaseReady()) {
        const supabase = createSystemClient('engagements')
        await supabase
          .from('engagements')
          .update({ professional_id: saved.professional.id })
          .eq('id', engagement.id)
      }
    }
  } catch (err) {
    captureError(err, { route: 'engagement_auto_professional' })
  }

  const faultLines = await engagementFaultLabels(
    engagement.ticketId,
    engagement.bundledTicketIds,
  )
  const proSms = await notifyProfessionalSms({
    professionalPhone: engagement.professionalPhone,
    professionalName: engagement.professionalName,
    storeCode: engagement.storeCode,
    storeName: engagement.storeName,
    faultLines,
    engagementId: engagement.id,
  })
  engagement.proSms = proSms
  await appendEvent(engagement.ticketId, 'pro_sms', null, {
    engagementId: engagement.id,
    ok: proSms.ok,
    line: proSms.line,
    portalUrl: proSms.portalUrl ?? null,
  })

  return engagement
}

export async function cancelEngagement(ticketId: string): Promise<Engagement | null> {
  const current = await lockedEngagementFor(ticketId)
  if (!current) return null
  current.status = 'cancelled'
  if (await supabaseReady()) {
    const supabase = createSystemClient('engagements')
    await supabase.from('engagements').update({ status: 'cancelled' }).eq('id', current.id)
  }
  const ids = [current.ticketId, ...current.bundledTicketIds]
  for (const id of ids) {
    const ticket = await getById(id)
    if (ticket?.status === 'engaged') {
      await updateStatus(id, 'new', null)
    }
    await appendEvent(id, 'engagement_cancelled', null, {
      engagementId: current.id,
    })
  }
  return current
}

export async function markEngagementClosed(ticketId: string, closedAt: string) {
  const current = await lockedEngagementFor(ticketId)
  if (!current || current.closedAt) return
  current.closedAt = closedAt
  if (await supabaseReady()) {
    const supabase = createSystemClient('engagements')
    await supabase.from('engagements').update({ closed_at: closedAt }).eq('id', current.id)
  }
}

export async function engagementTicketIds(ticketId: string): Promise<string[]> {
  const current = await lockedEngagementFor(ticketId)
  if (!current) return [ticketId]
  return [current.ticketId, ...current.bundledTicketIds]
}

export async function closedEngagementCosts(): Promise<ClosedEngagementCost[]> {
  const rows = await listEngagements()
  const closed = rows.filter((row) => row.status === 'locked' && row.closedAt)
  const tickets = await listTickets({ limit: 1000 }).catch(() => ({ tickets: [] }))
  const categoryById = new Map(tickets.tickets.map((ticket) => [ticket.id, ticket.category]))
  return closed.map((row) => ({
    storeCode: row.storeCode,
    storeName: row.storeName,
    approvedAmount: row.approvedAmount,
    closedAt: row.closedAt as string,
    category: categoryById.get(row.ticketId) ?? null,
  }))
}
