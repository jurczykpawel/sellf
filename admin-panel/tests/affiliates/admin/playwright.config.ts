import { defineConfig } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: '.', testMatch: 'ui.matrix.ts', workers: 1, timeout: 30000,
  outputDir: '/private/tmp/sellf-aff-a12-browser',
  use: { baseURL: 'http://127.0.0.1:55478', browserName: 'chromium' },
  webServer: { cwd: path.resolve(__dirname, '../../..'), command: '/tmp/bun-1314/bun-darwin-aarch64/bun x vite --config tests/affiliates/admin/vite.config.ts', url: 'http://127.0.0.1:55478/tests/affiliates/admin/harness.html', reuseExistingServer: false },
});
