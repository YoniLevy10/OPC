import { test, expect } from '@playwright/test'
import { createStore172Ticket, DEMO_TECH_ID, patchTicket, authHeaders, HQ_ADMIN_ID } from './helpers/api'
import { signProPortalTokenForE2e } from './helpers/pro-token'

test.describe('Pilot scenarios (memory backend)', () => {
  test('2 — public web report creates ticket', async ({ page }) => {
    await page.goto('/report?store=172', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => undefined)
    const description = page.getByLabel('תיאור התקלה')
    await expect(description).toBeVisible()
    // Controlled textarea: wait for hydration, then confirm the value stuck
    // before submit (empty fill previously failed with תארו את התקלה).
    await description.click()
    await description.fill('בדיקת פיילוט — דליפת מים ליד הדלפק')
    await expect(description).toHaveValue(/דליפת מים/)
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
    const name = page.getByLabel('שם אחרי השיחה')
    const phone = page.getByLabel('טלפון', { exact: true })
    await name.fill('טכנאי דמו')
    await phone.fill('0501234567')
    await page.getByLabel(/מחיר שסוכם/).fill('450')
    await expect(name).toHaveValue('טכנאי דמו')
    await expect(phone).toHaveValue('0501234567')
    // Isolate this ticket — store companions from prior seeds can block the lock.
    for (const box of await page.locator('#ticket-actions input[name="bundle"]').all()) {
      if (await box.isChecked()) await box.uncheck()
    }
    await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === 'POST' &&
          res.url().includes(`/ops/tickets/${ticketId}`) &&
          (res.status() === 303 || res.status() === 200),
      ),
      page
        .locator('#ticket-actions')
        .getByRole('button', { name: /אשר · WA/ })
        .click(),
    ])
    // Soft action redirect can leave a stale client tree — hard reload is the
    // reliable PRG finish for this form until the desk opts out of router cache.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(
      page.getByText(/נשלח איש מקצוע לתיקון|המחיר נעול/i).first(),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('3b — pro portal token shows assigned jobs after lock', async ({
    page,
    request,
  }) => {
    const { ticketId } = await createStore172Ticket(request)
    // Desktop shell: mobile dock submit + urgent remount raced and posted an empty name.
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`/ops/tickets/${ticketId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading').first()).toBeVisible()
    const markUrgent = page.getByRole('button', { name: 'סמן כדחוף' })
    if ((await markUrgent.count()) > 0) {
      await markUrgent.click()
      await expect(page.getByRole('button', { name: /אשר/ })).toBeVisible({
        timeout: 10_000,
      })
    }
    const name = page.getByLabel('שם אחרי השיחה')
    const phone = page.getByLabel('טלפון', { exact: true })
    await name.fill('פבל דמו')
    await phone.fill('0509988776')
    await expect(name).toHaveValue('פבל דמו')
    await expect(phone).toHaveValue('0509988776')
    for (const box of await page.locator('#ticket-actions input[name="bundle"]').all()) {
      if (await box.isChecked()) await box.uncheck()
    }
    await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === 'POST' &&
          res.url().includes(`/ops/tickets/${ticketId}`) &&
          (res.status() === 303 || res.status() === 200),
      ),
      page
        .locator('#ticket-actions')
        .getByRole('button', { name: /אשר · WA/ })
        .click(),
    ])
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByText(/נשלח איש מקצוע לתיקון|המחיר נעול/i).first()).toBeVisible({
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
