/** Browser checks for shared admin feedback without an application server or database. */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['admin-session-expiry.spec.ts', 'webhook-feedback.spec.ts'],
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: { browserName: 'chromium' },
});
