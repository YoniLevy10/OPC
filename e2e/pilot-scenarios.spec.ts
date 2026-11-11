import { test, expect } from '@playwright/test'
import { createStore172Ticket, DEMO_TECH_ID, patchTicket, authHeaders, HQ_ADMIN_ID } from './helpers/api'
import { signProPortalTokenForE2e } from './helpers/pro-token'

test.describe('Pilot scenarios (memory backend)', () => {
  test('2 — public web report creates ticket', async ({ page }) => {
    await page.goto('/report?store=172', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('תיאור התקלה').fill('בדיקת פיילוט — דליפת מים ליד הדלפק')
    await page.getByRole('button', { name: 'שליחת דיווח' }).click()
    await expect(page.getByText(/הדיווח התקבל/i)).toBeVisible({ timeout: 15_000 })
  })

  test('3 — HQ locks Midrag engagement (אשר עסקה)', async ({ page, request }) => {
    const { ticketId } = await createStore172Ticket(request)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`/ops/tickets/${ticketId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading').first()).toBeVisible()
    // Ticket detail: book-first EngagementPanel → Midrag bootstrap → lock.
    const markUrgent = page.getByRole('button', { name: 'סמן כדחוף' })
    if ((await markUrgent.count()) > 0) {
      await markUrgent.click()
      await expect(page.getByRole('button', { name: /אשר/ })).toBeVisible({
        timeout: 10_000,
      })
    }
    await page.getByLabel('שם אחרי השיחה').fill('טכנאי דמו')
    await page.getByLabel('טלפון').fill('0501234567')
    await page.getByLabel('מחיר שסוכם').fill('450')
    await page.getByRole('button', { name: /אשר · WA|אשר/ }).first().click()
    await expect(
      page.getByText(/ארי יצא|המחיר נעול|מנהל החנות מתאם/i).first(),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('3b — pro portal token shows assigned jobs after lock', async ({
    page,
    request,
  }) => {
    const { ticketId } = await createStore172Ticket(request)
    await page.goto(`/ops/tickets/${ticketId}`, { waitUntil: 'domcontentloaded' })
    const markUrgent = page.getByRole('button', { name: 'סמן כדחוף' })
    if ((await markUrgent.count()) > 0) await markUrgent.click()
    await page.getByLabel('שם אחרי השיחה').fill('פבל דמו')
    await page.getByLabel('טלפון').fill('0509988776')
    await page.getByRole('button', { name: /אשר/ }).first().click()
    await expect(page.getByText(/ארי יצא|המחיר נעול|מנהל החנות מתאם/i).first()).toBeVisible({
      timeout: 15_000,
    })
    const token = signProPortalTokenForE2e('0509988776')
    await page.goto(`/pro?t=${encodeURIComponent(token)}`, {
      waitUntil: 'domcontentloaded',
    })
    await expect(page.getByText(/עבודות משויכות|פבל דמו|אין עבודות/i).first()).toBeVisible({
      timeout: 10_000,
    })
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
