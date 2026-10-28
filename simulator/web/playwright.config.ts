import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const url = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  timeout: 45_000,
  use: { baseURL: url, trace: 'retain-on-failure', screenshot: { mode: 'only-on-failure', fullPage: true }, ...devices['Desktop Chrome'], channel: 'chromium' },
  webServer: { command: `npm run dev -- --port ${port} --strictPort`, url, reuseExistingServer: !process.env.CI },
});
