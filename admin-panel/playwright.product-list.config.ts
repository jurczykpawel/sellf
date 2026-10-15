/** Isolated starter fixtures; shared database and app servers stay untouched. */
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', testMatch: 'storefront-product-list.spec.ts', snapshotPathTemplate: 'tests/fixtures/storefront-sections/product-list-snapshots/{arg}{ext}', workers: 1, retries: 0, use: { browserName: 'chromium', reducedMotion: 'reduce' } });
