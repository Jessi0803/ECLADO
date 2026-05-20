import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT || 4173);
const baseURL = process.env.BASE_URL || `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  outputDir: '.playwright/test-results',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '.playwright/report' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: `node tests/support/static-server.mjs --port ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
