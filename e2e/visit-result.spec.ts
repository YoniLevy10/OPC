import { test, expect, type Locator, type Page } from '@playwright/test'
import { TEST_ACTOR_COOKIE } from '../src/lib/auth/demo-session'
import { authHeaders, createStore172Ticket, HQ_ADMIN_ID, patchTicket } from './helpers/api'
import { DEMO_ACTORS } from '../src/lib/auth/memory-memberships'

type ApprovalRequest = {
  action?: 'retry'
  ticketId: string
  bundledTicketIds?: string[]
  professionalName?: string
  professionalPhone?: string
  approvedAmount?: number
}

function approvalResult(body: ApprovalRequest, status: 'sent' | 'failed' | 'dry_run' = 'sent') {
  return {
    engagement: { id: `approval-${body.ticketId}`, professionalName: 'טכנאי בדיקה', approvedAmount: 450 },
    handoffs: [{
      storeId: 'test-store', storeCode: '6006', storeName: 'חנות בדיקה',
      ticketIds: [body.ticketId, ...(body.bundledTicketIds ?? [])],
      status, error: status === 'failed' ? 'כשל העברה לבדיקה' : null,
      canRetry: status === 'failed',
    }],
  }
}

async function selectPlan(page: Page, query: string, count: number) {
  await page.goto(`/ops/tickets?view=open&q=${encodeURIComponent(query)}`)
  const checkboxes = page.getByRole('checkbox', { name: /^בחירה לביקור /, includeHidden: true })
  await expect(checkboxes).toHaveCount(count)
  if (page.viewportSize()!.width < 768) {
    const fold = page.locator('.store-stack').getByRole('button', { expanded: false })
    await expect(fold).toBeVisible()
    await fold.click()
  }
  for (const checkbox of await checkboxes.all()) await checkbox.check()
  await page.getByRole('button', { name: 'תכנון ביקור', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'תכנון ביקור', exact: true })
  await expect(dialog).toBeVisible()
  return { dialog, checkboxes }
}

async function fillTerms(scope: Locator) {
  await scope.getByLabel('שם איש המקצוע', { exact: true }).fill('טכנאי בדיקה')
  await scope.getByLabel('טלפון איש המקצוע', { exact: true }).fill('0501234567')
  await scope.getByLabel('מחיר שסוכם לכל הביקור (₪)', { exact: true }).fill('450')
}

async function expectReadableSheet(dialog: Locator, page: Page) {
  const alpha = await dialog.evaluate((element) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')!
    context.fillStyle = getComputedStyle(element).backgroundColor
    context.fillRect(0, 0, 1, 1)
    return context.getImageData(0, 0, 1, 1).data[3]
  })
  expect(alpha).toBe(255)
  const bounds = (await dialog.boundingBox())!
  const viewport = page.viewportSize()!
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
}

function queueRefresh(page: Page) {
  const pathname = new URL(page.url()).pathname
  return page.waitForResponse((response) =>
    new URL(response.url()).pathname === pathname && response.request().headers()['rsc'] === '1')
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test.describe(`Fault-first visit approval ${viewport.width}px (memory backend)`, () => {
    test.use({ viewport })
    test.beforeEach(async ({ context, baseURL }) => {
      await context.addCookies([{ name: TEST_ACTOR_COOKIE, value: HQ_ADMIN_ID, url: baseURL! }])
    })

    test('requires agreed contact and price; keeps result until close and submits once', async ({ page, request }) => {
      const query = `visit-success-${crypto.randomUUID()}`
      const { ticketId } = await createStore172Ticket(request, { text: `המזגן לא עובד ${query}` })
      const submissions: ApprovalRequest[] = []
      let release!: () => void
      const responseReady = new Promise<void>((resolve) => { release = resolve })
      await page.route('**/api/ops/engagements', async (route) => {
        const body = route.request().postDataJSON() as ApprovalRequest
        submissions.push(body)
        await responseReady
        await route.fulfill({ json: approvalResult(body) })
      })

      const { dialog, checkboxes } = await selectPlan(page, query, 1)
      await expect(dialog.getByRole('link', { name: /חיפוש במידרג/ })).toHaveAttribute('href', /serviceId=284&cityId=1243/)
      await expect(dialog.getByRole('combobox')).toHaveCount(0)
      const submit = dialog.getByRole('button', { name: 'אשר טיפול והעבר לחנות', exact: true })
      await expect(submit).toBeDisabled()
      await dialog.getByLabel('שם איש המקצוע', { exact: true }).fill('טכנאי בדיקה')
      await dialog.getByLabel('מחיר שסוכם לכל הביקור (₪)', { exact: true }).fill('450')
      await expect(submit).toBeDisabled()
      await dialog.getByLabel('טלפון איש המקצוע', { exact: true }).fill('0501234567')
      await dialog.getByLabel('מחיר שסוכם לכל הביקור (₪)', { exact: true }).fill('0')
      await expect(submit).toBeDisabled()
      await dialog.getByLabel('מחיר שסוכם לכל הביקור (₪)', { exact: true }).fill('450')
      await expect(submit).toBeEnabled()
      await submit.evaluate((button) => { button.click(); button.click() })
      await expect(dialog.getByRole('button', { name: 'מאשר ומעביר…', exact: true })).toBeDisabled()
      await expect.poll(() => submissions.length).toBe(1)
      const refreshed = queueRefresh(page)
      release()
      await refreshed

      await expect(dialog.getByText('ארי אישר את הטיפול', { exact: true })).toBeVisible()
      await expect(dialog.getByText('הועבר לשליחה · חנות בדיקה', { exact: true })).toBeVisible()
      await expectReadableSheet(dialog, page)
      await expect(checkboxes).toBeChecked()
      await expect(submit).toHaveCount(0)
      await dialog.getByRole('button', { name: 'סגור', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(checkboxes).not.toBeChecked()
      expect(submissions).toEqual([{
        ticketId, bundledTicketIds: [], professionalName: 'טכנאי בדיקה', professionalPhone: '0501234567', approvedAmount: 450,
      }])
    })

    test('retries only handoff after approval, retaining scope across a changed queue', async ({ page, request }) => {
      const query = `visit-retry-${crypto.randomUUID()}`
      const first = await createStore172Ticket(request, { text: `המזגן לא עובד ${query} ראשון` })
      const second = await createStore172Ticket(request, { text: `המזגן לא עובד ${query} שני` })
      const submissions: ApprovalRequest[] = []
      await page.route('**/api/ops/engagements', async (route) => {
        const body = route.request().postDataJSON() as ApprovalRequest
        submissions.push(body)
        if (submissions.length === 1) {
          expect((await patchTicket(request, second.ticketId, { status: 'cancelled' })).status).toBe(200)
        }
        await route.fulfill({ json: approvalResult(body, submissions.length === 1 ? 'failed' : 'dry_run') })
      })

      const { dialog, checkboxes } = await selectPlan(page, query, 2)
      await fillTerms(dialog)
      const firstRefresh = queueRefresh(page)
      await dialog.getByRole('button', { name: 'אשר טיפול והעבר לחנות', exact: true }).click()
      await firstRefresh
      await expect(checkboxes).toHaveCount(1)
      await expect(dialog.getByText('ארי אישר את הטיפול', { exact: true })).toBeVisible()
      await expect(dialog.getByText('כשל העברה לבדיקה', { exact: true })).toBeVisible()
      await expect(dialog.getByLabel('שם איש המקצוע', { exact: true })).toHaveCount(0)
      // Closing a partial handoff preserves the approved plan for continuation.
      await dialog.getByRole('button', { name: 'סגור', exact: true }).click()
      await page.getByRole('button', { name: 'תכנון ביקור', exact: true }).click()
      await expect(dialog.getByText('כשל העברה לבדיקה', { exact: true })).toBeVisible()
      const secondRefresh = queueRefresh(page)
      await dialog.getByRole('button', { name: 'נסה שוב להעביר לחנות', exact: true }).click()
      await secondRefresh
      await expect(dialog.getByText('מצב הדגמה — לא נשלחה הודעה בפועל · חנות בדיקה', { exact: true })).toBeVisible()
      expect(submissions).toHaveLength(2)
      expect([submissions[0].ticketId, ...submissions[0].bundledTicketIds!].sort()).toEqual([first.ticketId, second.ticketId].sort())
      expect(submissions[1]).toEqual({ action: 'retry', ticketId: submissions[0].ticketId })
      await dialog.getByRole('button', { name: 'סגור', exact: true }).click()
      await expect(checkboxes).not.toBeChecked()
    })

    test('splits every selected profession before Midrag and approves each work scope explicitly', async ({ page, request }) => {
      const query = `visit-trades-${crypto.randomUUID()}`
      const air = await createStore172Ticket(request, { text: `המזגן לא עובד ${query}` })
      const water = await createStore172Ticket(request, { text: `נזילה בצינור מים ${query}` })
      const submissions: ApprovalRequest[] = []
      await page.route('**/api/ops/engagements', async (route) => {
        const body = route.request().postDataJSON() as ApprovalRequest
        submissions.push(body)
        await route.fulfill({ json: approvalResult(body) })
      })
      const { dialog, checkboxes } = await selectPlan(page, query, 2)
      const airGroup = dialog.getByRole('region', { name: 'תיקון מזגן · תל אביב', exact: true })
      const waterGroup = dialog.getByRole('region', { name: 'אינסטלציה · תל אביב', exact: true })
      await expect(airGroup).toContainText('המזגן לא עובד')
      await expect(waterGroup).toContainText('נזילה בצינור מים')
      await expect(dialog.getByRole('link', { name: /חיפוש במידרג/ })).toHaveCount(2)
      await expect(waterGroup.getByRole('link', { name: /חיפוש במידרג/ })).toHaveAttribute('href', /serviceId=119&cityId=1243/)
      await fillTerms(waterGroup)
      await waterGroup.getByRole('button', { name: 'אשר טיפול והעבר לחנות', exact: true }).click()
      await expect(waterGroup.getByText('ארי אישר את הטיפול', { exact: true })).toBeVisible()
      expect(submissions[0].ticketId).toBe(water.ticketId)
      expect(submissions[0].bundledTicketIds).toEqual([])
      await expect(airGroup.getByLabel('שם איש המקצוע', { exact: true })).toBeVisible()
      for (const checkbox of await checkboxes.all()) await expect(checkbox).toBeChecked()
      await fillTerms(airGroup)
      await airGroup.getByRole('button', { name: 'אשר טיפול והעבר לחנות', exact: true }).click()
      await expect(airGroup.getByText('ארי אישר את הטיפול', { exact: true })).toBeVisible()
      expect(submissions[1].ticketId).toBe(air.ticketId)
      await dialog.getByRole('button', { name: 'סגור', exact: true }).click()
      for (const checkbox of await checkboxes.all()) await expect(checkbox).not.toBeChecked()
    })
  })
}

test('store visit planning works with no active vendors', async ({ page, request, context, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await context.addCookies([{ name: TEST_ACTOR_COOKIE, value: HQ_ADMIN_ID, url: baseURL! }])
  const { step2 } = await createStore172Ticket(request, { text: `המזגן לא עובד no-vendors-${crypto.randomUUID()}` })
  const headers = authHeaders(HQ_ADMIN_ID)
  const response = await request.get('/api/vendors?active=1', { headers })
  const data = await response.json() as { backend: string; vendors: { id: string }[] }
  // This fixture must never modify vendor settings in a connected database.
  expect(data.backend).toBe('memory')
  try {
    for (const vendor of data.vendors) {
      expect((await request.patch(`/api/vendors/${vendor.id}`, { headers, data: { active: false } })).ok()).toBe(true)
    }
    await page.goto('/ops/stores/6006')
    const checkbox = page.getByRole('checkbox', { name: `בחירה לביקור ${step2.display_number}`, exact: true })
    await checkbox.check()
    await page.getByRole('button', { name: 'תכנון ביקור (1)', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'תכנון ביקור', exact: true })
    await expect(dialog.getByRole('link', { name: /חיפוש במידרג/ })).toHaveAttribute('href', /serviceId=284&cityId=1243/)
    await fillTerms(dialog)
    await expect(dialog.getByRole('button', { name: 'אשר טיפול והעבר לחנות', exact: true })).toBeEnabled()
  } finally {
    for (const vendor of data.vendors) {
      const restored = await request.patch(`/api/vendors/${vendor.id}`, { headers, data: { active: true } })
      expect(restored.ok(), `Restore memory vendor ${vendor.id}: ${await restored.text()}`).toBe(true)
    }
  }
})

test('only Ari can select eligible waiting faults for a plan in the queue and store', async ({ page, request, context, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const query = `visit-eligible-${crypto.randomUUID()}`
  const eligible = await createStore172Ticket(request, { text: `המזגן לא עובד ${query} ממתין` })
  const inVisit = await createStore172Ticket(request, { text: `המזגן לא עובד ${query} ביקור קיים` })
  const approval = await request.post('/api/ops/engagements', {
    headers: authHeaders(HQ_ADMIN_ID),
    data: { ticketId: inVisit.ticketId, professionalName: 'טכנאי פיילוט', professionalPhone: '0501234567', approvedAmount: 450 },
  })
  expect(approval.ok(), await approval.text()).toBe(true)

  await context.addCookies([{ name: TEST_ACTOR_COOKIE, value: HQ_ADMIN_ID, url: baseURL! }])
  await page.goto(`/ops/tickets?view=open&q=${encodeURIComponent(query)}`)
  await expect(page.getByRole('article').filter({ hasText: query })).toHaveCount(2)
  await expect(page.getByRole('checkbox', { name: /^בחירה לביקור / })).toHaveCount(1)
  await expect(page.getByRole('checkbox', { name: `בחירה לביקור ${eligible.step2.display_number}`, exact: true })).toBeVisible()
  await page.goto('/ops/stores/6006')
  await expect(page.getByRole('checkbox', { name: `בחירה לביקור ${eligible.step2.display_number}`, exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: `בחירה לביקור ${inVisit.step2.display_number}`, exact: true })).toHaveCount(0)

  await context.addCookies([{ name: TEST_ACTOR_COOKIE, value: DEMO_ACTORS.countryIl, url: baseURL! }])
  await page.goto(`/ops/tickets?view=open&q=${encodeURIComponent(query)}`)
  await expect(page.getByRole('article').filter({ hasText: query })).toHaveCount(2)
  await expect(page.getByRole('checkbox', { name: /^בחירה לביקור / })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^תכנון ביקור/ })).toHaveCount(0)
  await page.goto('/ops/stores/6006')
  await expect(page.getByRole('heading', { name: 'תל אביב אבן גבירול', exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /^בחירה לביקור / })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^תכנון ביקור/ })).toHaveCount(0)
})
