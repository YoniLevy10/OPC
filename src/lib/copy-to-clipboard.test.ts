import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from './copy-to-clipboard'
import { TM } from './toast-messages'

describe('copyText', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes trimmed text and returns true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await expect(copyText('  hello  ')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('returns false for empty input', async () => {
    const writeText = vi.fn()
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await expect(copyText('   ')).resolves.toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('returns false when clipboard rejects', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('denied')),
      },
    })
    await expect(copyText('OC-12')).resolves.toBe(false)
  })
})

describe('TM toast messages', () => {
  it('keeps Bino-style בהצלחה copy and CRUD strings', () => {
    expect(TM.copied).toBe('הועתק בהצלחה')
    expect(TM.phoneCopied).toContain('בהצלחה')
    expect(TM.linkCopied).toContain('בהצלחה')
    expect(TM.ticketNumberCopied).toContain('בהצלחה')
    expect(TM.professionalSaved).toContain('בהצלחה')
    expect(TM.ticketDeleted).toContain('בהצלחה')
    expect(TM.techCompleted).toContain('בהצלחה')
    expect(TM.copyFailed).not.toContain('בהצלחה')
  })
})
