import { expect, test, type Locator } from '@playwright/test'
import { createStore172Ticket, DEMO_TECH_ID, HQ_ADMIN_ID } from './helpers/api'
import { TEST_ACTOR_COOKIE } from '../src/lib/auth/demo-session'

async function expectOpaqueSurface(surface: Locator) {
  const alpha = await surface.evaluate((element) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')!
    context.fillStyle = getComputedStyle(element).backgroundColor
    context.fillRect(0, 0, 1, 1)
    return context.getImageData(0, 0, 1, 1).data[3]
  })
  expect(alpha).toBe(255)
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: TEST_ACTOR_COOKIE, value: HQ_ADMIN_ID, url: baseURL! }])
})

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`treatment planning is visible before secondary detail at ${viewport.width}px`, async ({ page, request }) => {
    await page.setViewportSize(viewport)
    const { ticketId } = await createStore172Ticket(request, { text: `המזגן לא עובד ux${crypto.randomUUID().slice(0, 8)}` })
    await page.goto(`/ops/tickets/${ticketId}`)
    const plan = page.getByRole('button', { name: 'תכנון ביקור', exact: true })
    await expect(plan).toBeInViewport({ ratio: 1 })
    await expect(page.locator('a[href="#ticket-actions"]')).toHaveCount(0)
    await plan.click()
    const sheet = page.getByRole('dialog', { name: 'תכנון ביקור', exact: true })
    await expectOpaqueSurface(sheet)
    const close = sheet.getByRole('button', { name: 'סגירה', exact: true })
    const bounds = (await close.boundingBox())!
    expect(bounds.width).toBeGreaterThanOrEqual(44)
    expect(bounds.height).toBeGreaterThanOrEqual(44)
    await close.click()
    await expect(sheet).toHaveCount(0)
  })
}

test('mobile technician title stays readable and account controls stay reachable', async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await context.addCookies([{ name: TEST_ACTOR_COOKIE, value: DEMO_TECH_ID, url: baseURL! }])
  await page.goto(`/tech?techId=${DEMO_TECH_ID}`)
  const heading = page.getByRole('heading', { name: 'העבודות שלי', exact: true })
  await expect(heading).toBeInViewport({ ratio: 1 })
  const titleSize = await heading.evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, overflow: getComputedStyle(element).textOverflow }))
  expect(titleSize.width).toBeGreaterThanOrEqual(160)
  expect(titleSize.scrollWidth).toBeLessThanOrEqual(titleSize.width)
  expect(titleSize.overflow).not.toBe('ellipsis')
  const options = page.getByRole('button', { name: 'אפשרויות תצוגה וחשבון', exact: true })
  await options.click()
  const drawer = page.getByRole('dialog', { name: 'אפשרויות תצוגה וחשבון', exact: true })
  await expectOpaqueSurface(drawer)
  await expect(drawer.getByRole('group', { name: 'שפה' })).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'התנתקות', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await expect(options).toBeFocused()
})

test('mobile WhatsApp send target is not covered by the assistant', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { wa_id } = await createStore172Ticket(request)
  await page.goto(`/ops/inbox?wa=${wa_id}`)
  await page.getByRole('textbox', { name: 'הודעה ללקוח', exact: true }).fill('טיוטת בדיקה שלא תישלח')
  const send = page.getByRole('button', { name: 'שליחה', exact: true })
  await expect(send).toBeEnabled()
  await expect(send).toBeInViewport({ ratio: 1 })
  expect(await send.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    return target === element || element.contains(target)
  })).toBe(true)
  await expect(page.getByRole('button', { name: 'פתח את הסוכן', exact: true })).toHaveCount(0)
})
