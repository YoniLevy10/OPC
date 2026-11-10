import { NextResponse } from 'next/server'
import { deskNotifyPhones, listDocuments } from '@/lib/data/ops-ledger'
import { hydrateOpsLedger } from '@/lib/data/ops-db'
import { notifyAri, notifyPhone } from '@/modules/notify/ari'
import {
  documentReminderStage,
  documentDueAt,
  documentTypeLabel,
  isDocumentDueSoon,
  isDocumentOverdue,
} from '@/modules/documents/rules'
import { claimDocumentReminder, documentReminderJournalMode, finishDocumentReminder, type ReminderStage } from '@/modules/documents/reminder-deliveries'
import { logEvent } from '@/lib/logging'

export const runtime = 'nodejs'

function cronAuthorized(request: Request): boolean {
  if (process.env.MAINTAINOS_FORCE_MEMORY === '1') return true
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return false
  const auth = request.headers.get('authorization')
  return (
    auth === `Bearer ${secret}` ||
    request.headers.get('x-cron-secret') === secret ||
    request.headers.get('cron-secret') === secret
  )
}

type DocumentGroups = {
  overdue: ReturnType<typeof listDocuments>
  dueSoon: ReturnType<typeof listDocuments>
  sixMonths: ReturnType<typeof listDocuments>
  twoMonths: ReturnType<typeof listDocuments>
}

function summaryPayload(groups: DocumentGroups) {
  const slim = (docs: ReturnType<typeof listDocuments>) => docs.map((doc) => ({
    id: doc.id, storeCode: doc.storeCode, docType: doc.docType, owner: doc.owner,
  }))
  return { overdue: slim(groups.overdue), dueSoon: slim(groups.dueSoon), sixMonths: groups.sixMonths.length, twoMonths: groups.twoMonths.length }
}

/** Preserve the existing daily aggregate until the durable phase journal is installed. */
async function legacyDailySummary(groups: DocumentGroups) {
  const counts = { sent: 0, failed: 0, dryRun: 0, alreadySent: 0, busy: 0 }
  const parts: string[] = []
  const lines = (docs: ReturnType<typeof listDocuments>) => docs.slice(0, 6)
    .map((doc) => `${doc.storeCode || '—'} ${documentTypeLabel(doc.docType)}`).join(', ')
  if (groups.overdue.length) parts.push(`באיחור (${groups.overdue.length}): ${lines(groups.overdue)}`)
  if (groups.dueSoon.length) parts.push(`תזכורת חודש מראש (${groups.dueSoon.length}): ${lines(groups.dueSoon)}`)
  if (groups.sixMonths.length) parts.push(`חצי שנה לפני (${groups.sixMonths.length})`)
  if (groups.twoMonths.length) parts.push(`חודשיים לפני (${groups.twoMonths.length})`)
  if (parts.length) {
    try {
      const result = await notifyAri(`מסמכים / כיולים — ${parts.join(' · ')}`, { mode: 'legacy_daily_summary', phaseDeduplication: false })
      for (const outcome of result.outcomes) {
        if (outcome.status === 'sent' && outcome.messageId?.trim()) counts.sent++
        else if (outcome.status === 'dry_run') counts.dryRun++
        else counts.failed++
      }
      if (!result.outcomes.length || (!result.ok && !counts.failed && !counts.dryRun)) counts.failed++
    } catch (error) {
      counts.failed++
      logEvent('cron:documents', 'error', 'legacy_summary_failed', { error: error instanceof Error ? error.message : 'unknown_error' })
    }
  }
  logEvent('cron:documents', counts.failed ? 'warn' : 'info', 'legacy_daily_summary', { ...counts, phaseDeduplication: false })
  return NextResponse.json({
    ok: counts.failed === 0 && counts.dryRun === 0,
    mode: 'legacy_daily_summary', phaseDeduplication: false,
    ...counts, ...summaryPayload(groups),
  }, { status: counts.failed ? 503 : 200 })
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const loaded = await hydrateOpsLedger()
    if (!loaded.ok) throw new Error(loaded.error ?? 'document_data_unavailable')
    if (loaded.backend !== 'supabase' && process.env.MAINTAINOS_FORCE_MEMORY !== '1') {
      throw new Error('document_database_unavailable')
    }
    const docs = listDocuments()
    const overdue = docs.filter((doc) => isDocumentOverdue(doc))
    const dueSoon = docs.filter((doc) => isDocumentDueSoon(doc))
    const sixMonths = docs.filter((doc) => documentReminderStage(doc) === 'six')
    const twoMonths = docs.filter((doc) => documentReminderStage(doc) === 'two')
    const mode = await documentReminderJournalMode()
    if (mode === 'legacy_daily_summary') return legacyDailySummary({ overdue, dueSoon, sixMonths, twoMonths })
    const recipients = [...new Set(deskNotifyPhones())]
    const counts = { sent: 0, failed: 0, dryRun: 0, alreadySent: 0, busy: 0 }
    const labels: Record<ReminderStage, string> = {
      six: 'חצי שנה לפני התוקף', two: 'חודשיים לפני התוקף', month: 'חודש לפני התוקף',
      overdue: 'התוקף פג', review: 'חסר תאריך תוקף לבדיקה',
    }
    for (const doc of docs) {
      if (doc.renewed || doc.intakeStatus === 'failed') continue
      const rawDue = documentDueAt(doc)
      const dueAt = rawDue && !Number.isNaN(new Date(rawDue).getTime()) ? new Date(rawDue).toISOString() : null
      const stage: ReminderStage | null = !dueAt && (doc.intakeStatus === 'needs_review' || Boolean(rawDue))
        ? 'review'
        : isDocumentOverdue(doc) ? 'overdue'
          : isDocumentDueSoon(doc) ? 'month' : documentReminderStage(doc)
      if (!stage) continue
      if (!recipients.length) throw new Error('document_reminder_recipient_missing')
      for (const recipient of recipients) {
        const context = { documentId: doc.id, version: doc.version, dueAt, stage }
        try {
          const reserved = await claimDocumentReminder({ ...context, recipient })
          if (reserved.status !== 'claimed') {
            if (reserved.status === 'sent') counts.alreadySent++
            else counts.busy++
            continue
          }
          let result
          try {
            result = await notifyPhone(recipient,
              `מסמכים / כיולים — ${doc.storeCode || doc.storeName || '—'} · ${documentTypeLabel(doc.docType)} · ${labels[stage]}${dueAt ? ` · ${new Date(dueAt).toLocaleDateString('he-IL')}` : ''}`,
              context)
          } catch (error) {
            result = { status: 'failed' as const, messageId: null, error: error instanceof Error ? error.message : 'send_failed' }
          }
          await finishDocumentReminder(reserved.claim, result)
          if (result.status === 'sent') counts.sent++
          else if (result.status === 'dry_run') counts.dryRun++
          else counts.failed++
          logEvent('cron:documents', result.status === 'failed' ? 'warn' : 'info', result.status, {
            ...context, deliveryKey: reserved.claim.key, error: result.error,
          })
        } catch (error) {
          counts.failed++
          logEvent('cron:documents', 'error', 'reminder_failed', {
            ...context, error: error instanceof Error ? error.message : 'unknown_error',
          })
        }
      }
    }
    logEvent('cron:documents', 'info', 'reminders', {
      overdue: overdue.length,
      dueSoon: dueSoon.length,
      sixMonths: sixMonths.length,
      twoMonths: twoMonths.length,
      ...counts,
    })
    return NextResponse.json({
      ok: counts.failed === 0 && counts.dryRun === 0 && counts.busy === 0,
      mode: 'phase_deduplicated', phaseDeduplication: true,
      ...counts,
      overdue: overdue.map((doc) => ({
        id: doc.id,
        storeCode: doc.storeCode,
        docType: doc.docType,
        owner: doc.owner,
      })),
      dueSoon: dueSoon.map((doc) => ({
        id: doc.id,
        storeCode: doc.storeCode,
        docType: doc.docType,
        owner: doc.owner,
      })),
      sixMonths: sixMonths.length,
      twoMonths: twoMonths.length,
    }, { status: counts.failed ? 503 : counts.busy ? 202 : 200 })
  } catch (error) {
    logEvent('cron:documents', 'error', 'unavailable', { error: error instanceof Error ? error.message : 'unknown_error' })
    return NextResponse.json({ ok: false, error: 'document_reminders_unavailable', failed: 1, sent: 0 }, { status: 503 })
  }
}
