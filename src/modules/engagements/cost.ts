export type ClosedEngagementCost = {
  storeCode: string
  storeName: string
  approvedAmount: number
  closedAt: string
  category?: string | null
}

export type AnnualStoreCost = {
  storeCode: string
  storeName: string
  amount: number
}

/** Approved amounts of visits the store already confirmed, for one calendar year. */
export function annualMaintenanceCost(
  rows: ClosedEngagementCost[],
  year: number,
): { year: number; stores: AnnualStoreCost[]; network: number } {
  const byStore = new Map<string, AnnualStoreCost>()
  for (const row of rows) {
    const closed = new Date(row.closedAt)
    if (Number.isNaN(closed.getTime()) || closed.getUTCFullYear() !== year) continue
    if (!(row.approvedAmount > 0)) continue
    const key = row.storeCode || row.storeName
    const prev = byStore.get(key) ?? {
      storeCode: row.storeCode,
      storeName: row.storeName || row.storeCode || 'חנות',
      amount: 0,
    }
    prev.amount += row.approvedAmount
    byStore.set(key, prev)
  }
  const stores = [...byStore.values()].sort((a, b) => b.amount - a.amount)
  const network = stores.reduce((sum, row) => sum + row.amount, 0)
  return { year, stores, network }
}

export type FaultTypeCost = {
  category: string
  amount: number
}

/** Approved price grouped by fault type. This is not money that was paid. */
export function approvedByFaultType(
  rows: ClosedEngagementCost[],
  year: number,
): FaultTypeCost[] {
  const byType = new Map<string, number>()
  for (const row of rowsInYear(rows, year)) {
    const key = row.category?.trim() || 'other'
    byType.set(key, (byType.get(key) ?? 0) + row.approvedAmount)
  }
  return [...byType.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
}

export type StorePeriodComparison = {
  storeCode: string
  storeName: string
  current: number
  previous: number
}

/** Same approved-price field, this calendar year against the year before. */
export function compareStorePeriods(
  rows: ClosedEngagementCost[],
  year: number,
): StorePeriodComparison[] {
  const current = annualMaintenanceCost(rows, year)
  const previous = annualMaintenanceCost(rows, year - 1)
  const names = new Map<string, StorePeriodComparison>()
  for (const row of previous.stores) {
    const key = row.storeCode || row.storeName
    names.set(key, {
      storeCode: row.storeCode,
      storeName: row.storeName,
      current: 0,
      previous: row.amount,
    })
  }
  for (const row of current.stores) {
    const key = row.storeCode || row.storeName
    const prev = names.get(key)
    names.set(key, {
      storeCode: row.storeCode,
      storeName: row.storeName,
      current: row.amount,
      previous: prev?.previous ?? 0,
    })
  }
  return [...names.values()].sort((a, b) => b.current - a.current)
}

function rowsInYear(rows: ClosedEngagementCost[], year: number): ClosedEngagementCost[] {
  return rows.filter((row) => {
    const closed = new Date(row.closedAt)
    return !Number.isNaN(closed.getTime()) && closed.getUTCFullYear() === year && row.approvedAmount > 0
  })
}
