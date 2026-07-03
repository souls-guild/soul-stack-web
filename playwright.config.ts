import { defineConfig, devices } from '@playwright/test';

// UI-smoke прогоняется против ЖИВОГО локального стенда (keeper :8080 + vite :5173),
// без моков API. Стенд поднимается core make-таргетами (см. e2e/README.md).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:5173/ui/',
    storageState: 'e2e/.auth/state.json',
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
