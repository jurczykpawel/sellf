/** Isolated browser gate for a populated release upgrade. @see scripts/upgrade-data-test.sh */
import { defineConfig } from '@playwright/test';
const port = Number(process.env.PW_PORT || 55581);

export default defineConfig({
  testDir: '.', testMatch: 'upgrade-data.smoke.ts', workers: 1, retries: 0, timeout: 90_000,
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  webServer: {
    command: `E2E_MODE=true NEXT_PUBLIC_TURNSTILE_TEST_MODE=true PORT=${port} bun run dev`,
    url: `http://localhost:${port}/api/health`, timeout: 120_000, reuseExistingServer: false,
    cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe',
  },
});
