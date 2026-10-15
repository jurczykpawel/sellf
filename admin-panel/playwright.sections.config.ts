/** Section and marketing browser fixtures without app servers or database lifecycle. */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  retries: 0,
  use: { browserName: 'chromium', reducedMotion: 'reduce' },
  // Unnamed projects preserve the existing screenshot paths and suffixes.
  projects: [
    {
      testMatch: [
        'hero-product.spec.ts',
        'product-marketing-form.spec.ts',
        'storefront-catalogue.spec.ts',
        'storefront-composition.spec.ts',
        'storefront-faq-closing.spec.ts',
        'storefront-task-nav.spec.ts',
        'storefront-theme.spec.ts',
      ],
    },
    {
      testMatch: 'storefront-product-list.spec.ts',
      snapshotPathTemplate: 'tests/fixtures/storefront-sections/product-list-snapshots/{arg}{ext}',
    },
  ],
});
