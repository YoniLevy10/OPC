import { test, expect } from '@playwright/test'
import { uniqueWaId } from './helpers/api'

async function demoSession(request: import('@playwright/test').APIRequestContext) {
  const res = await request.post('/api/auth/demo-session', {
    data: { role: 'hq' },
  })
  expect(res.ok()).toBeTruthy()
}

async function openStoreTicket(
  request: import('@playwright/test').APIRequestContext,
  text: string,
) {
  const wa_id = uniqueWaId()
  await request.post('/api/demo/whatsapp', {
    data: { wa_id, text: 'STORE_172', source: 'whatsapp' },
  })
  const res = await request.post('/api/demo/whatsapp', {
    data: { wa_id, text, source: 'whatsapp' },
  })
  const json = await res.json()
  expect(json.ticket_id).toBeTruthy()
  return json.ticket_id as string
}

test.describe('P1 vendors / RFQ / spend / visits (MEMORY)', () => {
  test.beforeEach(async ({ request }) => {
    await demoSession(request)
  })

  test('preferred vendors show dial-only vs dispatchable on ticket', async ({
    page,
    request,
  }) => {
    const ticketId = await openStoreTicket(request, 'המזגן בחדר הצוות לא עובד')
    await page.goto(`/ops/tickets/${ticketId}`, { waitUntil: 'domcontentloaded' })
    const panel = page.locator('[data-visual="preferred-vendors"]')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('חיוג בלבד').first()).toBeVisible()
    // At least one preferred HVAC row; Clima Center is seeded with webhook.
    const dial = panel.locator('[data-channel="dial_only"]')
    await expect(dial.first()).toBeVisible()
    const dispatchable = panel.locator('[data-channel="dispatchable"]')
    if ((await dispatchable.count()) > 0) {
      await expect(panel.getByText('שיגור דיגיטלי').first()).toBeVisible()
      await expect(panel.getByRole('button', { name: /שגר/ }).first()).toBeVisible()
    }
  })

  test('RFQ draft saves without a send endpoint', async ({ page, request }) => {
    const ticketId = await openStoreTicket(request, 'מזגן לטיוטת הצעה')
    await page.goto(`/ops/tickets/${ticketId}`, { waitUntil: 'domcontentloaded' })
    const rfq = page.locator('[data-visual="rfq-draft"]')
    await expect(rfq).toBeVisible()
    await rfq.locator('#rfq-timing').fill('השבוע · בוקר')
    await rfq.getByRole('button', { name: /שמור טיוטה/ }).click()
    await expect(page.getByText(/טיוטת הצעה נשמרה|לא נשלחה/).first()).toBeVisible({
      timeout: 15000,
    })
    await expect(rfq.locator('[data-rfq-id]').first()).toBeVisible()

    const send = await request.post('/api/rfq/drafts/send', { data: {} })
    expect(send.status()).toBe(404)

    const listed = await request.get(
      `/api/rfq/drafts?ticketId=${encodeURIComponent(ticketId)}`,
    )
    expect(listed.ok()).toBeTruthy()
    const body = await listed.json()
    expect(body.drafts?.length).toBeGreaterThan(0)
    expect(body.drafts[0].status).toBe('draft')
  })

  test('spend approve and reject gates on approvals page', async ({ page }) => {
    await page.goto('/ops/approvals', { waitUntil: 'networkidle' })
    const reason = `P1-E2E-${Date.now()}`
    await page.locator('input[name="storeCode"]').first().fill('6006')
    await page.locator('input[name="storeName"]').first().fill('תל אביב אבן גבירול')
    await page.locator('input[name="reason"]').first().fill(reason)
    await page.locator('input[name="vendor"]').first().fill('קלימה סנטר')
    await page.locator('input[name="amount"]').first().fill('510')
    await page
      .locator('form')
      .filter({ has: page.locator('input[name="storeCode"]') })
      .locator('button[type="submit"]')
      .first()
      .click()
    await page.goto('/ops/approvals', { waitUntil: 'networkidle' })
    await expect(page.getByText(reason).first()).toBeVisible()

    await page.evaluate((needle) => {
      const nodes = [...document.querySelectorAll('p, div, span')].filter((el) =>
        (el.textContent || '').includes(needle),
      )
      for (const node of nodes) {
        let root: HTMLElement | null = node as HTMLElement
        for (let i = 0; i < 6 && root; i++) {
          const btn = [...root.querySelectorAll('button')].find(
            (b) => (b.textContent || '').trim() === 'אשר',
          )
          if (btn) {
            btn.click()
            return
          }
          root = root.parentElement
        }
      }
    }, reason)
    await page.waitForTimeout(800)
    await page.goto('/ops/approvals', { waitUntil: 'networkidle' })
    await expect(page.getByText(reason).first()).toBeVisible()
    await expect(page.getByText(/מאושר|אושר/).first()).toBeVisible()
  })

  test('combined visit is honest when spend is missing', async ({
    request,
  }) => {
    const a = await openStoreTicket(request, 'מזגן לביקור ללא אישור א')
    const b = await openStoreTicket(request, 'מזגן לביקור ללא אישור ב')
    const sug = await request.get('/api/vendors/suggest?category=hvac&regionId=TA')
    const matches = (await sug.json()).matches ?? []
    const vendor =
      matches.find(
        (m: { dispatchable?: boolean; specialties?: string }) =>
          m.dispatchable || (m.specialties || '').includes('hvac'),
      ) ?? matches[0]
    expect(vendor?.id).toBeTruthy()

    const visitRes = await request.post('/api/ops/visits', {
      data: {
        storeId: 'il-store-172',
        ticketIds: [a, b],
        vendorId: vendor.id,
        notes: 'P1 e2e honesty',
        idempotencyKey: `p1-e2e-${Date.now()}`,
      },
    })
    expect([207, 201]).toContain(visitRes.status())
    const body = await visitRes.json()
    expect(body.visit.status).toBe('partial')
    expect(body.visit.items.every((i: { status: string }) => i.status === 'blocked')).toBe(
      true,
    )
    expect(
      body.visit.items.every((i: { needs_approval?: boolean }) => i.needs_approval),
    ).toBe(true)
    expect(body.visit.items.some((i: { status: string }) => i.status === 'sent')).toBe(
      false,
    )
  })
})
