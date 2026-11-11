import {
  buildMidragSearchUrl,
  midragCityMatchForCity,
  midragServiceMatchForCategory,
} from '@/modules/vendors/external-search'

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

/** Why live Midrag pros are / aren't available. */
export type MidragReason =
  | 'ok'
  | 'unmapped'
  | 'fetch_failed'
  | 'empty'
  | 'stale'

export type MidragLiveResult = {
  pros: MidragPro[]
  searchUrl: string
  /** True when the UI should treat the Midrag link as the primary path. */
  fallback: boolean
  reason: MidragReason
  /** Pros came from last-good cache (error or per-key throttle). */
  stale?: boolean
}

const TTL_MS = 15 * 60 * 1000
/** Gap between network fetches for the *same* cache key — not global. */
const MIN_GAP_MS = 1500

type CacheEntry = { at: number; pros: MidragPro[] }

const cache = new Map<string, CacheEntry>()
const lastFetchByKey = new Map<string, number>()

/** Test-only: clear in-memory cache + per-key throttle clocks. */
export function __resetMidragLiveCacheForTests() {
  cache.clear()
  lastFetchByKey.clear()
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

function resultFromCache(
  hit: CacheEntry,
  searchUrl: string,
  reason: MidragReason,
  stale: boolean,
): MidragLiveResult {
  const empty = hit.pros.length === 0
  return {
    pros: hit.pros,
    searchUrl,
    fallback: empty,
    reason: empty && reason === 'stale' ? 'empty' : reason,
    stale: stale && !empty ? true : undefined,
  }
}

async function fetchMidragHtml(searchUrl: string): Promise<string> {
  const init: RequestInit = {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; MaintainOS/1.0; +https://optical-center.co.il)',
      'Accept-Language': 'he',
    },
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  }
  const once = async () => {
    const response = await fetch(searchUrl, init)
    if (!response.ok) throw new Error(`midrag_http_${response.status}`)
    return response.text()
  }
  try {
    return await once()
  } catch {
    // One network retry before falling back to cache / fetch_failed.
    return await once()
  }
}

export async function loadMidragResults(input: {
  category: string
  city?: string | null
}): Promise<MidragLiveResult> {
  const searchUrl = buildMidragSearchUrl(input)
  const service = midragServiceMatchForCategory(input.category)
  const city = midragCityMatchForCity(input.city)
  if (!service || !city || !searchUrl.includes('/Search/Results')) {
    return {
      pros: [],
      searchUrl,
      fallback: true,
      reason: 'unmapped',
    }
  }

  const key = `${service.serviceId}:${city.cityId}`
  const hit = cache.get(key)
  const now = Date.now()

  if (hit && now - hit.at < TTL_MS) {
    return {
      pros: hit.pros,
      searchUrl,
      fallback: hit.pros.length === 0,
      reason: hit.pros.length === 0 ? 'empty' : 'ok',
    }
  }

  const lastFetch = lastFetchByKey.get(key) ?? 0
  if (now - lastFetch < MIN_GAP_MS) {
    // Per-key throttle: serve last cache for *this* key; other keys still fetch.
    if (hit) return resultFromCache(hit, searchUrl, 'stale', true)
    return {
      pros: [],
      searchUrl,
      fallback: true,
      reason: 'fetch_failed',
    }
  }

  lastFetchByKey.set(key, now)

  try {
    const html = await fetchMidragHtml(searchUrl)
    let pros: MidragPro[]
    try {
      pros = parseMidragResultsHtml(html)
    } catch {
      if (hit?.pros.length) return resultFromCache(hit, searchUrl, 'stale', true)
      return {
        pros: [],
        searchUrl,
        fallback: true,
        reason: 'fetch_failed',
      }
    }
    cache.set(key, { at: Date.now(), pros })
    return {
      pros,
      searchUrl,
      fallback: pros.length === 0,
      reason: pros.length === 0 ? 'empty' : 'ok',
    }
  } catch {
    if (hit?.pros.length) return resultFromCache(hit, searchUrl, 'stale', true)
    if (hit) {
      return {
        pros: [],
        searchUrl,
        fallback: true,
        reason: 'empty',
      }
    }
    return {
      pros: [],
      searchUrl,
      fallback: true,
      reason: 'fetch_failed',
    }
  }
}
