import { describe, expect, it } from 'vitest'
import { synthesizeHebrew, synthesizeSpeech, withVoiceOutcome } from './speech'

describe('spoken reply', () => {
  it('says the reply is text when no voice was delivered', () => {
    expect(withVoiceOutcome('שלוש תקלות דחופות', false)).toContain('אין מענה קולי')
    expect(withVoiceOutcome('שלוש תקלות דחופות', true)).toBe('שלוש תקלות דחופות')
  })

  it('localizes the voice fallback in French', () => {
    expect(withVoiceOutcome('Trois pannes urgentes', false, 'fr')).toMatch(/vocale|message/i)
  })

  it('does not call a speech provider when none is configured', async () => {
    delete process.env.OPENAI_API_KEY
    delete process.env.AI_GATEWAY_API_KEY
    const result = await synthesizeHebrew('שלום ארי')
    expect(result).toEqual({ error: 'אין ספק דיבור מוגדר' })
    const fr = await synthesizeSpeech('Bonjour Ari', 'fr')
    expect(fr).toEqual({ error: 'Aucun fournisseur vocal configuré' })
  })
})