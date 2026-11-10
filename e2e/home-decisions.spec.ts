import { expect, test } from '@playwright/test'
import { createStore172Ticket, DEMO_TECH_ID, HQ_ADMIN_ID, authHeaders, patchTicket } from './helpers/api'

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`Ari finds decisions and delegated work on the home at ${viewport.width}px`, async ({ page, request, baseURL }) => {
    await page.setViewportSize(viewport)
    await page.context().addCookies([{ name: 'mos_test_actor', value: HQ_ADMIN_ID, url: baseURL! }])
    const marker = `home${crypto.randomUUID().slice(0, 8)}`
    const taskTitle = `בדיקת תעודת כיול ${marker}`
    const createdTask = await request.post('/api/ops/agent-chat', {
      data: { message: `תפתח משימה ${taskTitle} בסניף 6006` },
      headers: authHeaders(HQ_ADMIN_ID),
    })
    expect(createdTask.ok()).toBe(true)

    const faultTitle = `המזגן לא עובד ${marker}`
    const { ticketId } = await createStore172Ticket(request, { text: faultTitle })
    expect((await patchTicket(request, ticketId, { assignedTo: DEMO_TECH_ID })).status).toBe(200)

    await page.goto('/ops/dashboard')
    const home = page.locator('#decisions')
    await expect(home.getByRole('heading', { name: 'הפעולה הבאה שלך' })).toBeVisible()
    const all = home.locator('summary').filter({ hasText: 'כל הפעולות' })
    if (await all.count()) await all.click()
    const task = home.getByRole('listitem').filter({ hasText: taskTitle })
    await expect(task).toBeVisible()
    await expect(task).toContainText('באחריות: ארי')
    await expect(task.getByRole('link', { name: 'לטפל במשימה' })).toHaveAttribute('href', '/ops/tasks')

    const waiting = home.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'במעקב — החנות או איש המקצוע ממשיכים מכאן' }) })
    await waiting.locator('summary').click()
    const assigned = waiting.getByRole('listitem').filter({ hasText: marker }).filter({ hasText: 'מזגן' })
    await expect(assigned).toBeVisible()
    await expect(assigned).toContainText('איש המקצוע')
    await expect(assigned.getByRole('link')).toHaveAttribute('href', `/ops/tickets/${ticketId}`)
    await expect(page.getByRole('link', { name: /הוצאות לבדיקה/ })).toHaveAttribute('href', '#decisions')
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)).toBe(false)
    if (viewport.width < 1024) {
      await page.getByRole('navigation', { name: 'ניווט תחתון' }).getByRole('button', { name: 'עוד' }).click()
      await expect(page.getByRole('dialog').locator('a[href="/ops/alerts"]')).toHaveCount(0)
    } else {
      await expect(page.getByRole('complementary').locator('a[href="/ops/alerts"]')).toHaveCount(0)
    }
  })
}
