/** Catalogue-only browser checks; no shared services or database lifecycle. */
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: 'storefront-catalogue.spec.ts',
  workers: 1,
  retries: 0,
  use: { browserName: 'chromium', reducedMotion: 'reduce' },
});
