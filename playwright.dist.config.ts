import { defineConfig } from '@playwright/test';
// The built site, served as it will be (`npm run build` first, with VITE_API_BASE_URL=http://127.0.0.1:5999, then
// `npm run test:dist`). The dev server has no Content-Security-Policy and no service worker; this is where those are seen.
const port = Number(process.env.PLAYWRIGHT_PORT || 4175);
export default defineConfig({
  testDir: './tests/dist',
  timeout: 30000,
  use: { channel: process.env.PW_CHANNEL || 'msedge', headless: true, baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1280, height: 900 } },
  webServer: { command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 30000 },
});
