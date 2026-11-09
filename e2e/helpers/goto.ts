import type { Page } from '@playwright/test'

/**
 * Navigate and settle without hanging forever on pages that keep
 * long-polling / health chips open (e.g. /ops/stores).
 */
export async function gotoStable(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await page
    .waitForLoadState('networkidle', { timeout: 5_000 })
    .catch(() => undefined)
}
