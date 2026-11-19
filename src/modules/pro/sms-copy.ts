import { formatIsraeliPhoneDisplay } from '@/lib/phone'

/** Human fault text for SMS — never expose internal #OC-… codes; keep full detail. */
function faultDescription(line: string): string {
  return line
    .replace(/#?\s*OC-\d+\s*[—\-:]?\s*/gi, '')
    .replace(/^#\S+\s*[—\-:]?\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** One-line store location for SMS / portal (city · address). */
export function formatStoreAddressLine(input: {
  city?: string | null
  address?: string | null
}): string | null {
  const city = input.city?.trim() || ''
  const address = input.address?.trim() || ''
  if (city && address && address !== city) return `${city} · ${address}`
  if (address) return address
  if (city) return city
  return null
}

/**
 * Hebrew SMS for the professional after Ari locks a visit.
 * Full fault descriptions; URL is always last and never truncated.
 */
export function buildProAssignmentSms(input: {
  storeName: string
  storeCode: string
  storeCity?: string | null
  storeAddress?: string | null
  managerName: string | null
  managerPhone: string | null
  faultLines: string[]
  portalUrl: string
}): string {
  const url = input.portalUrl.trim()
  const faults = input.faultLines.map(faultDescription).filter(Boolean)
  const count = faults.length
  const countLine =
    count <= 0
      ? null
      : count === 1
        ? '1 תקלה:'
        : `${count} תקלות:`

  const managerName = input.managerName?.trim() || null
  const managerPhone = input.managerPhone
    ? formatIsraeliPhoneDisplay(input.managerPhone)
    : null
  const location = formatStoreAddressLine({
    city: input.storeCity,
    address: input.storeAddress,
  })

  return [
    `Optical Center · חנות: ${input.storeName} (#${input.storeCode})`,
    location ? `כתובת: ${location}` : null,
    countLine,
    ...faults.map((fault) => `- ${fault}`),
    managerName ? `מנהל חנות: ${managerName}` : null,
    managerPhone ? `טלפון: ${managerPhone}` : null,
    ...(url ? ['קישור:', url] : []),
  ]
    .filter((line): line is string => Boolean(line && line.trim()))
    .join('\n')
}

/** Receipt email Ari uses for accounting handoff after work is confirmed closed. */
export const PRO_RECEIPT_EMAIL = 'harry.bendriem@optical-center.com'

/**
 * SMS after store confirms work and the ticket/engagement closes:
 * bank transfer within 10 days + request to email the receipt.
 */
export function buildProPaymentSms(input: {
  storeName: string
  storeCode: string
  faultLines: string[]
  receiptEmail?: string
}): string {
  const email = (input.receiptEmail || PRO_RECEIPT_EMAIL).trim()
  const faults = input.faultLines.map(faultDescription).filter(Boolean)
  const faultBlock =
    faults.length === 0
      ? null
      : faults.length === 1
        ? `עבודה: ${faults[0]}`
        : `עבודות:\n${faults.map((f) => `- ${f}`).join('\n')}`

  return [
    `Optical Center · סיום עבודה אושר`,
    `חנות: ${input.storeName} (#${input.storeCode})`,
    faultBlock,
    'התשלום יתבצע בהעברה בנקאית בתוך 10 ימים ממועד האישור.',
    `נא לשלוח קבלה למייל: ${email}`,
    'תודה.',
  ]
    .filter((line): line is string => Boolean(line && line.trim()))
    .join('\n')
}
