import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { gotoStable } from './helpers/goto'

const ROUTES = [
  '/login',
  '/ops/dashboard',
  '/ops/tickets',
  '/ops/stores',
  '/ops/inbox',
  '/ops/settings',
  '/ops/simulator',
  '/tech',
  '/report?store=172',
] as const

test.describe('A11y full pack', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'axe full pack on chromium only',
    )
  })

  for (const path of ROUTES) {
    test(`no critical axe violations on ${path}`, async ({ page }) => {
      // Stores directory + per-store QR accordion is a large DOM; give axe room.
      if (path === '/ops/stores') test.setTimeout(120_000)
      await gotoStable(page, path)
      let builder = new AxeBuilder({ page }).disableRules(['color-contrast'])
      // Progressive QR list is intentionally dense — exclude from axe budget.
      if (path === '/ops/stores') {
        builder = builder.exclude('[aria-label="QR לפי סניף"]')
      }
      const results = await builder.analyze()
      const critical = results.violations.filter((v) => v.impact === 'critical')
      expect(critical, path).toEqual([])
    })
  }

  test('public report success avoids HQ redirect', async ({ page }) => {
    await page.route('**/api/report', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ticket: { id: 'demo-id', display_number: 'OC-999' },
        }),
      })
    })
    await gotoStable(page, '/report?store=172')
    await page.getByLabel('תיאור התקלה').fill('בדיקת נגישות')
    await page.getByRole('button', { name: 'שליחת דיווח' }).click()
    await expect(page.getByRole('button', { name: 'דיווח נוסף' })).toBeVisible()
    await expect(page.getByRole('link', { name: /HQ|תור/i })).toHaveCount(0)
  })
})
