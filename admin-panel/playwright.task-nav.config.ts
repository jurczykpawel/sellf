/** Task-navigation fixtures without shared app/DB services or teardown. */
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'storefront-task-nav.spec.ts', workers: 1, retries: 0,
  use: { browserName: 'chromium', reducedMotion: 'reduce' },
});
