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
