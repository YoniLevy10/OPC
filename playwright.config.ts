import { defineConfig, devices } from '@playwright/test'

// Align HMAC with e2e/helpers/pro-token.ts even when the shell has CRON_SECRET.
process.env.PRO_PORTAL_SECRET =
  process.env.PRO_PORTAL_SECRET?.trim() || 'dev-pro-portal-secret'

const PORT = Number(process.env.PLAYWRIGHT_PORT || 3100)
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: `MAINTAINOS_FORCE_MEMORY=1 MAINTAINOS_ALLOW_TEST_AUTH=1 npx next start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      MAINTAINOS_FORCE_MEMORY: '1',
      MAINTAINOS_ALLOW_TEST_AUTH: '1',
      // Never send real 019 SMS / redirected personal SMS during e2e.
      SMS_019_ENABLED: '0',
      SMS_019_DRY_RUN: '1',
      // Keep pro-portal HMAC aligned with e2e/helpers/pro-token.ts default
      // (next start would otherwise pick CRON_SECRET / service role from .env).
      PRO_PORTAL_SECRET: 'dev-pro-portal-secret',
      PORT: String(PORT),
      NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || '.next',
    },
  },
})
