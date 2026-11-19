import 'server-only'

import { send019Sms } from '@/lib/sms/019'
import { getPublicAppUrl } from '@/lib/auth/app-url'
import {
  managerNameForStoreCode,
  managerPhoneForStoreCode,
} from '@/modules/stores/manager-identity'
import { getStoreByCode } from '@/modules/stores/service'
import { proPortalPath, signProPortalToken } from '@/modules/pro/token'
import {
  buildProAssignmentSms,
  buildProPaymentSms,
  PRO_RECEIPT_EMAIL,
} from '@/modules/pro/sms-copy'
import { lockedEngagementFor } from '@/modules/engagements/service'
import { getById } from '@/modules/tickets/service'
import { logEvent } from '@/lib/logging'

export type ProSmsNotice = {
  ok: boolean
  line: string
  portalUrl?: string
}

export { buildProAssignmentSms, buildProPaymentSms, PRO_RECEIPT_EMAIL }

export async function notifyProfessionalSms(input: {
  professionalPhone: string
  professionalName: string
  storeCode: string
  storeName: string
  faultLines: string[]
  engagementId: string
}): Promise<ProSmsNotice> {
  let token: string
  try {
    token = signProPortalToken(input.professionalPhone)
  } catch (err) {
    return {
      ok: false,
      line: err instanceof Error ? err.message : 'לא נוצר קישור אישי',
    }
  }

  const portalUrl = `${getPublicAppUrl()}${proPortalPath(token)}`
  const [managerPhone, managerName, storeLookup] = await Promise.all([
    managerPhoneForStoreCode(input.storeCode),
    managerNameForStoreCode(input.storeCode),
    getStoreByCode(input.storeCode).catch(() => ({ store: null })),
  ])
  const message = buildProAssignmentSms({
    storeName: input.storeName,
    storeCode: input.storeCode,
    storeCity: storeLookup.store?.city ?? null,
    storeAddress: storeLookup.store?.address ?? null,
    managerName,
    managerPhone,
    faultLines: input.faultLines,
    portalUrl,
  })

  const sent = await send019Sms({
    to: input.professionalPhone,
    message,
    meta: {
      engagementId: input.engagementId,
      purpose: 'pro_assignment',
    },
  })

  if (sent.ok) {
    return {
      ok: true,
      line: `נשלח SMS אל ${input.professionalName} עם קישור אישי`,
      portalUrl,
    }
  }
  if (sent.skipped === 'disabled') {
    return {
      ok: false,
      line: 'ה-SMS לא יצא — קו 019 כבוי (SMS_019_ENABLED). הקישור האישי נשמר להעתקה.',
      portalUrl,
    }
  }
  if (sent.dryRun) {
    return {
      ok: true,
      line: `SMS במצב dry-run אל ${input.professionalName}`,
      portalUrl,
    }
  }
  return {
    ok: false,
    line: sent.detail || 'ה-SMS לאיש המקצוע לא יצא',
    portalUrl,
  }
}

/**
 * After store confirms and the ticket closes — payment terms + receipt request.
 * No-op when there is no locked professional with a phone.
 */
export async function notifyProfessionalPaymentOnClose(
  ticketId: string,
): Promise<ProSmsNotice | null> {
  try {
    const [ticket, engagement] = await Promise.all([
      getById(ticketId),
      lockedEngagementFor(ticketId).catch(() => null),
    ])
    if (!ticket) return null

    const phone =
      engagement?.professionalPhone?.trim() ||
      null
    const name = engagement?.professionalName?.trim() || 'איש מקצוע'
    if (!phone) {
      logEvent('pro:payment-sms', 'info', 'skipped_no_phone', { ticketId })
      return null
    }

    const storeCode = ticket.stores?.code?.trim() || '—'
    const storeName = ticket.stores?.name?.trim() || storeCode
    const faultLines = [
      ticket.title?.trim() || ticket.description?.trim() || '',
    ].filter(Boolean)

    const message = buildProPaymentSms({
      storeName,
      storeCode,
      faultLines,
      receiptEmail: PRO_RECEIPT_EMAIL,
    })

    const sent = await send019Sms({
      to: phone,
      message,
      meta: {
        ticketId,
        engagementId: engagement?.id ?? null,
        purpose: 'pro_payment',
      },
    })

    if (sent.ok || sent.dryRun) {
      logEvent('pro:payment-sms', 'info', 'sent', {
        ticketId,
        dryRun: Boolean(sent.dryRun),
      })
      return {
        ok: true,
        line: sent.dryRun
          ? `SMS תשלום (dry-run) אל ${name}`
          : `נשלח SMS תשלום וקבלה אל ${name}`,
      }
    }
    logEvent('pro:payment-sms', 'warn', 'failed', {
      ticketId,
      detail: sent.detail ?? sent.skipped ?? null,
    })
    return {
      ok: false,
      line: sent.detail || 'ה-SMS לתשלום לא יצא',
    }
  } catch (err) {
    logEvent('pro:payment-sms', 'warn', 'error', {
      ticketId,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
