import { test, expect, type APIRequestContext, type Page, type Locator } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { authHeaders, HQ_ADMIN_ID, OTHER_TECH_ID, patchTicket } from './helpers/api'
import { TEST_ACTOR_COOKIE } from '../src/lib/auth/demo-session'
import { LOCALE_COOKIE } from '../src/lib/i18n/locale'

const MAX_DIFF = 0.03
const MD_BREAKPOINT = 1024
const VIEWPORTS = [
  { name: 'w390', width: 390, height: 844 },
  { name: 'w430', width: 430, height: 932 },
  { name: 'w960', width: 960, height: 1024 },
  { name: 'w1024', width: 1024, height: 768 },
  { name: 'w1440', width: 1440, height: 900 },
] as const

type VisualFixture = { ticketId: string; storeId: string; storeCode: string; marker: string; displayNumber: string }

/** Own data only: no reset of tickets or documents created by other test files. */
async function createVisualFixture(request: APIRequestContext): Promise<VisualFixture> {
  const health = await request.get('/api/health')
  expect((await health.json()).backend, 'visual fixture must use memory, never a connected database').toBe('memory')
  const headers = authHeaders(HQ_ADMIN_ID)
  const marker = `VISUAL_${crypto.randomUUID().slice(0, 8)}`
  const storeCode = String(800000 + Math.floor(Math.random() * 100000))
  const storeResponse = await request.post('/api/stores', { headers, data: {
    code: storeCode, name: 'חנות בדיקת תצוגה', city: 'קריית בדיקה', address: 'רחוב הבדיקה 10',
  } })
  expect(storeResponse.ok(), await storeResponse.text()).toBe(true)
  const { store } = await storeResponse.json()
  let ticketId: string | null = null
  try {
    const ticketResponse = await request.post('/api/tickets', { headers, data: {
      storeCode, description: `המזגן הראשי לא עובד ${marker}`, title: 'המזגן הראשי לא עובד',
      category: 'hvac', priority: 'high', source: 'web_fallback', reporterName: 'מנהל חנות בדיקה',
    } })
    expect(ticketResponse.ok(), await ticketResponse.text()).toBe(true)
    const { ticket } = await ticketResponse.json()
    ticketId = ticket.id
    expect((await patchTicket(request, ticket.id, { assignedTo: OTHER_TECH_ID })).status).toBe(200)
    return { ticketId: ticket.id, storeId: store.id, storeCode, marker, displayNumber: ticket.display_number }
  } catch (error) {
    if (ticketId) await patchTicket(request, ticketId, { status: 'cancelled' })
    await request.patch(`/api/stores/${store.id}`, { headers, data: { is_active: false } })
    throw error
  }
}

async function cleanupFixture(request: APIRequestContext, fixture: VisualFixture) {
  expect((await patchTicket(request, fixture.ticketId, { status: 'cancelled' })).status).toBe(200)
  const response = await request.patch(`/api/stores/${fixture.storeId}`, {
    headers: authHeaders(HQ_ADMIN_ID), data: { is_active: false },
  })
  expect(response.ok()).toBe(true)
}

async function gotoStable(page: Page, path: string) {
  // Each request gets the correct identity, including the first SSR request after tech.
  await page.context().addCookies([
    { name: TEST_ACTOR_COOKIE, value: path.startsWith('/tech') ? OTHER_TECH_ID : HQ_ADMIN_ID, url: new URL(test.info().project.use.baseURL!).origin },
    { name: LOCALE_COOKIE, value: 'he', url: new URL(test.info().project.use.baseURL!).origin },
  ])
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined)
  await page.evaluate(() => document.fonts.ready)
  const md = await page.evaluate((breakpoint) => window.matchMedia(`(min-width: ${breakpoint}px)`).matches, MD_BREAKPOINT)
  expect(md, `CSS md must match the actual 1024px breakpoint at ${page.viewportSize()!.width}px`).toBe(page.viewportSize()!.width >= MD_BREAKPOINT)
}

/** Wrap only variable tokens; ticket text, cards, typography and timeline stay visible. */
async function tagDynamicText(page: Page, fixture: VisualFixture) {
  await page.evaluate(({ marker, storeCode, displayNumber, ticketId }) => {
    const tokens = [marker, storeCode, displayNumber, ticketId].filter(Boolean)
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      if (!node.parentElement?.closest('script, style, option, [data-visual-dynamic]') &&
        (tokens.some((token) => node.data.includes(token)) || /נפתחה זה עתה|פתוחה כבר|לפני \d+ דקות|עכשיו/.test(node.data))) nodes.push(node)
    }
    for (const node of nodes) {
      let remainder = node.data
      const nodeTokens = [...tokens, ...(node.data.match(/נפתחה זה עתה|פתוחה כבר \d+ (?:דקות|שעות|ימים)|לפני \d+ דקות|עכשיו/g) ?? [])]
      const fragment = document.createDocumentFragment()
      while (remainder) {
        const matches = nodeTokens.map((token) => ({ token, at: remainder.indexOf(token) })).filter((match) => match.at >= 0).sort((a, b) => a.at - b.at)
        const match = matches[0]
        if (!match) { fragment.append(remainder); break }
        fragment.append(remainder.slice(0, match.at))
        const span = document.createElement('span')
        span.dataset.visualDynamic = 'token'
        span.textContent = match.token
        fragment.append(span)
        remainder = remainder.slice(match.at + match.token.length)
      }
      node.replaceWith(fragment)
    }
    // Hide the search value only, preserving its border, icon, clear button and size.
    const style = document.createElement('style')
    style.textContent = 'input[type="search"] { color: transparent !important; caret-color: transparent !important; }'
    document.head.append(style)
  }, fixture)
}

function dynamicMasks(page: Page): Locator[] {
  return [
    page.locator('[data-visual-dynamic]'),
    page.locator('[data-live="sla"], [data-live="age"], .live-sla, .live-age'),
    page.locator('[data-activity-kind] .t-num'),
    page.locator('.nav-alert'),
    page.locator('[data-visual="system-status"]'),
    page.getByText(/^(?:נפתחה זה עתה|פתוחה כבר .+|לפני \d+ דקות|עכשיו)$/),
    // The sidebar's icon/label stay visible; only its changing suggestion count is masked.
    page.locator('[data-live="ticket-no"]'),
  ]
}

async function shot(page: Page, name: string, fixture: VisualFixture) {
  await tagDynamicText(page, fixture)
  // A timestamp underneath fixed navigation is not visible content to mask.
  // Painting its box would otherwise obscure the navigation in the evidence.
  await page.locator('[data-visual-mask-foreground]').evaluateAll((elements) => {
    elements.forEach((element) => element.removeAttribute('data-visual-mask-foreground'))
  })
  for (const candidate of dynamicMasks(page)) {
    await candidate.evaluateAll((elements) => {
      for (const element of elements) {
        const bounds = element.getBoundingClientRect()
        const x = bounds.x + bounds.width / 2
        const y = bounds.y + bounds.height / 2
        if (!bounds.width || !bounds.height || x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) continue
        const hit = document.elementFromPoint(x, y)
        if (hit && (element.contains(hit) || (hit !== document.body && hit.contains(element)))) {
          element.setAttribute('data-visual-mask-foreground', 'true')
        }
      }
    })
  }
  const masks = [page.locator('[data-visual-mask-foreground]')]
  const reviewPath = test.info().outputPath(`review-${name}`)
  await page.screenshot({ path: reviewPath, mask: masks, animations: 'disabled' })
  await test.info().attach(name, { path: reviewPath, contentType: 'image/png' })
  await expect.soft(page).toHaveScreenshot(name, { maxDiffPixelRatio: MAX_DIFF, mask: masks, animations: 'disabled', timeout: 5_000 })
}

test.use({ colorScheme: 'light', locale: 'he-IL', timezoneId: 'Asia/Jerusalem', reducedMotion: 'reduce' })

test.describe('Visual regression pack', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'visual pack on chromium only')
    await page.addInitScript(() => {
      localStorage.setItem('maintainos-theme', 'light')
      localStorage.setItem('mos_nav_hidden', '0')
    })
  })

  test('critical routes across viewports', async ({ page, request }) => {
    test.setTimeout(180_000)
    const fixture = await createVisualFixture(request)
    try {
      const routes = [
        { key: 'ops-tickets-open', path: `/ops/tickets?view=open&q=${encodeURIComponent(fixture.marker)}` },
        { key: 'ops-ticket-detail', path: `/ops/tickets/${fixture.ticketId}` },
        { key: 'tech-jobs', path: `/tech?techId=${OTHER_TECH_ID}` },
        { key: 'tech-job-detail', path: `/tech/${fixture.ticketId}?techId=${OTHER_TECH_ID}` },
      ]
      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height })
        for (const route of routes) {
          await gotoStable(page, route.path)
          await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
          if (route.key === 'ops-tickets-open') {
            if (vp.width < MD_BREAKPOINT) await page.locator('.store-stack').getByRole('button', { expanded: false }).click()
            await expect(page.getByRole('article')).toHaveCount(1)
          }
          if (route.key === 'tech-jobs') await expect(page.locator(`a[href*="/tech/${fixture.ticketId}"]`)).toBeVisible()
          await shot(page, `${route.key}-${vp.name}.png`, fixture)
        }
      }
    } finally {
      await cleanupFixture(request, fixture)
    }
  })
})

test.describe('A11y critical routes', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'axe smoke on chromium only')
  })

  test('ticket detail + tech pages have no critical axe violations', async ({ page, request }) => {
    const fixture = await createVisualFixture(request)
    try {
      for (const path of [
        `/ops/tickets/${fixture.ticketId}`,
        `/tech?techId=${OTHER_TECH_ID}`,
        `/tech/${fixture.ticketId}?techId=${OTHER_TECH_ID}`,
      ]) {
        await gotoStable(page, path)
        const results = await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze()
        expect(results.violations.filter((violation) => violation.impact === 'critical'), `critical axe on ${path}`).toEqual([])
      }
    } finally {
      await cleanupFixture(request, fixture)
    }
  })
})
