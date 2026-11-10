import { describe, expect, it } from 'vitest'
import { eligibleForQualityClose } from './quality-hold'

const now = new Date('2026-11-02T12:00:00.000Z')

describe('eligibleForQualityClose', () => {
  it('reconciles a confirmed legacy repair whose follow-up period has ended', () => {
    expect(
      eligibleForQualityClose(
        {
          status: 'resolved',
          store_confirmed_at: '2026-10-01T00:00:00.000Z',
          quality_hold_until: '2026-11-01T00:00:00.000Z',
        },
        now,
      ),
    ).toBe(true)
  })

  it('does not delay a store-confirmed repair while follow-up metadata is active', () => {
    expect(
      eligibleForQualityClose(
        {
          status: 'resolved',
          store_confirmed_at: '2026-11-01T00:00:00.000Z',
          quality_hold_until: '2026-12-01T00:00:00.000Z',
        },
        now,
      ),
    ).toBe(true)
  })

  it('does not close without a store confirmation', () => {
    expect(
      eligibleForQualityClose(
        {
          status: 'resolved',
          store_confirmed_at: null,
          quality_hold_until: '2026-11-01T00:00:00.000Z',
        },
        now,
      ),
    ).toBe(false)
  })

  it('ignores tickets that are not resolved', () => {
    expect(
      eligibleForQualityClose(
        {
          status: 'in_progress',
          store_confirmed_at: '2026-10-01T00:00:00.000Z',
          quality_hold_until: '2026-11-01T00:00:00.000Z',
        },
        now,
      ),
    ).toBe(false)
  })
})
