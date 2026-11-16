#!/usr/bin/env node
/**
 * Fix WhatsApp Cloud API webhook for Optical Center production number.
 *
 * Usage:
 *   WHATSAPP_ACCESS_TOKEN='EAAG...' node scripts/fix-wa-webhook.mjs
 *
 * Token: Meta Developers → optical center app → WhatsApp → API Setup → Generate token
 * (temporary is fine; needs whatsapp_business_management + whatsapp_business_messaging)
 */

const WABA_ID = process.env.WHATSAPP_WABA_ID || '1582891686544300'
const PHONE_NUMBER_ID =
  process.env.WHATSAPP_PHONE_NUMBER_ID || '1322189407641255'
const CALLBACK =
  process.env.WHATSAPP_CALLBACK_URL ||
  'https://opc-jerusalem.vercel.app/api/whatsapp/webhook'
const VERIFY =
  process.env.WHATSAPP_VERIFY_TOKEN || 'opc-wa-verify-32a2f56610b82356'
const API = 'https://graph.facebook.com/v22.0'
const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN?.trim()

if (!TOKEN) {
  console.error(
    'Missing WHATSAPP_ACCESS_TOKEN.\n' +
      '1) Meta → optical center → WhatsApp → API Setup → Generate token\n' +
      '2) WHATSAPP_ACCESS_TOKEN="..." node scripts/fix-wa-webhook.mjs',
  )
  process.exit(1)
}

async function graph(method, path, body) {
  const res = await fetch(`${API}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  return { ok: res.ok, status: res.status, json }
}

function print(label, result) {
  console.log(`\n=== ${label} (${result.status}) ===`)
  console.log(JSON.stringify(result.json, null, 2))
}

const before = await graph(
  'GET',
  `${PHONE_NUMBER_ID}?fields=id,display_phone_number,webhook_configuration`,
)
print('BEFORE webhook_configuration', before)

const phoneOverride = await graph('POST', PHONE_NUMBER_ID, {
  webhook_configuration: {
    override_callback_uri: CALLBACK,
    verify_token: VERIFY,
  },
})
print('POST phone override', phoneOverride)

const subscribe = await graph('POST', `${WABA_ID}/subscribed_apps`, {
  override_callback_uri: CALLBACK,
  verify_token: VERIFY,
})
print('POST subscribed_apps', subscribe)

const after = await graph(
  'GET',
  `${PHONE_NUMBER_ID}?fields=id,display_phone_number,webhook_configuration`,
)
print('AFTER webhook_configuration', after)

const apps = await graph('GET', `${WABA_ID}/subscribed_apps`)
print('subscribed_apps', apps)

const cfg = after.json?.webhook_configuration || {}
const urls = [cfg.phone_number, cfg.whatsapp_business_account, cfg.application]
  .filter(Boolean)
  .join(' | ')

if (urls.includes('opc-jerusalem.vercel.app')) {
  console.log('\nOK — webhook points at opc-jerusalem.')
  process.exit(0)
}

console.error(
  '\nFAIL — webhook still not opc-jerusalem.\n' +
    'Paste the JSON blocks above (no token) into chat.',
)
process.exit(2)
