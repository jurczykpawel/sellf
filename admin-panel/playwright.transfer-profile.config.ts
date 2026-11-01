/** Transfer-profile acceptance uses local app servers. @see tests/cart-regressions.spec.ts */
import { defineConfig } from '@playwright/test';
import transfer from './playwright.transfer.config';
import runtime from './playwright.runtime-urls.config';

export default defineConfig({
  ...transfer,
  workers: 1,
  retries: 0,
  projects: [
    ...(transfer.projects ?? []).filter(project => project.name === 'chromium').map(project => ({
      ...project, testIgnore: [], testMatch: ['**/cart-regressions.spec.ts', '**/checkout-profile.spec.ts', '**/bank-transfer.spec.ts'],
    })),
    ...(runtime.projects ?? []).filter(project => project.name === 'public-hydration'),
  ],
});
