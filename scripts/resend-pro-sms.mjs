/**
 * One-shot: send the pro-assignment SMS with the current copy
 * to MAINTAINOS_OUTBOUND_REDIRECT_PHONE (or 972548102688).
 *
 * Usage: node --env-file=.env.local scripts/resend-pro-sms.mjs
 */
import { createHmac } from 'node:crypto'

const SMS_019_API = 'https://019sms.co.il/api'
const TO =
  (process.env.MAINTAINOS_OUTBOUND_REDIRECT_PHONE || '972548102688').replace(
    /\D/g,
    '',
  )

function to019Local(raw) {
  let local = raw.replace(/\D/g, '')
  if (local.startsWith('972')) local = local.slice(3)
  if (!local.startsWith('0') && local.startsWith('5')) local = `0${local}`
  return /^05\d{8}$/.test(local) ? local : null
}

function formatIlsPhone(raw) {
  const d = raw.replace(/\D/g, '')
  const local = d.startsWith('972') ? `0${d.slice(3)}` : d.startsWith('0') ? d : d
  if (/^05\d{8}$/.test(local)) {
    return `${local.slice(0, 3)}-${local.slice(3)}`
  }
  return raw
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function signProToken(phone) {
  const secret =
    process.env.PRO_PORTAL_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    'dev-pro-portal-secret'
  const digits = phone.replace(/\D/g, '')
  const body = b64url(
    JSON.stringify({ phone: digits, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 }),
  )
  const sig = b64url(createHmac('sha256', secret).update(body).digest())
  return `${body}.${sig}`
}

function buildSms({ storeName, storeCode, managerPhone, titles, portalUrl }) {
  const visit =
    titles.length <= 1
      ? 'ביקור אחד'
      : `ביקור אחד · ${titles.length} תקלות`
  const mgr = managerPhone
    ? `מנהל: ${formatIlsPhone(managerPhone)}`
    : null
  return [
    `Optical Center · ${storeName} (#${storeCode})`,
    visit,
    titles.length ? titles.join(' · ') : null,
    mgr,
    'קישור:',
    portalUrl,
  ]
    .filter(Boolean)
    .join('\n')
}

const appUrl = (
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.APP_URL ||
  'http://localhost:3000'
).replace(/\/$/, '')

const token = signProToken(TO)
const portalUrl = `${appUrl}/pro?t=${encodeURIComponent(token)}`
const message = buildSms({
  storeName: 'תל אביב שינקין',
  storeCode: '6004',
  managerPhone: '050-3393839',
  titles: ['נזילה ליד הקופה הראשית', 'מזגן באולם המכירות לא מקרר בכלל'],
  portalUrl,
})

const phone = to019Local(TO)
if (!phone) {
  console.error('bad phone', TO)
  process.exit(1)
}

if (process.env.SMS_019_ENABLED?.trim() !== '1') {
  console.error('SMS_019_ENABLED is not 1')
  process.exit(1)
}

const username = process.env.SMS_019_USERNAME?.trim()
const sender = process.env.SMS_019_SENDER?.trim()
const smsToken =
  process.env.SMS_019_TOKEN?.trim() ||
  process.env.SMS_019_BEARER_TOKEN?.trim()
const password = process.env.SMS_019_PASSWORD?.trim()

if (!username || !sender || (!smsToken && !password)) {
  console.error('019 SMS not configured')
  process.exit(1)
}

const user = { username }
if (!smsToken && password) user.password = password

const body = {
  sms: {
    user,
    source: sender.slice(0, 11),
    destinations: { phone },
    message,
  },
}

const headers = { 'Content-Type': 'application/json' }
if (smsToken) headers.Authorization = `Bearer ${smsToken}`

console.log('--- SMS preview ---')
console.log(message)
console.log('--- sending to', phone, '---')

const res = await fetch(SMS_019_API, {
  method: 'POST',
  headers,
  body: JSON.stringify(body),
})
const text = await res.text()
console.log('HTTP', res.status)
console.log(text.slice(0, 500))
try {
  const json = JSON.parse(text)
  const status = json?.sms?.status ?? json?.status
  if (String(status) === '0' || status === 0) {
    console.log('OK sent')
    process.exit(0)
  }
  console.error('provider status', status)
  process.exit(1)
} catch {
  process.exit(res.ok ? 0 : 1)
}
