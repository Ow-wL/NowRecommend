import { defineConfig } from '@playwright/test';
const port = Number(process.env.PLAYWRIGHT_PORT || 5173);
const baseURL = `http://127.0.0.1:${port}`;
// Server-mode specs run against a second dev server built with a fake API origin; tests/api routes intercept it.
const apiPort = port + 1;
const apiBaseURL = `http://127.0.0.1:${apiPort}`;
const FAKE_API = 'http://127.0.0.1:5999'; // nothing listens here; tests/api/server-mode.spec.ts uses the same origin
const vite = (p: number) => `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${p} --strictPort`;
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 2,
  timeout: 30000,
  use: { channel: 'msedge', headless: true, viewport: { width: 1440, height: 1050 } },
  projects: [
    { name: 'offline', testIgnore: '**/api/**', use: { baseURL } },
    { name: 'api', testMatch: '**/api/**/*.spec.ts', use: { baseURL: apiBaseURL } },
  ],
  webServer: [
    { command: vite(port), url: baseURL, reuseExistingServer: false, timeout: 30000, env: { VITE_API_BASE_URL: '' } },
    { command: vite(apiPort), url: apiBaseURL, reuseExistingServer: false, timeout: 30000, env: { VITE_API_BASE_URL: FAKE_API } },
  ],
});
