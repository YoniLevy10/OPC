import { createHmac } from 'node:crypto'

/** Mirror of src/modules/pro/token.ts for Playwright (same default secret). */
function secret() {
  return (
    process.env.PRO_PORTAL_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    'dev-pro-portal-secret'
  )
}

function b64url(buf: Buffer | string) {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf
  return b
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function signProPortalTokenForE2e(phoneRaw: string) {
  let digits = phoneRaw.replace(/\D/g, '')
  if (digits.startsWith('0')) digits = `972${digits.slice(1)}`
  const body = b64url(JSON.stringify({ phone: digits, exp: Date.now() + 86_400_000 }))
  const sig = b64url(createHmac('sha256', secret()).update(body).digest())
  return `${body}.${sig}`
}
