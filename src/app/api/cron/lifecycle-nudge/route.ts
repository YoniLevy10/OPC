import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logEvent } from '@/lib/logging'
import {
  memAddEvent,
  memFindStoreById,
  memGet,
  memListTickets,
  supabaseReady,
} from '@/lib/data/memory-store'
import { createSystemClient } from '@/lib/supabase/system'
import { normalizePhoneDigits } from '@/lib/phone'
import { getPublicAppUrl } from '@/lib/auth/app-url'
import { notifyPhone } from '@/modules/notify/ari'
import { captureError } from '@/lib/monitoring'

export const runtime = 'nodejs'

/** Feedback starts after recorded execution, never after an approved visit. */
function cronAuthorized(request: Request): boolean {
  if (process.env.MAINTAINOS_FORCE_MEMORY === '1') return true
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}` ||
    request.headers.get('x-cron-secret') === secret ||
    request.headers.get('cron-secret') === secret
}

function nudgeHours(): number {
  const raw = Number(process.env.STORE_CONFIRM_NUDGE_HOURS ?? '4')
  return Number.isFinite(raw) && raw > 0 ? raw : 4
}

type Candidate = {
  id: string
  organization_id: string
  store_id: string
  status: string
  resolved_at: string | null
  store_confirmed_at: string | null
  display_number: string | null
  number: number | null
}

async function loadResolvedAwaitingConfirm(client: SupabaseClient | null): Promise<Candidate[]> {
  if (client) {
    const { data, error } = await client.from('tickets')
      .select('id, organization_id, store_id, status, resolved_at, store_confirmed_at, display_number, number')
      .eq('status', 'resolved')
      .not('resolved_at', 'is', null)
      .is('store_confirmed_at', null)
      .limit(200)
    if (error) throw new Error(error.message)
    if (!data) throw new Error('resolved_work_unavailable')
    return data as Candidate[]
  }
  return memListTickets().filter((ticket) => ticket.status === 'resolved' && !ticket.store_confirmed_at)
}

async function alreadyNudgedRecently(client: SupabaseClient | null, candidate: Candidate): Promise<boolean> {
  // A second execution starts a new feedback episode even within six hours.
  const sinceMs = Math.max(Date.now() - 6 * 3_600_000, new Date(candidate.resolved_at!).getTime())
  if (client) {
    const { data, error } = await client.from('ticket_events').select('id')
      .eq('ticket_id', candidate.id).eq('event_type', 'lifecycle_nudge')
      .gte('created_at', new Date(sinceMs).toISOString()).limit(1)
    if (error) throw new Error(error.message)
    if (!data) throw new Error('nudge_history_unavailable')
    return data.length > 0
  }
  return Boolean(memGet(candidate.id)?.events.some((event) =>
    event.event_type === 'lifecycle_nudge' && new Date(event.created_at).getTime() >= sinceMs,
  ))
}

async function responsibleManager(client: SupabaseClient | null, candidate: Candidate): Promise<{ phone: string; name: string }> {
  if (!candidate.store_id || !candidate.organization_id) throw new Error('store_scope_missing')
  let store
  if (client) {
    const { data, error } = await client.from('stores').select('id, organization_id, name, manager_phone')
      .eq('id', candidate.store_id).eq('organization_id', candidate.organization_id).maybeSingle()
    if (error) throw new Error(error.message)
    store = data
  } else {
    store = memFindStoreById(candidate.store_id)
  }
  if (!store || store.organization_id !== candidate.organization_id) throw new Error('responsible_store_not_found')
  const phone = normalizePhoneDigits(store.manager_phone)
  if (!phone) throw new Error('store_manager_phone_missing')
  return { phone, name: store.name || 'החנות' }
}

async function recordAcceptedNudge(client: SupabaseClient | null, candidate: Candidate, hours: number, providerMessageId: string) {
  const payload = { kind: 'store_confirm', hours, resolvedAt: candidate.resolved_at, providerMessageId, recipientRole: 'store_manager' }
  if (!client) {
    memAddEvent(candidate.id, 'lifecycle_nudge', payload, null)
    return
  }
  const { data, error } = await client.from('ticket_events').insert({
    ticket_id: candidate.id, event_type: 'lifecycle_nudge', actor_id: null, payload,
  }).select('id').single()
  if (error || !data) {
    // Provider acceptance is real even when the audit write fails; preserve its
    // ID in diagnostics rather than claiming a recorded successful reminder.
    logEvent('cron:lifecycle_nudge', 'error', 'accepted_nudge_not_recorded', { ticketId: candidate.id, providerMessageId })
    throw new Error(error?.message || 'nudge_not_recorded')
  }
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const hours = nudgeHours()
  const cutoff = Date.now() - hours * 3_600_000
  const counts = { nudged: 0, skipped: 0, failed: 0, dryRun: 0 }
  try {
    const memory = process.env.MAINTAINOS_FORCE_MEMORY === '1'
    if (!memory && !(await supabaseReady())) throw new Error('lifecycle_database_unavailable')
    const client = memory ? null : createSystemClient('lifecycle_nudge_cron')
    const candidates = await loadResolvedAwaitingConfirm(client)
    for (const candidate of candidates) {
      const resolvedMs = candidate.resolved_at ? new Date(candidate.resolved_at).getTime() : NaN
      if (candidate.status !== 'resolved' || candidate.store_confirmed_at || !Number.isFinite(resolvedMs) || resolvedMs > cutoff) {
        counts.skipped++
        continue
      }
      try {
        if (await alreadyNudgedRecently(client, candidate)) {
          counts.skipped++
          continue
        }
        const manager = await responsibleManager(client, candidate)
        const display = candidate.display_number || (candidate.number != null ? `OC-${candidate.number}` : candidate.id.slice(0, 8))
        const link = `${getPublicAppUrl()}/store/tickets/${encodeURIComponent(candidate.id)}`
        const result = await notifyPhone(manager.phone, [
          `בוצע טיפול בתקלה ${display} בחנות ${manager.name}. האם הבעיה נפתרה?`,
          'השיבו «מאשר» או «לא נפתר», או פתחו את התקלה לאישור ולפרטים:',
          link,
        ].join('\n'), { ticketId: candidate.id, kind: 'store_confirmation_nudge', resolvedAt: candidate.resolved_at, recipientRole: 'store_manager' }, memory)
        if (result.status === 'dry_run') {
          counts.dryRun++
          continue
        }
        if (result.status !== 'sent' || !result.messageId?.trim()) throw new Error(result.error || 'nudge_not_accepted_by_provider')
        await recordAcceptedNudge(client, candidate, hours, result.messageId)
        counts.nudged++
      } catch (error) {
        counts.failed++
        logEvent('cron:lifecycle_nudge', 'warn', 'nudge_failed', { ticketId: candidate.id, error: error instanceof Error ? error.message : String(error) })
      }
    }
    logEvent('cron:lifecycle_nudge', 'info', 'done', { ...counts, hours })
    return NextResponse.json({ ok: counts.failed === 0 && counts.dryRun === 0, ...counts, hours }, { status: counts.failed ? 503 : 200 })
  } catch (error) {
    captureError(error, { route: 'GET /api/cron/lifecycle-nudge' })
    return NextResponse.json({ ok: false, error: 'lifecycle_nudge_unavailable', ...counts, hours }, { status: 503 })
  }
}
