import 'server-only'

import { deskNotifyPhones } from '@/lib/data/ops-ledger'
import { logEvent } from '@/lib/logging'
import {
  isWhatsAppOutsideWindowError,
  sendWhatsAppTemplate,
  sendWhatsAppText,
  type SendWhatsAppResult,
} from '@/modules/whatsapp/send'
import {
  defaultDeskAlertTemplateName,
  deskAlertParameter,
  META_WA_TEMPLATES,
} from '@/modules/whatsapp/templates'

function failedSend(err: unknown): SendWhatsAppResult {
  const error = err instanceof Error ? err.message : String(err)
  logEvent('notify:phone', 'warn', 'whatsapp_failed', {
    error,
  })
  return { ok: false, dryRun: false, waMessageId: null, error }
}

export type PhoneNotificationResult = {
  to: string
  status: 'sent' | 'failed' | 'dry_run'
  messageId: string | null
  error: string | null
}

export async function notifyPhone(
  to: string,
  message: string,
  meta?: Record<string, unknown>,
  forceDryRun = false,
): Promise<PhoneNotificationResult> {
  const text = message.trim()
  if (!text || !to.trim()) {
    return { to, status: 'failed', messageId: null, error: 'missing_recipient_or_message' }
  }
  const dry = forceDryRun || process.env.MAINTAINOS_FORCE_MEMORY === '1'
  // SMS disabled for pilot cost — WhatsApp / ops web only.
  let whatsapp = await sendWhatsAppText({
    toWaId: to,
    text,
    purpose: 'status_update',
    skipFailureQueue: true,
    forceDryRun: dry,
  }).catch(failedSend)

  const outsideWindow =
    !whatsapp.ok &&
    !whatsapp.skippedByPolicy &&
    isWhatsAppOutsideWindowError(
      whatsapp.error,
      whatsapp.errorCode,
      whatsapp.errorSubcode,
    )

  if (outsideWindow) {
    const template = await sendWhatsAppTemplate({
      toWaId: to,
      templateName: defaultDeskAlertTemplateName(),
      languageCode:
        process.env.WHATSAPP_DESK_TEMPLATE_LANG?.trim() ||
        META_WA_TEMPLATES.deskAlert.language,
      bodyParameters: [deskAlertParameter(text)],
      purpose: 'status_update',
      skipFailureQueue: true,
      forceDryRun: dry,
    }).catch(failedSend)
    logEvent('notify:phone', template.ok ? 'info' : 'warn', 'desk_template', {
      ...meta,
      ok: template.ok,
      dryRun: template.dryRun,
      error: template.error ?? null,
    })
    whatsapp = template
  }

  const status = whatsapp.dryRun ? 'dry_run' : whatsapp.ok && whatsapp.waMessageId ? 'sent' : 'failed'
  logEvent('notify:phone', status === 'failed' ? 'warn' : 'info', status, {
    ...meta,
    sms: false,
    whatsapp: whatsapp.ok,
    outsideWindow,
  })
  return {
    to,
    status,
    messageId: whatsapp.waMessageId,
    error: status === 'failed' ? whatsapp.error ?? (whatsapp.skippedByPolicy ? 'cost_policy' : whatsapp.ok ? 'missing_provider_message_id' : 'send_failed') : null,
  }
}

/** Tell desk notify phones. Decisions stay in /ops/approvals. */
export async function notifyAri(message: string, meta?: Record<string, unknown>) {
  const forceDryRun = meta?.dryRun === true
  const outcomes = await Promise.all(
    deskNotifyPhones().map((phone) => notifyPhone(phone, message, meta, forceDryRun)),
  )
  return { ok: outcomes.length > 0 && outcomes.every((result) => result.status === 'sent'), outcomes }
}
