/** Isolated hero acceptance; no app server or shared database lifecycle. */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'hero-product.spec.ts', workers: 1, retries: 0,
  use: { browserName: 'chromium', reducedMotion: 'reduce', javaScriptEnabled: true },
});
