import { beforeEach, describe, expect, it } from 'vitest'
import { listUsers, mergeAuthLastLogins } from './service'

process.env.MAINTAINOS_FORCE_MEMORY = '1'

describe('mergeAuthLastLogins', () => {
  it('maps last_sign_in_at onto matching profile ids', () => {
    const rows = [
      {
        id: 'u1',
        email: 'a@x.com',
        full_name: 'A',
        phone: null,
        memberships: [],
      },
      {
        id: 'u2',
        email: 'b@x.com',
        full_name: 'B',
        phone: null,
        memberships: [],
      },
    ]
    const merged = mergeAuthLastLogins(rows, [
      { id: 'u1', last_sign_in_at: '2026-11-11T10:00:00.000Z' },
      { id: 'u2', last_sign_in_at: null },
    ])
    expect(merged[0]?.last_login_at).toBe('2026-11-11T10:00:00.000Z')
    expect(merged[1]?.last_login_at).toBeNull()
  })

  it('defaults to null when Auth has no row for the profile', () => {
    const merged = mergeAuthLastLogins(
      [
        {
          id: 'orphan',
          email: null,
          full_name: 'Orphan',
          phone: null,
          memberships: [],
        },
      ],
      [{ id: 'other', last_sign_in_at: '2026-01-01T00:00:00.000Z' }],
    )
    expect(merged[0]?.last_login_at).toBeNull()
  })
})

describe('listUsers memory mode', () => {
  beforeEach(() => {
    process.env.MAINTAINOS_FORCE_MEMORY = '1'
  })

  it('returns last_login_at null without Auth', async () => {
    const users = await listUsers()
    expect(users.length).toBeGreaterThan(0)
    expect(users.every((u) => u.last_login_at === null)).toBe(true)
  })
})
