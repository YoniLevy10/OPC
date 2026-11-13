import type { ClosedEngagementCost } from '@/modules/engagements/cost'

export type CostGrain = 'day' | 'week' | 'month' | 'year'

export type StoreCostShare = {
  storeCode: string
  storeName: string
  amount: number
  pctOfNetwork: number
  jobCount: number
}

export type CategoryCostShare = {
  category: string
  amount: number
  pctOfNetwork: number
  jobCount: number
}

export type NetworkCostSummary = {
  networkTotal: number
  jobCount: number
  byStore: StoreCostShare[]
  byCategory: CategoryCostShare[]
}

export type CostBucket = {
  key: string
  label: string
  from: string
  to: string
  networkTotal: number
  byStore: Array<StoreCostShare & { pctOfRange: number }>
}

function parseDay(iso: string): Date | null {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function inRange(iso: string, from?: string | null, to?: string | null): boolean {
  const day = iso.slice(0, 10)
  if (from && day < from.slice(0, 10)) return false
  if (to && day > to.slice(0, 10)) return false
  return true
}

export function rowsInCostRange(
  rows: ClosedEngagementCost[],
  from?: string | null,
  to?: string | null,
): ClosedEngagementCost[] {
  return rows.filter(
    (row) =>
      row.approvedAmount > 0 &&
      Boolean(row.closedAt) &&
      inRange(row.closedAt, from, to),
  )
}

function pct(part: number, whole: number): number {
  if (!(whole > 0) || !(part > 0)) return 0
  return Math.round((part / whole) * 1000) / 10
}

/** Approved Ari costs in an optional date window (closedAt / cost date). */
export function maintenanceCostInRange(
  rows: ClosedEngagementCost[],
  from?: string | null,
  to?: string | null,
): NetworkCostSummary {
  const scoped = rowsInCostRange(rows, from, to)
  const storeMap = new Map<
    string,
    { storeCode: string; storeName: string; amount: number; jobCount: number }
  >()
  const catMap = new Map<string, { amount: number; jobCount: number }>()
  let networkTotal = 0

  for (const row of scoped) {
    networkTotal += row.approvedAmount
    const storeKey = row.storeCode || row.storeName
    const storePrev = storeMap.get(storeKey) ?? {
      storeCode: row.storeCode,
      storeName: row.storeName || row.storeCode || 'חנות',
      amount: 0,
      jobCount: 0,
    }
    storePrev.amount += row.approvedAmount
    storePrev.jobCount += 1
    storeMap.set(storeKey, storePrev)

    const cat = row.category?.trim() || 'other'
    const catPrev = catMap.get(cat) ?? { amount: 0, jobCount: 0 }
    catPrev.amount += row.approvedAmount
    catPrev.jobCount += 1
    catMap.set(cat, catPrev)
  }

  const byStore = [...storeMap.values()]
    .map((row) => ({
      ...row,
      pctOfNetwork: pct(row.amount, networkTotal),
    }))
    .sort((a, b) => b.amount - a.amount)

  const byCategory = [...catMap.entries()]
    .map(([category, row]) => ({
      category,
      amount: row.amount,
      jobCount: row.jobCount,
      pctOfNetwork: pct(row.amount, networkTotal),
    }))
    .sort((a, b) => b.amount - a.amount)

  return {
    networkTotal,
    jobCount: scoped.length,
    byStore,
    byCategory,
  }
}

export function defaultCostGrain(
  from?: string | null,
  to?: string | null,
): CostGrain {
  if (!from || !to) return 'month'
  const a = parseDay(from)
  const b = parseDay(to)
  if (!a || !b) return 'month'
  const days =
    Math.round(
      (startOfUtcDay(b).getTime() - startOfUtcDay(a).getTime()) / 86_400_000,
    ) + 1
  if (days <= 14) return 'day'
  if (days <= 90) return 'week'
  if (days <= 400) return 'month'
  return 'year'
}

export function parseCostGrain(value: string | null | undefined): CostGrain | null {
  if (value === 'day' || value === 'week' || value === 'month' || value === 'year') {
    return value
  }
  return null
}

function bucketKey(d: Date, grain: CostGrain): { key: string; label: string; from: string; to: string } {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const day = d.getUTCDate()
  if (grain === 'day') {
    const key = ymd(d)
    return { key, label: key, from: key, to: key }
  }
  if (grain === 'year') {
    return {
      key: String(y),
      label: String(y),
      from: `${y}-01-01`,
      to: `${y}-12-31`,
    }
  }
  if (grain === 'month') {
    const from = `${y}-${String(m + 1).padStart(2, '0')}-01`
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    const to = `${y}-${String(m + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`
    return {
      key: from.slice(0, 7),
      label: from.slice(0, 7),
      from,
      to,
    }
  }
  // ISO week (Mon–Sun), UTC
  const utc = startOfUtcDay(d)
  const dow = utc.getUTCDay() || 7
  const monday = new Date(utc)
  monday.setUTCDate(utc.getUTCDate() - (dow - 1))
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  const from = ymd(monday)
  const to = ymd(sunday)
  return {
    key: from,
    label: `${from} – ${to}`,
    from,
    to,
  }
}

/** Split approved costs into day/week/month/year buckets inside the range. */
export function bucketCosts(
  rows: ClosedEngagementCost[],
  from: string | null | undefined,
  to: string | null | undefined,
  grain: CostGrain,
): CostBucket[] {
  const scoped = rowsInCostRange(rows, from, to)
  const rangeSummary = maintenanceCostInRange(scoped, from, to)
  const groups = new Map<string, ClosedEngagementCost[]>()
  const meta = new Map<string, { label: string; from: string; to: string }>()

  for (const row of scoped) {
    const d = parseDay(row.closedAt)
    if (!d) continue
    const b = bucketKey(d, grain)
    const list = groups.get(b.key) ?? []
    list.push(row)
    groups.set(b.key, list)
    meta.set(b.key, { label: b.label, from: b.from, to: b.to })
  }

  const keys = [...groups.keys()].sort()
  return keys.map((key) => {
    const info = meta.get(key)!
    const summary = maintenanceCostInRange(groups.get(key) ?? [], info.from, info.to)
    return {
      key,
      label: info.label,
      from: info.from,
      to: info.to,
      networkTotal: summary.networkTotal,
      byStore: summary.byStore.map((store) => ({
        ...store,
        pctOfRange: pct(store.amount, rangeSummary.networkTotal),
      })),
    }
  })
}
