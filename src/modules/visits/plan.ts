import {
  buildMidragSearchUrl,
  midragCityMatchForCity,
  midragServiceMatchForCategory,
  tradeLabelHe,
} from '@/modules/vendors/external-search'

export const VISIT_PLANNABLE_STATUSES = [
  'new', 'triaged', 'awaiting_info', 'assigned', 'in_progress',
] as const
const plannableStatuses = new Set<string>(VISIT_PLANNABLE_STATUSES)

export function isVisitPlannableStatus(status: string): boolean {
  return plannableStatuses.has(status)
}

export type VisitPlanTicket = {
  id: string
  label: string
  title?: string | null
  storeId: string
  storeCode: string
  category?: string | null
  city?: string | null
  region?: string | null
}

export type VisitPlanGroup = {
  id: string
  category: string
  tradeLabel: string
  city: string | null
  locationLabel: string
  tickets: VisitPlanTicket[]
  searchUrl: string | null
  preciseSearch: boolean
  ready: boolean
}

export function normalizeVisitTrade(category?: string | null): string {
  const value = category?.trim().toLowerCase() || 'other'
  return value === 'electrical_hazard' ? 'electrical' : value
}

function normalizedLocation(ticket: VisitPlanTicket) {
  const city = ticket.city?.normalize('NFKC').trim().replace(/\s+/g, ' ') || null
  const match = midragCityMatchForCity(city)
  return {
    city: match?.midragLabel ?? city,
    // Missing geography is never inferred from the first selected ticket.
    key: match ? `city:${match.cityId}` : city ? `city:${city.replace(/[-\s]/g, '')}` : `store:${ticket.storeId}`,
  }
}

/** Every selected ticket appears exactly once, grouped by profession and city. */
export function buildVisitPlan(tickets: VisitPlanTicket[]): VisitPlanGroup[] {
  const grouped = new Map<string, VisitPlanGroup>()
  const seen = new Set<string>()
  for (const ticket of tickets) {
    if (seen.has(ticket.id)) continue
    seen.add(ticket.id)
    const category = normalizeVisitTrade(ticket.category)
    const location = normalizedLocation(ticket)
    const key = `${category}:${location.key}`
    let group = grouped.get(key)
    if (!group) {
      const knownTrade = Boolean(midragServiceMatchForCategory(category))
      group = {
        id: key,
        category,
        tradeLabel: knownTrade ? tradeLabelHe(category) : 'נדרש סיווג מקצוע',
        city: location.city,
        locationLabel: location.city ?? `חנות #${ticket.storeCode} · חסרה עיר`,
        tickets: [],
        searchUrl: knownTrade && location.city
          ? buildMidragSearchUrl({ category, city: location.city })
          : null,
        preciseSearch: knownTrade && Boolean(midragCityMatchForCity(location.city)),
        ready: knownTrade && Boolean(location.city) && Boolean(ticket.storeId),
      }
      grouped.set(key, group)
    }
    group.tickets.push(ticket)
    if (!ticket.storeId) group.ready = false
  }
  return [...grouped.values()].map((group) => ({
    ...group,
    // Result/form state belongs to this exact set, not a later selection in the city.
    id: `${group.id}:${group.tickets.map((ticket) => ticket.id).sort().join(',')}`,
  }))
}
