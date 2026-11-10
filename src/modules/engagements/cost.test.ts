import { describe, expect, it } from 'vitest'
import { approvedByFaultType, compareStorePeriods } from './cost'

const rows = [
  {
    storeCode: '6036',
    storeName: 'אריאל',
    approvedAmount: 400,
    closedAt: '2026-03-01T00:00:00.000Z',
    category: 'plumbing',
  },
  {
    storeCode: '6036',
    storeName: 'אריאל',
    approvedAmount: 100,
    closedAt: '2026-04-01T00:00:00.000Z',
    category: 'electrical',
  },
  {
    storeCode: '6005',
    storeName: 'חדרה',
    approvedAmount: 250,
    closedAt: '2025-06-01T00:00:00.000Z',
    category: 'plumbing',
  },
]

describe('approved cost reports', () => {
  it('groups the approved price by fault type', () => {
    expect(approvedByFaultType(rows, 2026)).toEqual([
      { category: 'plumbing', amount: 400 },
      { category: 'electrical', amount: 100 },
    ])
  })

  it('compares a store with the previous year', () => {
    const compared = compareStorePeriods(rows, 2026)
    expect(compared.find((row) => row.storeCode === '6036')).toMatchObject({
      current: 500,
      previous: 0,
    })
    expect(compared.find((row) => row.storeCode === '6005')).toMatchObject({
      current: 0,
      previous: 250,
    })
  })
})
