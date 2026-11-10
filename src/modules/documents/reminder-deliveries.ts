import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { createSystemClient } from '@/lib/supabase/system'

export type ReminderStage = 'six' | 'two' | 'month' | 'overdue' | 'review'
export type ReminderIdentity = {
  documentId: string
  version: number
  dueAt: string | null
  stage: ReminderStage
  recipient: string
}
type DeliveryStatus = 'sending' | 'sent' | 'failed' | 'dry_run'
type DeliveryRow = {
  delivery_key: string
  document_client_id: string
  document_version: number
  due_at: string | null
  stage: ReminderStage
  recipient: string
  status: DeliveryStatus
  claim_token: string
  lease_until: string
  attempts: number
  last_attempt_at: string
  sent_at: string | null
  provider_message_id: string | null
  last_error: string | null
}
export type ReminderClaim = { key: string; token: string }
export type ClaimResult = { status: 'claimed'; claim: ReminderClaim } | { status: 'sent' | 'busy' }

const TABLE = 'document_reminder_deliveries'
const LEASE_MS = 5 * 60 * 1000
const memory = new Map<string, DeliveryRow>()

/** Dates of cron runs never participate in identity: each phase is sent only once. */
export function reminderDeliveryKey(identity: ReminderIdentity): string {
  return createHash('sha256').update(JSON.stringify([
    identity.documentId,
    identity.version,
    identity.dueAt ? new Date(identity.dueAt).toISOString() : null,
    identity.stage,
    identity.recipient.replace(/\D/g, '').replace(/^0/, '972'),
  ])).digest('hex')
}

export function resetReminderDeliveriesForTests(): void {
  memory.clear()
}

/** Unique insert + token compare-and-swap keeps concurrent cron runs from both sending. */
export async function claimDocumentReminder(identity: ReminderIdentity, now = new Date()): Promise<ClaimResult> {
  const key = reminderDeliveryKey(identity)
  const row: DeliveryRow = {
    delivery_key: key,
    document_client_id: identity.documentId,
    document_version: identity.version,
    due_at: identity.dueAt,
    stage: identity.stage,
    recipient: identity.recipient,
    status: 'sending',
    claim_token: randomUUID(),
    lease_until: new Date(now.getTime() + LEASE_MS).toISOString(),
    attempts: 1,
    last_attempt_at: now.toISOString(),
    sent_at: null,
    provider_message_id: null,
    last_error: null,
  }
  if (process.env.MAINTAINOS_FORCE_MEMORY === '1') {
    const current = memory.get(key)
    if (current?.status === 'sent') return { status: 'sent' }
    if (current?.status === 'sending' && new Date(current.lease_until) > now) return { status: 'busy' }
    row.attempts = (current?.attempts ?? 0) + 1
    memory.set(key, row)
    return { status: 'claimed', claim: { key, token: row.claim_token } }
  }
  const client = createSystemClient('document_reminder_claim')
  const inserted = await client.from(TABLE).insert(row).select('delivery_key').maybeSingle()
  if (!inserted.error) {
    if (!inserted.data) throw new Error('reminder_claim_not_saved')
    return { status: 'claimed', claim: { key, token: row.claim_token } }
  }
  if (inserted.error.code !== '23505') throw new Error(inserted.error.message)
  const current = await client.from(TABLE).select('*').eq('delivery_key', key).maybeSingle()
  if (current.error || !current.data) throw new Error(current.error?.message ?? 'reminder_claim_not_found')
  const existing = current.data as DeliveryRow
  if (existing.status === 'sent') return { status: 'sent' }
  if (existing.status === 'sending' && new Date(existing.lease_until) > now) return { status: 'busy' }
  const retried = await client.from(TABLE).update({
    ...row,
    attempts: existing.attempts + 1,
  }).eq('delivery_key', key).eq('claim_token', existing.claim_token).select('delivery_key').maybeSingle()
  if (retried.error) throw new Error(retried.error.message)
  return retried.data ? { status: 'claimed', claim: { key, token: row.claim_token } } : { status: 'busy' }
}

export async function finishDocumentReminder(
  claim: ReminderClaim,
  result: { status: Exclude<DeliveryStatus, 'sending'>; messageId: string | null; error: string | null },
  now = new Date(),
): Promise<void> {
  if (result.status === 'sent' && !result.messageId) throw new Error('missing_provider_message_id')
  const patch = {
    status: result.status,
    sent_at: result.status === 'sent' ? now.toISOString() : null,
    provider_message_id: result.messageId,
    last_error: result.error,
  }
  if (process.env.MAINTAINOS_FORCE_MEMORY === '1') {
    const row = memory.get(claim.key)
    if (!row || row.claim_token !== claim.token) throw new Error('reminder_lease_lost')
    Object.assign(row, patch)
    return
  }
  const client = createSystemClient('document_reminder_result')
  const saved = await client.from(TABLE).update(patch)
    .eq('delivery_key', claim.key).eq('claim_token', claim.token).select('delivery_key').maybeSingle()
  if (saved.error || !saved.data) throw new Error(saved.error?.message ?? 'reminder_lease_lost')
}
