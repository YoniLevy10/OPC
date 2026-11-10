import { test, expect, type Locator, type Page } from '@playwright/test'
import { TEST_ACTOR_COOKIE } from '../src/lib/auth/demo-session'
import { createStore172Ticket, HQ_ADMIN_ID, patchTicket } from './helpers/api'

type VisitRequest = {
  ticketIds: string[]
  idempotencyKey: string
  retryFailedOnly: boolean
  retryTicketIds?: string[]
}

async function selectVisit(page: Page, query: string, count: number) {
  await page.context().addCookies([
    { name: TEST_ACTOR_COOKIE, value: HQ_ADMIN_ID, url: test.info().project.use.baseURL! },
  ])
  await page.goto(`/ops/tickets?view=open&q=${encodeURIComponent(query)}`)
  const checkboxes = page.getByRole('checkbox', { name: /^בחירה לביקור /, includeHidden: true })
  await expect(checkboxes).toHaveCount(count)
  if (page.viewportSize()!.width < 768) {
    const storeFold = page.locator('.store-stack').getByRole('button', { expanded: false })
    await expect(storeFold).toBeVisible()
    await storeFold.click()
  }
  for (const checkbox of await checkboxes.all()) await checkbox.check()
  await page.getByRole('button', { name: 'שיגור ביקור', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'שיגור ביקור משולב', exact: true })
  await expect(dialog).toBeVisible()
  return { dialog, checkboxes }
}

async function expectReadableSheet(dialog: Locator, page: Page) {
  // Canvas normalizes any CSS color representation, including color(srgb …).
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
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/ops/tickets' &&
      response.request().headers()['rsc'] === '1',
  )
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
test.describe(`Visit dispatch result lifecycle ${viewport.width}px (memory backend, mocked dispatch)`, () => {
  test.use({ viewport })
  test('keeps a successful result open until dismissed and clears selection on close', async ({ page, request }) => {
    const query = `visit-success-${crypto.randomUUID()}`
    const { ticketId } = await createStore172Ticket(request, { text: `המזגן לא עובד ${query}` })
    const submissions: VisitRequest[] = []
    let release!: () => void
    const responseReady = new Promise<void>((resolve) => { release = resolve })

    await page.route('**/api/ops/visits', async (route) => {
      submissions.push(route.request().postDataJSON() as VisitRequest)
      await responseReady
      await route.fulfill({ json: {
        visit: {
          id: 'visit-result-success', status: 'dispatched',
          items: [{ ticket_id: ticketId, display_number: 'VISIT-SUCCESS', status: 'sent', error: null, can_retry: false }],
        },
      } })
    })

    const { dialog, checkboxes } = await selectVisit(page, query, 1)
    const submit = dialog.getByRole('button', { name: 'אישור שיגור', exact: true })
    // Two synchronous clicks also exercise the ref guard before React disables it.
    await submit.evaluate((button) => { button.click(); button.click() })
    await expect(dialog.getByRole('button', { name: 'שולח…', exact: true })).toBeDisabled()
    await expect.poll(() => submissions.length).toBe(1)
    const refreshed = queueRefresh(page)
    release()
    await refreshed

    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('VISIT-SUCCESS', { exact: true })).toBeVisible()
    await expect(dialog.getByText('נשלח לספק', { exact: true })).toBeVisible()
    await expectReadableSheet(dialog, page)
    await expect(checkboxes).toBeChecked()
    await expect(submit).toHaveCount(0)

    await dialog.getByRole('button', { name: 'סגור', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(checkboxes).not.toBeChecked()
    await expect(page.getByRole('button', { name: 'שיגור ביקור', exact: true })).toHaveCount(0)
    expect(submissions).toHaveLength(1)
    expect(submissions[0].ticketIds).toEqual([ticketId])
  })

  test('preserves the original visit when a queue refresh removes a ticket before retry', async ({ page, request }) => {
    const query = `visit-partial-${crypto.randomUUID()}`
    const first = await createStore172Ticket(request, { text: `המזגן לא עובד ${query} ראשון` })
    const second = await createStore172Ticket(request, { text: `המזגן לא עובד ${query} שני` })
    const ticketIds = [first.ticketId, second.ticketId]
    const submissions: VisitRequest[] = []

    await page.route('**/api/ops/visits', async (route) => {
      submissions.push(route.request().postDataJSON() as VisitRequest)
      const partial = submissions.length === 1
      if (partial) {
        // Simulate another operator changing the queue while this sheet is open.
        const cancelled = await patchTicket(request, second.ticketId, { status: 'cancelled' })
        expect(cancelled.status).toBe(200)
      }
      await route.fulfill({ status: partial ? 207 : 200, json: {
        visit: {
          id: 'visit-result-partial', status: partial ? 'partial' : 'dispatched',
          items: ticketIds.map((id, index) => ({
            ticket_id: id, display_number: `VISIT-RETRY-${index + 1}`,
            status: partial && index === 1 ? 'failed' : 'sent',
            error: partial && index === 1 ? 'שגיאת שיגור לבדיקה' : null,
            can_retry: partial && index === 1,
          })),
        },
      } })
    })

    const { dialog, checkboxes } = await selectVisit(page, query, 2)
    const firstRefresh = queueRefresh(page)
    await dialog.getByRole('button', { name: 'אישור שיגור', exact: true }).click()
    await firstRefresh
    await expect(checkboxes).toHaveCount(1)
    await expect(dialog.getByText('שגיאת שיגור לבדיקה', { exact: true })).toBeVisible()

    const secondRefresh = queueRefresh(page)
    await dialog.getByRole('button', { name: 'נסה שוב', exact: true }).click()
    await secondRefresh
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('נשלח לספק', { exact: true })).toHaveCount(2)
    expect(submissions).toHaveLength(2)
    expect(submissions[1].ticketIds.sort()).toEqual(ticketIds.sort())
    expect(submissions[1].retryFailedOnly).toBe(true)
    expect(submissions[1].retryTicketIds).toEqual([second.ticketId])
    expect(submissions[1].idempotencyKey).toBe(submissions[0].idempotencyKey)

    await dialog.getByRole('button', { name: 'סגור', exact: true }).click()
    await expect(checkboxes).not.toBeChecked()
    await expect(dialog).toHaveCount(0)
  })
})
}
