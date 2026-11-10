import { describe, expect, it } from 'vitest'
import { buildVisitPlan, isVisitPlannableStatus, type VisitPlanTicket } from './plan'

function ticket(id: string, overrides: Partial<VisitPlanTicket> = {}): VisitPlanTicket {
  return { id, label: id, storeId: 'store-ta', storeCode: '6006', city: 'תל אביב', category: 'hvac', ...overrides }
}

describe('visit plan from all selected faults', () => {
  it('allows waiting work but excludes existing visits, parts waits and terminal faults', () => {
    expect(['new', 'triaged', 'awaiting_info', 'assigned', 'in_progress'].every(isVisitPlannableStatus)).toBe(true)
    expect(['engaged', 'waiting_vendor', 'waiting_parts', 'resolved', 'closed', 'cancelled', 'unknown'].some(isVisitPlannableStatus)).toBe(false)
  })
  it('splits mixed professions and locations while retaining every selected fault', () => {
    const selected = [ticket('air'), ticket('water', { category: 'plumbing' }), ticket('air-haifa', { storeId: 'haifa', city: 'חיפה' })]
    const plan = buildVisitPlan(selected)
    expect(plan).toHaveLength(3)
    expect(plan.flatMap((group) => group.tickets.map((row) => row.id)).sort()).toEqual(selected.map((row) => row.id).sort())
    expect(plan[1].searchUrl).toContain('serviceId=119&cityId=1243')
    expect(plan[2].searchUrl).toContain('serviceId=284&cityId=421')
  })

  it('normalizes trade aliases and city spellings, independent of selection order', () => {
    const selected = [ticket('hazard', { category: ' electrical_hazard ', city: 'תל-אביב' }), ticket('electric', { category: 'electrical', city: ' תל אביב יפו ' })]
    const plan = buildVisitPlan(selected)
    expect(plan).toHaveLength(1)
    expect(plan[0].tickets).toHaveLength(2)
    expect(plan[0].category).toBe('electrical')
    expect(plan[0].city).toBe('תל אביב')
    expect(plan[0].id).toBe(buildVisitPlan([...selected].reverse())[0].id)
  })

  it('does not invent a city or profession, or merge stores with missing locations', () => {
    const plan = buildVisitPlan([
      ticket('missing-city', { city: null }),
      ticket('another-missing-city', { storeId: 'another', city: null }),
      ticket('unknown-trade', { category: 'other' }),
    ])
    expect(plan).toHaveLength(3)
    expect(plan.every((group) => !group.ready && group.searchUrl === null)).toBe(true)
  })

  it('does not pretend an unmapped city is included in the Midrag link', () => {
    const [group] = buildVisitPlan([ticket('unmapped', { city: 'עיר ללא מיפוי' })])
    expect(group.ready).toBe(true)
    expect(group.preciseSearch).toBe(false)
    expect(group.searchUrl).toBe('https://www.midrag.co.il/Search/Results?serviceId=284')
  })

  it('deduplicates ticket IDs and changes plan identity when the work scope changes', () => {
    const [original] = buildVisitPlan([ticket('a'), ticket('a')])
    expect(original.tickets).toHaveLength(1)
    const [expanded] = buildVisitPlan([ticket('a'), ticket('b')])
    expect(expanded.id).not.toBe(original.id)
  })
})
