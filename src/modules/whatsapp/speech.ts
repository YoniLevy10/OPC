const VOICE_EXCEPTION = 'אין מענה קולי. התשובה בהודעה הזו.'

export function withVoiceOutcome(reply: string, delivered: boolean): string {
  if (delivered) return reply
  if (reply.includes(VOICE_EXCEPTION)) return reply
  return `${reply}\n${VOICE_EXCEPTION}`
}

function speechRoute(): { url: string; key: string } | null {
  const gateway = process.env.AI_GATEWAY_API_KEY?.trim()
  if (gateway) return { url: 'https://ai-gateway.vercel.sh/v1/audio/speech', key: gateway }
  const openai = process.env.OPENAI_API_KEY?.trim()
  if (openai) return { url: 'https://api.openai.com/v1/audio/speech', key: openai }
  return null
}

/** Hebrew speech from the provider that already transcribes voice notes. */
export async function synthesizeHebrew(
  text: string,
): Promise<{ bytes: Uint8Array } | { error: string }> {
  const spoken = text.replace(VOICE_EXCEPTION, '').trim().slice(0, 1200)
  if (!spoken) return { error: 'אין טקסט להקראה' }
  const route = speechRoute()
  if (!route) return { error: 'אין ספק דיבור מוגדר' }
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
  if (!res.ok) return { error: 'ההקראה נכשלה' }
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength < 32) return { error: 'ההקראה יצאה ריקה' }
  return { bytes }
}
