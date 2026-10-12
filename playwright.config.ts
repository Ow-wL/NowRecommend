import { defineConfig } from '@playwright/test';
const port = Number(process.env.PLAYWRIGHT_PORT || 5173);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  timeout: 30000,
  use: { baseURL, channel: 'msedge', headless: true, viewport: { width: 1440, height: 1050 } },
  webServer: { command: `npm run dev -- --port ${port}`, url: baseURL, reuseExistingServer: false, timeout: 30000 },
});
