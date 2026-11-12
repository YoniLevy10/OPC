import 'server-only'

import { send019Sms } from '@/lib/sms/019'
import { getPublicAppUrl } from '@/lib/auth/app-url'
import {
  managerNameForStoreCode,
  managerPhoneForStoreCode,
} from '@/modules/stores/manager-identity'
import { proPortalPath, signProPortalToken } from '@/modules/pro/token'
import { buildProAssignmentSms } from '@/modules/pro/sms-copy'

export type ProSmsNotice = {
  ok: boolean
  line: string
  portalUrl?: string
}

export { buildProAssignmentSms }

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
  const [managerPhone, managerName] = await Promise.all([
    managerPhoneForStoreCode(input.storeCode),
    managerNameForStoreCode(input.storeCode),
  ])
  const message = buildProAssignmentSms({
    storeName: input.storeName,
    storeCode: input.storeCode,
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
