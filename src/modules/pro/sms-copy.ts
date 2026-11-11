import { formatIsraeliPhoneDisplay } from '@/lib/phone'

const SMS_MAX = 480

/** Short human title for SMS — never expose internal #OC-… codes. */
function faultTitle(line: string): string {
  const trimmed = line
    .replace(/#?\s*OC-\d+\s*[—\-:]?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!trimmed) return ''
  return trimmed.length > 40 ? `${trimmed.slice(0, 37)}…` : trimmed
}

/**
 * Short Hebrew SMS for the professional after Ari locks a visit.
 * URL is always last and never truncated — drop fault detail first if needed.
 */
export function buildProAssignmentSms(input: {
  storeName: string
  storeCode: string
  managerPhone: string | null
  faultLines: string[]
  portalUrl: string
}): string {
  const url = input.portalUrl.trim()
  const titles = input.faultLines.map(faultTitle).filter(Boolean).slice(0, 5)
  const count = Math.max(titles.length, input.faultLines.filter(Boolean).length)
  const visit =
    count <= 1 ? 'ביקור אחד' : `ביקור אחד · ${count} תקלות`

  const mgr = input.managerPhone
    ? `מנהל: ${formatIsraeliPhoneDisplay(input.managerPhone)}`
    : null

  const footer = url ? ['קישור:', url] : []

  function compose(detailLine: string | null): string {
    return [
      `Optical Center · ${input.storeName} (#${input.storeCode})`,
      visit,
      detailLine,
      mgr,
      ...footer,
    ]
      .filter((line): line is string => Boolean(line && line.trim()))
      .join('\n')
  }

  let detailLine: string | null =
    titles.length > 0 ? titles.join(' · ') : null
  let text = compose(detailLine)

  if (text.length > SMS_MAX && detailLine) {
    text = compose(null)
  }

  // Last resort: keep store + link only (never chop the URL mid-string).
  if (text.length > SMS_MAX && url) {
    text = [
      `Optical Center · #${input.storeCode}`,
      mgr,
      'קישור:',
      url,
    ]
      .filter((line): line is string => Boolean(line && line.trim()))
      .join('\n')
  }

  return text
}
