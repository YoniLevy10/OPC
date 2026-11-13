import { describe, expect, it } from 'vitest'
import type { ClosedEngagementCost } from '@/modules/engagements/cost'
import {
  bucketCosts,
  defaultCostGrain,
  maintenanceCostInRange,
} from './summary'

const rows: ClosedEngagementCost[] = [
  {
    storeCode: '100',
    storeName: 'חנות ניסיון',
    approvedAmount: 700,
    closedAt: '2026-10-05T10:00:00.000Z',
    category: 'hvac',
  },
  {
    storeCode: '100',
    storeName: 'חנות ניסיון',
    approvedAmount: 300,
    closedAt: '2026-10-20T10:00:00.000Z',
    category: 'plumbing',
  },
  {
    storeCode: '6004',
    storeName: 'תל אביב שינקין',
    approvedAmount: 1000,
    closedAt: '2026-10-12T10:00:00.000Z',
    category: 'hvac',
  },
  {
    storeCode: '6004',
    storeName: 'תל אביב שינקין',
    approvedAmount: 500,
    closedAt: '2026-09-01T10:00:00.000Z',
    category: 'electrical',
  },
]

describe('maintenanceCostInRange', () => {
  it('totals approved spend and store share for the selected window', () => {
    const summary = maintenanceCostInRange(rows, '2026-10-01', '2026-10-31')
    expect(summary.networkTotal).toBe(2000)
    expect(summary.jobCount).toBe(3)
    const trial = summary.byStore.find((s) => s.storeCode === '100')
    const sheinkin = summary.byStore.find((s) => s.storeCode === '6004')
    expect(trial?.amount).toBe(1000)
    expect(trial?.pctOfNetwork).toBe(50)
    expect(sheinkin?.amount).toBe(1000)
    expect(sheinkin?.pctOfNetwork).toBe(50)
    const pctSum = summary.byStore.reduce((sum, s) => sum + s.pctOfNetwork, 0)
    expect(pctSum).toBe(100)
  })
})

describe('defaultCostGrain', () => {
  it('picks grain from range length', () => {
    expect(defaultCostGrain('2026-10-01', '2026-10-10')).toBe('day')
    expect(defaultCostGrain('2026-10-01', '2026-11-15')).toBe('week')
    expect(defaultCostGrain('2026-01-01', '2026-06-30')).toBe('month')
    expect(defaultCostGrain('2024-01-01', '2026-12-31')).toBe('year')
  })
})

describe('bucketCosts', () => {
  it('splits October by week with store pct of each bucket', () => {
    const buckets = bucketCosts(rows, '2026-10-01', '2026-10-31', 'week')
    expect(buckets.length).toBeGreaterThan(0)
    const withTrial = buckets.find((b) =>
      b.byStore.some((s) => s.storeCode === '100' && s.amount === 700),
    )
    expect(withTrial?.networkTotal).toBeGreaterThan(0)
  })
})
