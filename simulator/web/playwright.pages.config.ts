import { defineConfig, devices } from '@playwright/test';

const prefix = (process.env.PAGES_BASE_PATH ?? '/ADDN_simulator').replace(/\/$/, '');

export default defineConfig({
  testDir: './pages-tests',
  timeout: 45_000,
  use: {
    baseURL: `http://127.0.0.1:4174${prefix}/`,
    ...devices['Desktop Chrome'],
    channel: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npm run preview -- --port 4174 --strictPort --base=${prefix}/`,
    url: `http://127.0.0.1:4174${prefix}/`,
    reuseExistingServer: false,
  },
});
