/** Section and marketing browser fixtures without app servers or database lifecycle. */
import { defineConfig } from '@playwright/test';

export const SECTION_FIXTURE_FILES = [
  'storefront-authoring-feedback.spec.ts',
  'checkout-lifecycle.spec.ts', 'dashboard-layout.spec.ts', 'webhook-feedback.spec.ts', 'settings-panel-locale.spec.ts',
  'hero-product.spec.ts', 'price-runtime.spec.ts', 'product-marketing-form.spec.ts',
  'storefront-catalogue.spec.ts', 'storefront-composition.spec.ts', 'storefront-faq-closing.spec.ts',
  'storefront-task-nav.spec.ts', 'storefront-theme.spec.ts', 'storefront-product-list.spec.ts',
];

export default defineConfig({
  updateSnapshots: 'none',
  testDir: './tests',
  workers: 1,
  retries: 0,
  use: { browserName: 'chromium', reducedMotion: 'reduce' },
  // Unnamed projects preserve the existing screenshot paths and suffixes.
  projects: [
    {
      testMatch: SECTION_FIXTURE_FILES.filter(file => file !== 'storefront-product-list.spec.ts'),
    },
    {
      testMatch: 'storefront-product-list.spec.ts',
      snapshotPathTemplate: 'tests/fixtures/storefront-sections/product-list-snapshots/{arg}{ext}',
    },
  ],
});
