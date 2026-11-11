import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetMidragLiveCacheForTests,
  loadMidragResults,
  parseMidragResultsHtml,
} from './live-results'

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'live-results.fixture.html'),
  'utf8',
)

describe('parseMidragResultsHtml', () => {
  it('reads name, rating, availability, and a price range from data-sp', () => {
    const pros = parseMidragResultsHtml(fixture)
    expect(pros).toHaveLength(1)
    expect(pros[0]).toMatchObject({
      id: 137520,
      name: 'פבל',
      rating: 9.88,
      reviews: 125,
      availability: 'פנוי היום',
      priceMin: 450,
      priceMax: 1000,
    })
    expect(pros[0]?.profileUrl).toContain('/SpCard/Sp/137520')
    expect(pros[0]?.profileUrl).toContain('serviceId=284')
  })

  it('returns nothing when the page has no cards', () => {
    expect(parseMidragResultsHtml('<html></html>')).toEqual([])
  })
})

describe('loadMidragResults', () => {
  beforeEach(() => {
    __resetMidragLiveCacheForTests()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    __resetMidragLiveCacheForTests()
  })

  it('returns unmapped when category or city cannot scrape', async () => {
    const result = await loadMidragResults({
      category: 'other',
      city: 'חיפה',
    })
    expect(result.reason).toBe('unmapped')
    expect(result.fallback).toBe(true)
    expect(result.pros).toEqual([])
    expect(result.searchUrl).toContain('midrag.co.il')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('parses a successful fetch into ok + pros', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => fixture,
    } as Response)

    const result = await loadMidragResults({
      category: 'hvac',
      city: 'חיפה',
    })
    expect(result.reason).toBe('ok')
    expect(result.fallback).toBe(false)
    expect(result.pros).toHaveLength(1)
    expect(result.pros[0]?.name).toBe('פבל')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('returns stale last-good cache after fetch failure', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => fixture,
      } as Response)
      .mockRejectedValue(new Error('network'))

    const first = await loadMidragResults({
      category: 'hvac',
      city: 'חיפה',
    })
    expect(first.reason).toBe('ok')
    expect(first.pros).toHaveLength(1)

    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 16 * 60 * 1000)

    const second = await loadMidragResults({
      category: 'hvac',
      city: 'חיפה',
    })
    // fetch retries once → 2 rejects after the initial success
    expect(second.reason).toBe('stale')
    expect(second.stale).toBe(true)
    expect(second.fallback).toBe(false)
    expect(second.pros).toHaveLength(1)
    expect(second.pros[0]?.name).toBe('פבל')
  })

  it('throttles per key and still lets another key fetch', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      const html = url.includes('serviceId=284')
        ? fixture
        : '<html></html>'
      return {
        ok: true,
        text: async () => html,
      } as Response
    })

    const hvac = await loadMidragResults({
      category: 'hvac',
      city: 'חיפה',
    })
    expect(hvac.reason).toBe('ok')
    expect(fetch).toHaveBeenCalledTimes(1)

    // Same key within gap — no second network call; last cache returned.
    const hvacAgain = await loadMidragResults({
      category: 'hvac',
      city: 'חיפה',
    })
    expect(hvacAgain.reason).toBe('ok') // still inside TTL
    expect(fetch).toHaveBeenCalledTimes(1)

    // Different key must not be blocked by the other key's gap.
    const electrical = await loadMidragResults({
      category: 'electrical',
      city: 'חיפה',
    })
    expect(electrical.reason).toBe('empty')
    expect(electrical.fallback).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('on per-key gap after a failed refresh returns last cache without refetch', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => fixture,
      } as Response)
      .mockRejectedValue(new Error('down'))

    await loadMidragResults({ category: 'hvac', city: 'חיפה' })
    expect(fetch).toHaveBeenCalledTimes(1)

    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 16 * 60 * 1000)

    const afterFail = await loadMidragResults({
      category: 'hvac',
      city: 'חיפה',
    })
    expect(afterFail.reason).toBe('stale')
    // initial success + retry pair on failure
    expect(fetch).toHaveBeenCalledTimes(3)

    const throttled = await loadMidragResults({
      category: 'hvac',
      city: 'חיפה',
    })
    expect(throttled.reason).toBe('stale')
    expect(throttled.stale).toBe(true)
    expect(throttled.pros).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('retries once then fetch_failed when there is no cache', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('down'))

    const result = await loadMidragResults({
      category: 'hvac',
      city: 'חיפה',
    })
    expect(result.reason).toBe('fetch_failed')
    expect(result.fallback).toBe(true)
    expect(result.pros).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
