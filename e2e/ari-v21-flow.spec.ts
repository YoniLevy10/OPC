import { expect, test } from '@playwright/test'
import { DEMO_ACTORS } from '../src/lib/auth/memory-memberships'
import { authHeaders, HQ_ADMIN_ID, patchTechTicket, patchTicket } from './helpers/api'

test('shop report → fault-led plan → Ari price approval → individual shop feedback (real memory APIs)', async ({ page, request, browser, baseURL }) => {
  test.setTimeout(90_000)
  const marker = `v21-full-${crypto.randomUUID()}`
  const ids: string[] = []
  for (const description of [
    `המזגן הראשי לא מקרר ${marker}`,
    `המזגן במחסן לא מקרר ${marker}`,
  ]) {
    const response = await request.post('/api/store/tickets', {
      headers: authHeaders(DEMO_ACTORS.store172),
      data: { storeCode: '6006', description },
    })
    expect(response.status()).toBe(201)
    const { ticket } = await response.json()
    expect(ticket.category).toBe('hvac')
    ids.push(ticket.id)
  }

  await page.context().addCookies([{ name: 'mos_test_actor', value: HQ_ADMIN_ID, url: baseURL! }])
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/ops/tickets?q=${encodeURIComponent(marker)}`)
  await page.locator('.store-stack').getByRole('button', { expanded: false }).click()
  const checkboxes = page.getByRole('checkbox', { name: /^בחירה לביקור / })
  await expect(checkboxes).toHaveCount(2)
  for (const checkbox of await checkboxes.all()) await checkbox.check()
  await page.getByRole('button', { name: 'תכנון ביקור', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'תכנון ביקור', exact: true })
  await expect(dialog).toContainText('2 תקלות')
  // This verifies the selected work derives the actual profession and city;
  // opening an external site is a separate live integration acceptance step.
  await expect(dialog.getByRole('link', { name: /חיפוש במידרג/ })).toHaveAttribute(
    'href', 'https://www.midrag.co.il/Search/Results?serviceId=284&cityId=1243',
  )
  const approve = dialog.getByRole('button', { name: 'אשר טיפול והעבר לחנות', exact: true })
  await expect(approve).toBeDisabled()
  await dialog.getByLabel('שם איש המקצוע', { exact: true }).fill('איש מקצוע בדיקת מערכת')
  await dialog.getByLabel('טלפון איש המקצוע', { exact: true }).fill('0501234567')
  await dialog.getByLabel('מחיר שסוכם לכל הביקור (₪)', { exact: true }).fill('487')
  const approved = page.waitForResponse((response) => response.url().endsWith('/api/ops/engagements') && response.request().method() === 'POST')
  await approve.click()
  const response = await approved
  expect(response.status()).toBe(201)
  const result = await response.json()
  expect(new Set([result.engagement.ticketId, ...result.engagement.bundledTicketIds])).toEqual(new Set(ids))
  expect(result.engagement.approvedAmount).toBe(487)
  expect(result.handoffs).toHaveLength(1)
  expect(result.handoffs[0].status).toBe('dry_run')
  await expect(dialog).toContainText('לא נשלחה הודעה בפועל')
  await dialog.getByRole('button', { name: 'סגור', exact: true }).click()

  // Ari's work approval is not a substitute for the branch's feedback.
  expect((await request.post(`/api/tickets/${ids[0]}/confirm`, { headers: authHeaders(HQ_ADMIN_ID) })).status()).toBe(403)
  const storeContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  try {
    await storeContext.addCookies([{ name: 'mos_test_actor', value: DEMO_ACTORS.store172, url: baseURL! }])
    const shop = await storeContext.newPage()
    await shop.goto(`/store/tickets/${ids[0]}`)
    await expect(shop.getByRole('main')).toContainText('מנהל החנות מתאם')
    const confirmation = shop.waitForResponse((res) => res.url().endsWith(`/api/tickets/${ids[0]}/confirm`))
    await shop.getByRole('button', { name: 'אשר שהתקלה נפתרה', exact: true }).click()
    expect((await confirmation).status()).toBe(200)
    await expect(shop.getByText(/האישור נקלט והתקלה נסגרה/)).toBeVisible()
    const afterFirst = await request.get('/api/tickets?store=6006&limit=200', { headers: authHeaders(HQ_ADMIN_ID) })
    const firstRows = (await afterFirst.json()).tickets as { id: string; status: string; store_confirmed_at?: string }[]
    expect(firstRows.find((ticket) => ticket.id === ids[0])?.status).toBe('closed')
    expect(firstRows.find((ticket) => ticket.id === ids[1])?.status).toBe('engaged')

    await shop.goto(`/store/tickets/${ids[1]}`)
    await shop.getByRole('button', { name: 'אשר שהתקלה נפתרה', exact: true }).click()
    await expect(shop.getByText(/האישור נקלט והתקלה נסגרה/)).toBeVisible()
    const afterBoth = await request.get('/api/tickets?store=6006&limit=200', { headers: authHeaders(HQ_ADMIN_ID) })
    const rows = (await afterBoth.json()).tickets as { id: string; status: string }[]
    for (const id of ids) expect(rows.find((ticket) => ticket.id === id)?.status).toBe('closed')
  } finally {
    await storeContext.close()
  }
  await page.goto(`/ops/tickets/${ids[0]}`)
  await expect(page.getByRole('main')).toContainText(marker)
})

test('a shop-confirmed technician repair closes immediately while follow-up dates remain metadata', async ({ page, request, baseURL }) => {
  const created = await request.post('/api/store/tickets', {
    headers: authHeaders(DEMO_ACTORS.store172),
    data: { storeCode: '6006', description: `מזגן לא מקרר בדיקת טכנאי ${crypto.randomUUID()}` },
  })
  expect(created.status()).toBe(201)
  const { ticket } = await created.json()
  expect((await patchTicket(request, ticket.id, { assignedTo: DEMO_ACTORS.techA })).status).toBe(200)
  expect((await patchTechTicket(request, ticket.id, { status: 'in_progress' })).status).toBe(200)
  expect((await patchTechTicket(request, ticket.id, {
    status: 'resolved', note: 'תוקן ונבדק בשטח',
    beforePhotoUrl: 'https://example.com/qa-before.jpg',
    afterPhotoUrl: 'https://example.com/qa-after.jpg',
  })).status).toBe(200)
  await page.context().addCookies([{ name: 'mos_test_actor', value: DEMO_ACTORS.store172, url: baseURL! }])
  await page.goto(`/store/tickets/${ticket.id}`)
  const confirmed = page.waitForResponse((response) => response.url().endsWith(`/api/tickets/${ticket.id}/confirm`))
  await page.getByRole('button', { name: 'אשר שהתקלה נפתרה', exact: true }).click()
  const response = await confirmed
  expect(response.status()).toBe(200)
  const result = await response.json()
  expect(result.status).toBe('closed')
  expect(result.pending_final_close).not.toBe(true)
  await expect(page.getByText(/האישור נקלט והתקלה נסגרה/)).toBeVisible()
})
