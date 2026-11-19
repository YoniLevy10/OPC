import { NextResponse } from 'next/server'
import { logEvent } from '@/lib/logging'
import {
  memGet,
  memListTickets,
  supabaseReady,
} from '@/lib/data/memory-store'
import { createSystemClient } from '@/lib/supabase/system'
import { appendEvent, getById } from '@/modules/tickets/service'
import { notifyReporter } from '@/modules/notifications/lifecycle-notify'
import { captureError } from '@/lib/monitoring'

export const runtime = 'nodejs'

/**
 * OC-22: store-confirm reminder ladder — 1h → 3h → 12h → 24h.
 * Live WhatsApp sends stay behind MAINTAINOS_WA_CONFIRM_REMINDERS_LIVE=1.
 * Dry-run (default) still advances levels + logs for memory/tests.
 */

const REMINDER_HOURS = [1, 3, 12, 24] as const

function cronAuthorized(request: Request): boolean {
  if (process.env.MAINTAINOS_FORCE_MEMORY === '1') return true
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return false
  const auth = request.headers.get('authorization')
  if (auth === `Bearer ${secret}`) return true
  if (request.headers.get('x-cron-secret') === secret) return true
  if (request.headers.get('cron-secret') === secret) return true
  return false
}

function confirmRemindersLive(): boolean {
  return process.env.MAINTAINOS_WA_CONFIRM_REMINDERS_LIVE === '1'
}

type Candidate = {
  id: string
  status: string
  resolved_at: string | null
  updated_at: string
  reporter_phone: string | null
  awaiting_store_confirm_since: string | null
  confirm_reminder_level: number
}

function sinceMs(c: Candidate): number {
  const raw = c.awaiting_store_confirm_since || c.resolved_at || c.updated_at
  const ms = new Date(raw).getTime()
  return Number.isFinite(ms) ? ms : 0
}

async function loadResolvedAwaitingConfirm(): Promise<Candidate[]> {
  if (await supabaseReady()) {
    const supabase = createSystemClient('lifecycle_nudge_cron')
    let { data, error } = await supabase
      .from('tickets')
      .select(
        'id, status, resolved_at, updated_at, reporter_phone, store_confirmed_at, awaiting_store_confirm_since, confirm_reminder_level',
      )
      .in('status', ['resolved', 'engaged'])
      .is('store_confirmed_at', null)
      .limit(200)
    if (
      error &&
      (error.message.includes('awaiting_store_confirm_since') ||
        error.message.includes('confirm_reminder_level'))
    ) {
      const fallback = await supabase
        .from('tickets')
        .select(
          'id, status, resolved_at, updated_at, reporter_phone, store_confirmed_at',
        )
        .in('status', ['resolved', 'engaged'])
        .is('store_confirmed_at', null)
        .limit(200)
      data = fallback.data as typeof data
      error = fallback.error
    }
    if (error) throw new Error(error.message)
    return (data ?? []).map((r) => {
      const row = r as Record<string, unknown>
      return {
        id: String(row.id),
        status: String(row.status),
        resolved_at: (row.resolved_at as string | null) ?? null,
        updated_at: String(row.updated_at),
        reporter_phone: (row.reporter_phone as string | null) ?? null,
        awaiting_store_confirm_since:
          (row.awaiting_store_confirm_since as string | null) ?? null,
        confirm_reminder_level: Number(row.confirm_reminder_level ?? 0),
      }
    })
  }
  return memListTickets()
    .filter(
      (t) =>
        (t.status === 'resolved' || t.status === 'engaged') &&
        !t.store_confirmed_at,
    )
    .map((t) => ({
      id: t.id,
      status: t.status,
      resolved_at: t.resolved_at,
      updated_at: t.updated_at,
      reporter_phone: t.reporter_phone,
      awaiting_store_confirm_since: t.awaiting_store_confirm_since ?? null,
      confirm_reminder_level: t.confirm_reminder_level ?? 0,
    }))
}

async function setReminderLevel(
  ticketId: string,
  level: number,
  sinceIso: string,
): Promise<void> {
  if (await supabaseReady()) {
    const supabase = createSystemClient('lifecycle_nudge_cron')
    const patch: Record<string, unknown> = {
      confirm_reminder_level: level,
      awaiting_store_confirm_since: sinceIso,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('tickets').update(patch).eq('id', ticketId)
    if (
      error &&
      (error.message.includes('confirm_reminder_level') ||
        error.message.includes('awaiting_store_confirm_since'))
    ) {
      // Column missing — memory path still tracks via events.
      return
    }
    return
  }
  const ticket = memGet(ticketId)
  if (!ticket) return
  ticket.confirm_reminder_level = level
  ticket.awaiting_store_confirm_since =
    ticket.awaiting_store_confirm_since ?? sinceIso
  ticket.updated_at = new Date().toISOString()
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const live = confirmRemindersLive()
  const now = Date.now()
  let nudged = 0
  let skipped = 0
  const levels: number[] = []

  try {
    const candidates = await loadResolvedAwaitingConfirm()
    for (const c of candidates) {
      const started = sinceMs(c)
      if (!started) {
        skipped += 1
        continue
      }
      const elapsedH = (now - started) / 3_600_000
      let nextLevel = c.confirm_reminder_level || 0
      for (let i = 0; i < REMINDER_HOURS.length; i += 1) {
        const level = i + 1
        if (elapsedH >= REMINDER_HOURS[i] && nextLevel < level) {
          nextLevel = level
        }
      }
      if (nextLevel <= (c.confirm_reminder_level || 0)) {
        skipped += 1
        continue
      }

      const detail = await getById(c.id)
      if (!detail) {
        skipped += 1
        continue
      }

      const sinceIso =
        c.awaiting_store_confirm_since ||
        c.resolved_at ||
        c.updated_at ||
        new Date(started).toISOString()

      if (live) {
        await notifyReporter(detail, 'resolved')
      } else {
        logEvent('cron:lifecycle_nudge', 'info', 'confirm_reminder_dry_run', {
          ticketId: c.id,
          level: nextLevel,
          hours: REMINDER_HOURS[nextLevel - 1],
        })
      }

      await setReminderLevel(c.id, nextLevel, sinceIso)
      await appendEvent(c.id, 'lifecycle_nudge', null, {
        kind: 'store_confirm',
        level: nextLevel,
        hours: REMINDER_HOURS[nextLevel - 1],
        live,
      })
      levels.push(nextLevel)
      nudged += 1
    }

    logEvent('cron:lifecycle_nudge', 'info', 'done', {
      nudged,
      skipped,
      live,
      levels,
    })
    return NextResponse.json({
      ok: true,
      nudged,
      skipped,
      live,
      levels,
      scheduleHours: [...REMINDER_HOURS],
    })
  } catch (err) {
    captureError(err, { route: 'GET /api/cron/lifecycle-nudge' })
    logEvent('cron:lifecycle_nudge', 'error', 'failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
