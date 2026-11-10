import { expect, test } from '@playwright/test'
import { HQ_ADMIN_ID } from './helpers/api'

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test(`Ari can report a fault from the desk at ${viewport.width}px`, async ({ page, baseURL }) => {
    await page.setViewportSize(viewport)
    await page.context().addCookies([
      { name: 'mos_test_actor', value: HQ_ADMIN_ID, url: baseURL! },
    ])
    await page.goto('/ops/dashboard')
    await page.getByRole('main').getByRole('button', { name: 'תקלה חדשה', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'תקלה חדשה', exact: true })
    await expect(dialog).toBeVisible()
    if (viewport.width < 1024) await expect(dialog).toHaveClass(/phone-sheet/)
    await dialog.getByLabel('חנות', { exact: true }).selectOption('6006')
    const description = `נזילה ליד הדלפק — בדיקת מוקד ${viewport.width} ${Date.now()}`
    await dialog.getByLabel('תיאור התקלה', { exact: true }).fill(description)
    const created = page.waitForResponse((response) =>
      response.url().endsWith('/api/tickets') && response.request().method() === 'POST',
    )
    await dialog.getByRole('button', { name: 'שליחת דיווח', exact: true }).click()
    const response = await created
    expect(response.status()).toBe(201)
    const { ticket } = await response.json()
    expect(ticket.description).toBe(description)
    await expect(dialog.getByRole('status')).toContainText('התקלה נפתחה')
    await dialog.getByRole('link', { name: 'לצפייה בתקלה', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/ops/tickets/${ticket.id}`))
    await expect(page.getByRole('main')).toContainText(description)
    await page.goto('/ops/tickets')
    await expect(page.getByRole('main').getByRole('button', { name: 'תקלה חדשה', exact: true })).toBeVisible()
  })
}
