import type { Locale } from '@/lib/i18n/locale'
import { phrase } from '@/lib/i18n/phrases'

const VOICE_EXCEPTION_HE = 'אין מענה קולי. התשובה בהודעה הזו.'

export function withVoiceOutcome(
  reply: string,
  delivered: boolean,
  locale: Locale = 'he',
): string {
  const exception = phrase(locale, VOICE_EXCEPTION_HE)
  if (delivered) return reply
  if (reply.includes(exception) || reply.includes(VOICE_EXCEPTION_HE)) return reply
  return `${reply}\n${exception}`
}

function speechRoute(): { url: string; key: string } | null {
  const gateway = process.env.AI_GATEWAY_API_KEY?.trim()
  if (gateway) return { url: 'https://ai-gateway.vercel.sh/v1/audio/speech', key: gateway }
  const openai = process.env.OPENAI_API_KEY?.trim()
  if (openai) return { url: 'https://api.openai.com/v1/audio/speech', key: openai }
  return null
}

/** Speech from the provider that already transcribes voice notes (he / fr / en). */
export async function synthesizeSpeech(
  text: string,
  locale: Locale = 'he',
): Promise<{ bytes: Uint8Array } | { error: string }> {
  const exception = phrase(locale, VOICE_EXCEPTION_HE)
  const spoken = text
    .replace(exception, '')
    .replace(VOICE_EXCEPTION_HE, '')
    .trim()
    .slice(0, 1200)
  if (!spoken) return { error: phrase(locale, 'אין טקסט להקראה') }
  const route = speechRoute()
  if (!route) return { error: phrase(locale, 'אין ספק דיבור מוגדר') }
  const res = await fetch(route.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${route.key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      voice: 'nova',
      input: spoken,
      response_format: 'mp3',
    }),
  })
  if (!res.ok) return { error: phrase(locale, 'ההקראה נכשלה') }
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength < 32) return { error: phrase(locale, 'ההקראה יצאה ריקה') }
  return { bytes }
}

/** @deprecated Prefer synthesizeSpeech(text, locale). */
export async function synthesizeHebrew(
  text: string,
): Promise<{ bytes: Uint8Array } | { error: string }> {
  return synthesizeSpeech(text, 'he')
}
