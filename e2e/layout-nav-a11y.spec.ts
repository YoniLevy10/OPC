import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createStore172Ticket, DEMO_TECH_ID, HQ_ADMIN_ID, patchTicket } from './helpers/api'
import { TEST_ACTOR_COOKIE } from '../src/lib/auth/demo-session'
import { gotoStable } from './helpers/goto'

const VIEWPORTS = [
  { name: 'iphoneSE', width: 375, height: 667 },
  { name: 'iphone12', width: 390, height: 844 },
  { name: 'iphone14proMax', width: 430, height: 932 },
  { name: 'ipad', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const

test.describe('Navigation & layout', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([
      { name: TEST_ACTOR_COOKIE, value: HQ_ADMIN_ID, url: baseURL! },
    ])
  })

  test('desktop keeps three primary destinations and opens tools for the active route', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoStable(page, '/ops/dashboard')
    const nav = page.getByRole('navigation', { name: 'ניווט עיקרי', exact: true })
    await expect(nav.getByRole('link')).toHaveCount(3)
    await expect(nav.getByRole('link', { name: 'דשבורד', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'תקלות', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'WhatsApp', exact: true })).toBeVisible()

    const operations = nav.locator('details').filter({ has: page.locator('summary', { hasText: 'תפעול' }) })
    await expect(operations).not.toHaveAttribute('open')
    const summary = operations.locator('summary')
    await summary.focus()
    await summary.press('Enter')
    await expect(operations).toHaveAttribute('open', '')
    const approvals = nav.getByRole('link', { name: /^אישורים/ })
    await expect(approvals).toBeVisible()
    await expect(approvals.locator('.nav-alert')).toBeVisible()
    await expect(nav.getByRole('link', { name: /^מסמכים/ })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'דוחות', exact: true })).toBeVisible()
    await approvals.click()
    await expect(page).toHaveURL(/\/ops\/approvals/)
    await expect(nav.getByRole('link', { name: /^אישורים/ })).toHaveAttribute('aria-current', 'page')
    await expect(operations).toHaveAttribute('open', '')

    await gotoStable(page, '/ops/settings')
    const system = nav.locator('details').filter({ has: page.locator('summary', { hasText: 'מערכת' }) })
    await expect(system).toHaveAttribute('open', '')
    await expect(nav.getByRole('link', { name: 'הגדרות', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(operations).not.toHaveAttribute('open')
  })

  test('desktop sidebar routes', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    // /ops redirects to dashboard
    await gotoStable(page, '/ops')
    await expect(page).toHaveURL(/\/ops\/dashboard/)
    await expect(
      page.getByRole('heading', { name: /דשבורד|ראשי|מה לעשות עכשיו|בוקר טוב|צהריים טובים|ערב טוב|לילה טוב/ }),
    ).toBeVisible()
    await gotoStable(page, '/ops/tickets')
    await expect(page.getByRole('heading', { name: 'תקלות' }).first()).toBeVisible()
    await gotoStable(page, '/ops/stores')
    await expect(page.getByRole('heading', { name: 'חנויות' }).first()).toBeVisible()
    await gotoStable(page, '/ops/reports')
    await expect(page.getByRole('heading', { name: 'דוחות', exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /ייצוא CSV/ }).first()).toBeVisible()
    await gotoStable(page, '/ops/settings')
    await expect(page.getByRole('heading', { name: 'הגדרות', exact: true }).first()).toBeVisible()
  })

  test('mobile bottom nav + More', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoStable(page, '/ops/dashboard')
    const bottomNav = page.getByRole('navigation', { name: 'ניווט תחתון' })
    await expect(bottomNav.getByText('דשבורד')).toBeVisible()
    await expect(bottomNav.getByText('תקלות')).toBeVisible()
    await expect(bottomNav.getByRole('link')).toHaveCount(3)
    await expect(bottomNav.getByRole('link', { name: /^אישורים/ })).toHaveCount(0)
    await expect(bottomNav.getByRole('link', { name: 'WhatsApp' })).toBeVisible()
    // Secondary workflows stay reachable under More, including budget approvals.
    await bottomNav.getByRole('button', { name: 'עוד' }).click()
    const more = page.getByRole('dialog')
    await expect(more.getByRole('link', { name: 'משימות' })).toBeVisible()
    await expect(more.getByRole('link', { name: 'חנויות' })).toBeVisible()
    await expect(more.getByRole('link', { name: 'אנשי מקצוע' })).toBeVisible()
    const approvals = more.getByRole('link', { name: /^אישורים/ })
    await expect(approvals).toBeVisible()
    await expect(approvals.locator('.nav-alert')).toBeVisible()
    await expect(more.getByRole('link', { name: /^מסמכים/ })).toBeVisible()
    await expect(more.getByRole('link', { name: 'דוחות', exact: true })).toBeVisible()
    await expect(more.getByRole('link', { name: 'WhatsApp', exact: true })).toHaveCount(0)
    await expect(more.getByRole('link', { name: 'דשבורד', exact: true })).toHaveCount(0)
    await expect(more.getByRole('link', { name: 'תקלות', exact: true })).toHaveCount(0)
    await expect(more.getByRole('link', { name: 'הגדרות' })).toBeVisible()
    await approvals.click()
    await expect(page).toHaveURL(/\/ops\/approvals/)
    await expect(more).toHaveCount(0)
  })

  test('deep link ticket + refresh', async ({ page, request }) => {
    const { ticketId } = await createStore172Ticket(request)
    await gotoStable(page, `/ops/tickets/${ticketId}`)
    await page.reload({ waitUntil: 'domcontentloaded' })
    // Compact hero hides OC- eyebrow (display:none) — assert visible status copy.
    await expect(
      page.getByRole('main').getByText(/מזגן|תקלה/).first(),
    ).toBeVisible()
  })

  test('skip link focuses main content', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoStable(page, '/ops/dashboard')
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'דלג לתוכן' })
    await expect(skip).toBeFocused()
    await skip.click()
    await expect(page.locator('#main-content')).toBeFocused()
  })

  test('mobile shows page heading', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoStable(page, '/ops/tickets')
    await expect(page.getByRole('heading', { name: 'תקלות' }).first()).toBeVisible()
  })

  for (const vp of VIEWPORTS) {
    test(`no horizontal overflow @ ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      for (const path of ['/ops', '/ops/dashboard', '/ops/tickets', '/ops/stores', '/tech']) {
        await gotoStable(page, path)
        const overflow = await page.evaluate(() => {
          const doc = document.documentElement
          return doc.scrollWidth > doc.clientWidth + 2
        })
        expect(overflow, `${path} overflows at ${vp.name}`).toBe(false)
      }
    })
  }
})

test.describe('A11y smoke', () => {
  const AXE_ROUTES = [
    { path: '/ops/tickets', name: 'ops tickets' },
    { path: '/login', name: 'login' },
    { path: '/report', name: 'public report' },
    { path: '/ops/reports', name: 'ops reports' },
    { path: '/tech', name: 'tech queue' },
  ] as const

  for (const route of AXE_ROUTES) {
    test(`${route.name} has no critical axe violations`, async ({ page }) => {
      test.skip(
        test.info().project.name !== 'chromium',
        'axe smoke on chromium only',
      )
      await gotoStable(page, route.path)
      const results = await new AxeBuilder({ page })
        .disableRules(['color-contrast'])
        .analyze()
      const critical = results.violations.filter((v) => v.impact === 'critical')
      expect(critical, route.path).toEqual([])
    })
  }

  test('ops tickets main content has no serious color-contrast violations', async ({
    page,
  }) => {
    test.skip(
      test.info().project.name !== 'chromium',
      'axe smoke on chromium only',
    )
    await gotoStable(page, '/ops/tickets')
    const results = await new AxeBuilder({ page })
      .include('#main-content')
      .withRules(['color-contrast'])
      .analyze()
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    )
    expect(serious).toEqual([])
  })
})

// Visual regression: e2e/visual-pack.spec.ts

test.describe('PWA manifests', () => {
  test('HQ and tech manifests + icons', async ({ request }) => {
    const hq = await request.get('/manifest.webmanifest')
    expect(hq.ok()).toBeTruthy()
    const hqJson = await hq.json()
    // Brand short name after OPC rename (sidebar mark may still say MILO).
    expect(hqJson.name).toMatch(/OPC|MILO|Optical/i)
    expect(String(hqJson.start_url)).toMatch(/^\/ops\/dashboard/)
    expect(hqJson.id).toBe('/ops/dashboard')

    const tech = await request.get('/manifest-tech.webmanifest')
    expect(tech.ok()).toBeTruthy()
    const techJson = await tech.json()
    expect(techJson.start_url).toBe('/tech')

    const icon = await request.get('/icons/icon-192.png')
    expect(icon.ok()).toBeTruthy()
    const apple = await request.get('/icons/apple-touch-icon.png')
    expect(apple.ok()).toBeTruthy()
  })
})

test.describe('Offline honesty', () => {
  test('tech update shows failure when API aborted', async ({
    page,
    request,
    context,
  }) => {
    test.skip(
      test.info().project.name !== 'chromium',
      'route abort flaky on webkit in CI',
    )
    const { ticketId } = await createStore172Ticket(request)
    await patchTicket(request, ticketId, { assignedTo: DEMO_TECH_ID })
    await gotoStable(page, `/tech/${ticketId}?techId=${DEMO_TECH_ID}`)

    await context.route('**/api/tech/tickets/**', (route) => route.abort())
    const resolveBtn = page.getByRole('button', { name: /סיימתי|סיום|resolved|נפתר/i })
    if ((await resolveBtn.count()) > 0) {
      await resolveBtn.first().click()
      await expect(page.getByText(/שגיאה|נכשל|רשת/i).first()).toBeVisible({
        timeout: 10_000,
      })
    }
  })
})
