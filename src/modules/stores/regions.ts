import { phrase } from '@/lib/i18n/phrases'
import type { Locale } from '@/lib/i18n/locale'

/** Israel district codes used across stores + preferred vendors. */

export const IL_REGION_CODES = ['TA', 'CTR', 'JLM', 'HFA', 'N', 'S'] as const

export type IlRegionCode = (typeof IL_REGION_CODES)[number]

export const IL_REGION_LABELS_HE: Record<IlRegionCode, string> = {
  TA: 'תל אביב',
  CTR: 'המרכז',
  JLM: 'ירושלים',
  HFA: 'חיפה',
  N: 'הצפון',
  S: 'הדרום',
}

/** Memory slug ↔ district code */
export const REGION_SLUG_TO_CODE: Record<string, IlRegionCode> = {
  ta: 'TA',
  ctr: 'CTR',
  jlm: 'JLM',
  hfa: 'HFA',
  n: 'N',
  s: 'S',
}

/** Stable seed UUIDs from migrations ↔ district code */
export const REGION_UUID_TO_CODE: Record<string, IlRegionCode> = {
  '33333333-3333-3333-3333-333333333301': 'TA',
  '33333333-3333-3333-3333-333333333302': 'CTR',
  '33333333-3333-3333-3333-333333333303': 'JLM',
  '33333333-3333-3333-3333-333333333304': 'HFA',
  '33333333-3333-3333-3333-333333333305': 'N',
  '33333333-3333-3333-3333-333333333306': 'S',
}

export function regionCodeFromId(regionId: string | null | undefined): IlRegionCode | null {
  if (!regionId) return null
  const lower = regionId.toLowerCase()
  if (REGION_SLUG_TO_CODE[lower]) return REGION_SLUG_TO_CODE[lower]
  if (REGION_UUID_TO_CODE[regionId]) return REGION_UUID_TO_CODE[regionId]
  const upper = regionId.toUpperCase()
  if ((IL_REGION_CODES as readonly string[]).includes(upper)) {
    return upper as IlRegionCode
  }
  return null
}

export function regionLabelHe(regionIdOrCode: string | null | undefined): string {
  const code = regionCodeFromId(regionIdOrCode) ?? null
  if (!code) return '—'
  return IL_REGION_LABELS_HE[code]
}

export function regionLabel(
  regionIdOrCode: string | null | undefined,
  locale: Locale = 'he',
): string {
  const he = regionLabelHe(regionIdOrCode)
  if (he === '—') return he
  return phrase(locale, he)
}

export function isIlRegionCode(value: string): value is IlRegionCode {
  return (IL_REGION_CODES as readonly string[]).includes(value.toUpperCase())
}

/** Ops directory view: North / Center / South (districts collapse into these). */
export const IL_ZONE_CODES = ['N', 'C', 'S'] as const

export type IlZoneCode = (typeof IL_ZONE_CODES)[number]

export const IL_ZONE_LABELS_HE: Record<IlZoneCode, string> = {
  N: 'הצפון',
  C: 'המרכז',
  S: 'הדרום',
}

/** Haifa joins North; Tel Aviv / Center / Jerusalem join Center. */
export function zoneFromRegion(
  code: IlRegionCode | null | undefined,
): IlZoneCode | null {
  if (!code) return null
  if (code === 'N' || code === 'HFA') return 'N'
  if (code === 'S') return 'S'
  return 'C'
}

export function zoneFromRegionId(
  regionId: string | null | undefined,
): IlZoneCode | null {
  return zoneFromRegion(regionCodeFromId(regionId))
}

export function zoneLabel(
  zone: IlZoneCode | string | null | undefined,
  locale: Locale = 'he',
): string {
  const code = String(zone ?? '')
    .trim()
    .toUpperCase()
  if (!(IL_ZONE_CODES as readonly string[]).includes(code)) return '—'
  return phrase(locale, IL_ZONE_LABELS_HE[code as IlZoneCode])
}

/** Accepts zone (N/C/S) or legacy district (TA/HFA/…) in ?region=. */
export function parseZoneParam(value: string | null | undefined): IlZoneCode | '' {
  if (!value) return ''
  const upper = value.trim().toUpperCase()
  if ((IL_ZONE_CODES as readonly string[]).includes(upper)) {
    return upper as IlZoneCode
  }
  return zoneFromRegion(regionCodeFromId(upper)) ?? ''
}
