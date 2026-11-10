import { afterEach, describe, expect, it, vi } from 'vitest'
import { transcribeVoice } from './voice'

const audio = `data:audio/ogg;base64,${Buffer.from('voice').toString('base64')}`

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function fields(body: BodyInit | null | undefined) {
  if (!(body instanceof FormData)) return null
  return {
    language: body.get('language'),
    format: body.get('response_format'),
  }
}

describe('transcribeVoice language', () => {
  it('keeps recordings for review without making network requests when no provider is configured', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', '')
    vi.stubEnv('OPENAI_API_KEY', '')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(await transcribeVoice('https://example.com/unavailable.ogg')).toMatchObject({ status: 'needs_review', text: null })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns a review outcome instead of losing intake when media download fails', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('media unavailable')))
    expect(await transcribeVoice('https://example.com/unavailable.ogg')).toMatchObject({ status: 'needs_review', text: null })
  })

  it('returns a review outcome when the transcription service disconnects', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('transcription unavailable')))
    expect(await transcribeVoice(audio)).toMatchObject({ status: 'needs_review', text: null })
  })

  it('keeps an English recording in English', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test-key')
    const seen: Array<ReturnType<typeof fields>> = []
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      seen.push(fields(init?.body))
      return {
        ok: true,
        json: async () => ({ text: 'the air conditioner is not cooling', language: 'english' }),
      }
    })

    const result = await transcribeVoice(audio)
    expect(result).toMatchObject({
      text: 'the air conditioner is not cooling',
      status: 'transcribed',
      language: 'en',
    })
    expect(seen).toEqual([{ language: null, format: 'verbose_json' }])
  })

  it('retries Hebrew when Whisper labels the clip as Arabic', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test-key')
    const seen: Array<ReturnType<typeof fields>> = []
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const form = fields(init?.body)
      seen.push(form)
      if (!form?.language) {
        return { ok: true, json: async () => ({ text: 'مرحبا', language: 'arabic' }) }
      }
      return { ok: true, json: async () => ({ text: 'המזגן לא מקרר' }) }
    })

    const result = await transcribeVoice(audio)
    expect(result.language).toBe('he')
    expect(result.text).toBe('המזגן לא מקרר')
    expect(seen.map((row) => row?.language)).toEqual([null, 'he'])
  })

  it('keeps a French detection without a second pass', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test-key')
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      return {
        ok: true,
        json: async () => ({ text: "il y a une fuite d'eau", language: 'french' }),
      }
    })

    const result = await transcribeVoice(audio)
    expect(result.language).toBe('fr')
    expect(calls).toBe(1)
  })
})
