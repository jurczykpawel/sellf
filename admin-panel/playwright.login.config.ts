/** Locale login navigation against an isolated app server. */
import { defineConfig } from '@playwright/test';

const port = Number(process.env.LOGIN_TEST_PORT ?? 55515);
export default defineConfig({
  testDir: './tests',
  testMatch: 'login-routing.spec.ts',
  workers: 1,
  retries: 0,
  use: { browserName: 'chromium', baseURL: `http://localhost:${port}`, locale: 'en-US' },
  webServer: {
    command: `bun run dev --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
