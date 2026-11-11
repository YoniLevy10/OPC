import { createHmac, timingSafeEqual } from 'node:crypto'
import { normalizePhoneDigits } from '@/lib/phone'

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days

function secret(): string {
  return (
    process.env.PRO_PORTAL_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    'dev-pro-portal-secret'
  )
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf
  return b
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function fromB64url(value: string): Buffer {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4))
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + pad
  return Buffer.from(b64, 'base64')
}

export type ProTokenPayload = {
  /** E.164-ish digits without + */
  phone: string
  /** unix ms expiry */
  exp: number
}

export function signProPortalToken(
  phoneRaw: string,
  ttlMs: number = DEFAULT_TTL_MS,
): string {
  const phone = normalizePhoneDigits(phoneRaw)
  if (!phone) throw new Error('טלפון איש מקצוע לא תקין לקישור')
  const payload: ProTokenPayload = {
    phone,
    exp: Date.now() + ttlMs,
  }
  const body = b64url(JSON.stringify(payload))
  const sig = b64url(
    createHmac('sha256', secret()).update(body).digest(),
  )
  return `${body}.${sig}`
}

export function verifyProPortalToken(
  token: string | null | undefined,
): ProTokenPayload | null {
  if (!token?.includes('.')) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = b64url(
    createHmac('sha256', secret()).update(body).digest(),
  )
  try {
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch {
    return null
  }
  try {
    const payload = JSON.parse(fromB64url(body).toString('utf8')) as ProTokenPayload
    if (!payload?.phone || !payload.exp) return null
    if (Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

export function proPortalPath(token: string): string {
  return `/pro?t=${encodeURIComponent(token)}`
}
