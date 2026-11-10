import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { loadMidragResults, parseMidragResultsHtml } from './live-results'

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'live-results.fixture.html'),
  'utf8',
)

describe('parseMidragResultsHtml', () => {
  it('opens a contextual search link without scraping or claiming an authorized catalog', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    try {
      const result = await loadMidragResults({ category: 'hvac', city: 'תל אביב' })
      expect(result.pros).toEqual([])
      expect(result.searchUrl).toContain('serviceId=284&cityId=1243')
      expect(result.fallback).toBe(false)
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
    }
  })
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
