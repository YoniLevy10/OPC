import { describe, expect, it } from 'vitest'
import { WA_COPY } from './copy'

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
