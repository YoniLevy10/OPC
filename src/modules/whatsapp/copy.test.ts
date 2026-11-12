import { describe, expect, it } from 'vitest'
import { WA_COPY, waCopy } from './copy'

describe('WA_COPY.askDescription', () => {
  it('greets the manager by name and asks for the fault', () => {
    const reply = WA_COPY.askDescription('תל אביב אבן גבירול', 'לילך')
    expect(reply).toContain('שלום לילך, מה שלומך?')
    expect(reply).toContain('בבקשה תארו את התקלה')
    expect(reply).toContain('אבן גבירול')
  })

  it('falls back without inventing a name', () => {
    const reply = WA_COPY.askDescription('חדרה', null)
    expect(reply).toContain('שלום, מה שלומך?')
    expect(reply).toContain('חדרה')
    expect(reply).toContain('בבקשה תארו את התקלה')
    expect(reply).not.toMatch(/שלום \S+, מה שלומך/)
  })
})

describe('waCopy languages', () => {
  it('confirms a ticket in English and French', () => {
    const en = waCopy('en').confirmedIntake({
      displayNumber: 'OC-1',
      storeName: 'Dizengoff',
      summary: 'AC not cooling',
      priority: 'high',
    })
    expect(en).toMatch(/Opened ticket #OC-1/)
    expect(en).toMatch(/Priority High/)

    const fr = waCopy('fr').confirmedIntake({
      displayNumber: 'OC-2',
      storeName: 'Lyon',
      summary: 'Fuite d’eau',
      priority: 'medium',
    })
    expect(fr).toMatch(/Ticket ouvert #OC-2/)
    expect(fr).toMatch(/Priorité Moyenne/)
  })
})
