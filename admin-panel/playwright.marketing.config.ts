/** Isolated editor checks; no shared services or database mutations. */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'product-marketing-form.spec.ts',
  workers: 1,
  retries: 0,
  use: { browserName: 'chromium', reducedMotion: 'reduce' },
});
