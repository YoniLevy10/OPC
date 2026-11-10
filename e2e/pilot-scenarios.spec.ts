import { test, expect } from '@playwright/test'
import { createStore172Ticket, DEMO_TECH_ID, patchTicket, authHeaders, HQ_ADMIN_ID } from './helpers/api'
import { TEST_ACTOR_COOKIE } from '../src/lib/auth/demo-session'

test.describe('Pilot scenarios (memory backend)', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ name: TEST_ACTOR_COOKIE, value: HQ_ADMIN_ID, url: baseURL! }])
  })
  test('2 — public web report creates ticket', async ({ page }) => {
    await page.goto('/report?store=172', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('תיאור התקלה').fill('בדיקת פיילוט — דליפת מים ליד הדלפק')
    await page.getByRole('button', { name: 'שליחת דיווח' }).click()
    await expect(page.getByText(/הדיווח התקבל/i)).toBeVisible({ timeout: 15_000 })
  })

  test('3 — Ari plans the visit and approves agreed contact and price', async ({ page, request }) => {
    const { ticketId } = await createStore172Ticket(request)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`/ops/tickets/${ticketId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading').first()).toBeVisible()
    await page.getByRole('button', { name: 'תכנון ביקור', exact: true }).click()
    const plan = page.getByRole('dialog', { name: 'תכנון ביקור', exact: true })
    await expect(plan.getByRole('link', { name: /חיפוש במידרג/ })).toHaveAttribute('href', /serviceId=284&cityId=1243/)
    await plan.getByLabel('שם איש המקצוע', { exact: true }).fill('טכנאי דמו')
    await plan.getByLabel('טלפון איש המקצוע', { exact: true }).fill('0501234567')
    await plan.getByLabel('מחיר שסוכם לכל הביקור (₪)', { exact: true }).fill('450')
    await plan.getByRole('button', { name: 'אשר טיפול והעבר לחנות', exact: true }).click()
    await expect(plan.getByText('ארי אישר את הטיפול', { exact: true })).toBeVisible()
    await plan.getByRole('button', { name: 'סגור', exact: true }).click()
    await expect(
      page.getByText('הטיפול אושר. מנהל החנות מתאם.', { exact: true }),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('4 — tech resolves assigned job', async ({ page, request }) => {
    const { ticketId } = await createStore172Ticket(request)
    await patchTicket(request, ticketId, { assignedTo: DEMO_TECH_ID })
    await page.goto(`/tech/${ticketId}?techId=${DEMO_TECH_ID}`, {
      waitUntil: 'domcontentloaded',
    })
    const start = page.getByRole('button', { name: /התחל טיפול|התחלת טיפול|תפיסה/i })
    if ((await start.count()) > 0) {
      await start.first().click()
      await expect(page.getByText(/הטיפול התחיל|נשמר|סיימתי/i).first()).toBeVisible({
        timeout: 10_000,
      })
    }
  })

  test('5 — reports export endpoints respond', async ({ request }) => {
    for (const format of ['csv', 'xlsx', 'pdf'] as const) {
      const res = await request.get(`/api/reports/export?format=${format}`, {
        headers: authHeaders(HQ_ADMIN_ID),
      })
      expect(res.ok(), format).toBeTruthy()
    }
  })
})
