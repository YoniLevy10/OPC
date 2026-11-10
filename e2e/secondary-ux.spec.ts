import { test, expect } from '@playwright/test'
import { TEST_ACTOR_COOKIE } from '../src/lib/auth/demo-session'
import { HQ_ADMIN_ID } from './helpers/api'

test.beforeEach(async ({ context, baseURL, page }) => {
  await context.addCookies([{ name: TEST_ACTOR_COOKIE, value: HQ_ADMIN_ID, url: baseURL! }])
  await page.addInitScript(() => localStorage.setItem('maintainos-theme', 'light'))
})

for (const width of [390, 1440]) {
  test(`document renewal is visible and date editing remains usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/ops/documents')
    const tools = page.locator('details').filter({ has: page.locator('summary', { hasText: 'הוספת מסמך או חיבור תיקייה' }) })
    await expect(tools.locator('summary').first()).toBeInViewport()
    await expect(tools).not.toHaveAttribute('open')
    const folder = page.locator('[data-find-group]').first()
    const summary = folder.locator(':scope > summary')
    await expect(summary).toContainText('פגי תוקף')
    expect((await summary.boundingBox())!.height).toBeLessThan(120)
    await summary.click()
    const paper = folder.locator('.doc-file-row').first()
    if (width < 1024) await paper.getByRole('button', { name: /^פרטים/ }).click()
    const date = paper.locator('.doc-expiry-quick input[type="date"][name="expiry"]')
    await expect(date).toBeVisible()
    const bounds = (await date.boundingBox())!
    expect(bounds.width).toBeGreaterThanOrEqual(180)
    expect(bounds.height).toBeGreaterThanOrEqual(44)
    await date.fill('2027-12-31')
    await expect(date).toHaveValue('2027-12-31')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('mobile reports offers one export row and settings has readable category selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/ops/reports')
  const csv = page.getByRole('button', { name: /^ייצוא CSV/ })
  await expect(csv).toHaveCount(1)
  const excel = page.getByRole('button', { name: 'Excel', exact: true })
  const pdf = page.getByRole('button', { name: 'PDF', exact: true })
  await expect(csv).toBeVisible()
  const boxes = await Promise.all([csv.boundingBox(), excel.boundingBox(), pdf.boundingBox()])
  expect(Math.max(...boxes.map((box) => box!.y)) - Math.min(...boxes.map((box) => box!.y))).toBeLessThan(3)
  await page.goto('/ops/settings')
  await page.getByRole('button', { name: /^עריכה/ }).click()
  await page.getByLabel('קטגוריית הגדרות').selectOption('notifications')
  await expect(page.getByLabel('מייל התראות Ops', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('desktop store directory uses available width and keeps duplicate QR utilities secondary', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/ops/stores')
  const regions = page.locator('section[aria-labelledby^="region-"]')
  const first = (await regions.nth(0).boundingBox())!
  const second = (await regions.nth(1).boundingBox())!
  expect(Math.abs(first.y - second.y)).toBeLessThan(2)
  expect(Math.abs(first.x - second.x)).toBeGreaterThan(300)
  const qr = page.locator('details').filter({ has: page.locator('summary', { hasText: 'QR וקישורי דיווח לכל החנויות' }) })
  await expect(qr).not.toHaveAttribute('open')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
