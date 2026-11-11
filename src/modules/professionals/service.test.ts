process.env.MAINTAINOS_FORCE_MEMORY = '1'

import { beforeEach, describe, expect, it } from 'vitest'
import {
  deleteProfessional,
  listProfessionals,
  updateProfessional,
  upsertProfessional,
} from './service'

describe('professionals book', () => {
  beforeEach(() => {
    process.env.MAINTAINOS_FORCE_MEMORY = '1'
  })

  it('adds a manual contact and soft-deletes it from the active list', async () => {
    const created = await upsertProfessional({
      full_name: 'טכנאי לבדיקה',
      phone: '0509988776',
      trade: 'חשמל',
      source: 'manual',
    })
    expect(created.professional.full_name).toBe('טכנאי לבדיקה')
    expect(created.professional.deleted_at).toBeNull()

    const before = await listProfessionals({ limit: 100 })
    expect(
      before.professionals.some((row) => row.id === created.professional.id),
    ).toBe(true)

    const removed = await deleteProfessional(created.professional.id)
    expect(removed.professional?.deleted_at).toBeTruthy()

    const after = await listProfessionals({ limit: 100 })
    expect(
      after.professionals.some((row) => row.id === created.professional.id),
    ).toBe(false)
  })

  it('returns null when deleting a missing id', async () => {
    const removed = await deleteProfessional('missing-pro-id')
    expect(removed.professional).toBeNull()
  })

  it('edits an existing contact by id', async () => {
    const created = await upsertProfessional({
      full_name: 'לעריכה',
      phone: '0501122334',
      trade: 'אינסטלציה',
      source: 'manual',
    })
    const updated = await updateProfessional(created.professional.id, {
      full_name: 'אחרי עריכה',
      phone: '0501122334',
      trade: 'חשמל',
    })
    expect(updated.professional?.full_name).toBe('אחרי עריכה')
    expect(updated.professional?.trade).toBe('חשמל')
    expect(updated.professional?.id).toBe(created.professional.id)
  })
})
