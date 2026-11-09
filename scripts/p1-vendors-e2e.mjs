/**
 * P1 MEMORY UI evidence: spend approve/reject + multi-select visit honesty.
 */
import { chromium } from '@playwright/test'
import { mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000'
const art = '/opt/cursor/artifacts'
const media = '/cursor/stores/self/media'
mkdirSync(art, { recursive: true })
mkdirSync(media, { recursive: true })

async function shot(page, name) {
  const file = `${name}.png`
  const p1 = join(art, file)
  await page.screenshot({ path: p1, fullPage: false })
  copyFileSync(p1, join(media, file))
  console.log('shot', file)
}

async function makeTicket(request, text) {
  const wa = `97250${Math.floor(Math.random() * 1e7)
    .toString()
    .padStart(7, '0')}`
  await request.post(`${BASE}/api/demo/whatsapp`, {
    data: { wa_id: wa, text: 'STORE_172', source: 'whatsapp' },
  })
  const res = await request.post(`${BASE}/api/demo/whatsapp`, {
    data: { wa_id: wa, text, source: 'whatsapp' },
  })
  const json = await res.json()
  return json.ticket_id
}

async function fillSpend(page, { reason, vendor, amount }) {
  await page.locator('input[name="storeCode"]').first().fill('6006')
  await page.locator('input[name="storeName"]').first().fill('תל אביב אבן גבירול')
  await page.locator('input[name="reason"]').first().fill(reason)
  await page.locator('input[name="vendor"]').first().fill(vendor)
  await page.locator('input[name="amount"]').first().fill(String(amount))
  await page.locator('input[name="scope"]').first().fill('ביקור')
  await page
    .locator('form')
    .filter({ has: page.locator('input[name="storeCode"]') })
    .locator('button[type="submit"]')
    .first()
    .click()
  await page.waitForTimeout(800)
  await page.goto(`${BASE}/ops/approvals`, { waitUntil: 'networkidle' })
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  locale: 'he-IL',
})
await page.request.post(`${BASE}/api/auth/demo-session`, { data: { role: 'hq' } })

await page.goto(`${BASE}/ops/approvals`, { waitUntil: 'networkidle' })
const unique = `P1-GATE-${Date.now()}`
await fillSpend(page, {
  reason: `${unique} pending`,
  vendor: 'קלימה סנטר',
  amount: 880,
})
await page.getByText(`${unique} pending`).first().scrollIntoViewIfNeeded()
await shot(page, 'p1-vendors-spend-pending')

async function clickSpendAction(page, reasonNeedle, buttonName) {
  await page.getByText(reasonNeedle).first().scrollIntoViewIfNeeded()
  const clicked = await page.evaluate(
    ({ needle, buttonName: name }) => {
      const nodes = [...document.querySelectorAll('p, div, span')].filter((el) =>
        (el.textContent || '').includes(needle),
      )
      for (const node of nodes) {
        let root = node
        for (let i = 0; i < 6 && root; i++) {
          const btn = [...root.querySelectorAll('button')].find(
            (b) => (b.textContent || '').trim() === name,
          )
          if (btn) {
            btn.click()
            return true
          }
          root = root.parentElement
        }
      }
      return false
    },
    { needle: reasonNeedle, buttonName },
  )
  if (!clicked) throw new Error(`button ${buttonName} not found near ${reasonNeedle}`)
}

// Approve — card button «אשר» (not Midrag «לאשר»)
await clickSpendAction(page, `${unique} pending`, 'אשר')
await page.waitForTimeout(1200)
await page.goto(`${BASE}/ops/approvals`, { waitUntil: 'networkidle' })

const uniqueR = `P1-REJ-${Date.now()}`
await fillSpend(page, {
  reason: `${uniqueR} reject`,
  vendor: 'דרום אייר',
  amount: 320,
})
await clickSpendAction(page, `${uniqueR} reject`, 'לדחות')
await page.waitForTimeout(1200)
await page.goto(`${BASE}/ops/approvals?notice=rejected`, { waitUntil: 'networkidle' })
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await shot(page, 'p1-vendors-spend-approved')
console.log('spend_gates', { approved: unique, rejected: uniqueR })

// Visit multi-select UI
const id1 = await makeTicket(page.request, `מזגן ביקור ${Date.now()}`)
const id2 = await makeTicket(page.request, `ברז ביקור ${Date.now()}`)
console.log('tickets', id1, id2)

await page.goto(`${BASE}/ops/tickets?store=6006&view=open`, {
  waitUntil: 'networkidle',
})
// Prefer selecting rows that match our new tickets via article checkboxes
const articles = page.locator('article')
const n = await articles.count()
let selected = 0
for (let i = 0; i < n && selected < 2; i++) {
  const artEl = articles.nth(i)
  const box = artEl.locator('input[type="checkbox"]').first()
  if ((await box.count()) === 0) continue
  await box.check({ force: true })
  selected++
}
console.log('selected', selected)
await page.waitForTimeout(400)
await shot(page, 'p1-vendors-visit-multiselect')

const bar = page.getByRole('button', { name: 'שיגור ביקור' })
await bar.waitFor({ state: 'visible', timeout: 10000 })
await bar.click()
await page.waitForTimeout(600)
// Confirm sheet submit
const submit = page.getByRole('button', { name: /אשר שיגור|שגר|שלח שיגור|שיגור ביקור/ })
// Inside sheet there is a primary confirm — look for Hebrew status labels after
const sheetSubmit = page.locator('[role="dialog"] button, [data-state="open"] button').filter({ hasText: /שיגור|אשר|שגר/ }).last()
if (await sheetSubmit.isVisible().catch(() => false)) {
  await sheetSubmit.click()
} else {
  // VisitConfirmSheet may use onSubmit button text
  await page.getByRole('button', { name: /לשגר|שיגור|אשר/ }).last().click({ force: true })
}
await page.waitForTimeout(2000)
// Capture result honesty
const resultText = await page.locator('body').innerText()
const honest =
  /חסום|חלקי|נדרש אישור|סומן לשיבוץ|ממתינה לאישור/.test(resultText)
console.log('visit_ui_honest_markers', honest)
await shot(page, 'p1-vendors-visit-result')

// API honesty (authoritative for partial/blocked)
const sug = await page.request.get(`${BASE}/api/vendors/suggest?category=hvac&regionId=TA`)
const matches = (await sug.json()).matches || []
const vendor = matches.find((m) => m.dispatchable) || matches[0]
const visitRes = await page.request.post(`${BASE}/api/ops/visits`, {
  data: {
    storeId: 'il-store-172',
    ticketIds: [id1, id2],
    vendorId: vendor.id,
    notes: 'P1 playwright honesty',
    idempotencyKey: `p1-pw-${Date.now()}`,
  },
})
const visitJson = await visitRes.json()
console.log(
  'VISIT_API',
  visitRes.status(),
  JSON.stringify({
    status: visitJson.visit?.status,
    items: (visitJson.visit?.items || []).map((i) => ({
      status: i.status,
      needs_approval: i.needs_approval,
      can_retry: i.can_retry,
      error: i.error,
    })),
  }),
)

await browser.close()
console.log('OK')
