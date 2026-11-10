import { buildMidragSearchUrl } from '@/modules/vendors/external-search'

export type MidragPro = {
  id: number
  name: string
  rating: number | null
  reviews: number | null
  availability: string | null
  /** Indicative Midrag range. Not the price Ari locks. */
  priceMin: number | null
  priceMax: number | null
  profileUrl: string
}

export type MidragLiveResult = {
  pros: MidragPro[]
  searchUrl: string
  /** True when an authorized integration fails; link-only mode is not a failure. */
  fallback: boolean
}

function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

type SpCard = {
  Id?: number
  Name?: string
  AverageRankForGeneral?: number
  FeedbacksCount?: number
  AvailabilityRangeName?: string | null
  AreaId?: number | null
  ServiceId?: number | null
  PersonalPriceLists?: { MinPrice?: number; MaxPrice?: number } | null
}

/** Pull professional cards from a Midrag results HTML page (`data-sp`). */
export function parseMidragResultsHtml(html: string): MidragPro[] {
  const pros: MidragPro[] = []
  const seen = new Set<number>()
  const pattern = /data-sp=(["'])([\s\S]*?)\1/g
  for (const match of html.matchAll(pattern)) {
    const raw = match[2]
    if (!raw) continue
    let card: SpCard
    try {
      card = JSON.parse(decodeAttr(raw)) as SpCard
    } catch {
      continue
    }
    const id = num(card.Id)
    const name = card.Name?.trim()
    if (id == null || !name || seen.has(id)) continue
    seen.add(id)
    const areaId = num(card.AreaId)
    const serviceId = num(card.ServiceId)
    const query = new URLSearchParams()
    if (areaId != null) query.set('areaId', String(areaId))
    if (serviceId != null) query.set('serviceId', String(serviceId))
    const qs = query.toString()
    pros.push({
      id,
      name,
      rating: num(card.AverageRankForGeneral),
      reviews: num(card.FeedbacksCount),
      availability: card.AvailabilityRangeName?.trim() || null,
      priceMin: num(card.PersonalPriceLists?.MinPrice),
      priceMax: num(card.PersonalPriceLists?.MaxPrice),
      profileUrl: `https://www.midrag.co.il/SpCard/Sp/${id}${qs ? `?${qs}` : ''}`,
    })
  }
  return pros
}

/**
 * The approved flow opens Midrag itself. No authorized catalog integration has
 * been verified, so page rendering must not scrape cards or imply live stock.
 * The fixture parser above remains isolated for a future verified integration.
 */
export async function loadMidragResults(input: {
  category: string
  city?: string | null
}): Promise<MidragLiveResult> {
  return { pros: [], searchUrl: buildMidragSearchUrl(input), fallback: false }
}
