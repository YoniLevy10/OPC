import { describe, expect, it } from 'vitest'
import {
  humanizeMessageBody,
  intakeStateLabel,
  templateDisplayName,
} from './display-labels'

describe('intakeStateLabel', () => {
  it('maps snake_case intake states to product language', () => {
    expect(intakeStateLabel('awaiting_store', 'he')).toBe('ממתין לסניף')
    expect(intakeStateLabel('awaiting_store', 'en')).toBe('Waiting for store')
    expect(intakeStateLabel('done', 'fr')).toBe('Traité')
  })
})

describe('humanizeMessageBody', () => {
  it('hides Meta template ids from the desk', () => {
    expect(humanizeMessageBody('[תבנית] maintainos_followup', 'he')).toBe(
      'הודעת מעקב',
    )
    expect(templateDisplayName('maintainos_followup', 'en')).toBe(
      'Follow-up message',
    )
  })
})
