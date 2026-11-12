import { formatIsraeliPhoneDisplay } from '@/lib/phone'

/** Human fault text for SMS — never expose internal #OC-… codes; keep full detail. */
function faultDescription(line: string): string {
  return line
    .replace(/#?\s*OC-\d+\s*[—\-:]?\s*/gi, '')
    .replace(/^#\S+\s*[—\-:]?\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Hebrew SMS for the professional after Ari locks a visit.
 * Full fault descriptions; URL is always last and never truncated.
 */
export function buildProAssignmentSms(input: {
  storeName: string
  storeCode: string
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

  return [
    `Optical Center · חנות: ${input.storeName} (#${input.storeCode})`,
    countLine,
    ...faults.map((fault) => `- ${fault}`),
    managerName ? `מנהל חנות: ${managerName}` : null,
    managerPhone ? `טלפון: ${managerPhone}` : null,
    ...(url ? ['קישור:', url] : []),
  ]
    .filter((line): line is string => Boolean(line && line.trim()))
    .join('\n')
}
