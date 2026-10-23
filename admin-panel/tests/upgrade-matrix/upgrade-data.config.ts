/** Isolated browser gate for a populated release upgrade. @see scripts/upgrade-data-test.sh */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'upgrade-data.smoke.ts', workers: 1, retries: 0, timeout: 90_000,
  use: { baseURL: 'http://localhost:55581', trace: 'retain-on-failure' },
  webServer: {
    command: 'E2E_MODE=true NEXT_PUBLIC_TURNSTILE_TEST_MODE=true PORT=55581 bun run dev',
    url: 'http://localhost:55581/api/health', timeout: 120_000, reuseExistingServer: false,
    cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe',
  },
});
