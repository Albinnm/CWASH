import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.js', workers: 1,
  use: { baseURL: 'http://127.0.0.1:3100', headless: true, launchOptions: process.env.CWASH_BROWSER_PATH ? { executablePath: process.env.CWASH_BROWSER_PATH } : {}, screenshot: 'only-on-failure' },
  webServer: { command: 'node tests/browser-server.js', url: 'http://127.0.0.1:3100/api/health', reuseExistingServer: false, timeout: 15000 },
});
