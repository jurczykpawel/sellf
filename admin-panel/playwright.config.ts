import { createSign, generateKeyPairSync } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { SECTION_FIXTURE_FILES } from './playwright.sections.config';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

/**
 * See https://playwright.dev/docs/test-configuration.
 *
 * Rate-limiting tests require RATE_LIMIT_TEST_MODE=true on the dev server.
 * To avoid breaking other tests (which would hit rate limits), rate-limiting
 * tests run in a separate Playwright invocation:
 *
 *   bun ttt   → runs chromium tests, then rate-limiting tests (two passes)
 *   bun tttt  → same but with DB reset first
 *
 * You can also run them individually:
 *   npx playwright test --project=chromium
 *   RATE_LIMIT_TEST_MODE=true npx playwright test --project=rate-limiting
 *   RATE_LIMIT_TEST_MODE=true npx playwright test --project=rate-limiting-v1
 *
 * Visual testing (screenshots at multiple viewports):
 *   npx playwright test --project=visual-mobile --project=visual-tablet --project=visual-wide
 *   bun run test:visual          # all visual projects
 *   bun run test:visual:review   # capture + AI review
 */
const isRateLimitTestMode = process.env.RATE_LIMIT_TEST_MODE === 'true';
const quietMode = process.env.QUIET_MODE === '1';
const isTemplateAuthorMode = process.env.PW_TEMPLATE_AUTHOR === '1';

function templateAuthorEnvironment(): Record<string, string> {
  if (!isTemplateAuthorMode) return {};
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const payload = Buffer.from(JSON.stringify({
    v: 1, kid: 'author-fixture', product: 'author-fixture', email: 'fixture@example.com', order: 'fixture',
    tier: 'business', domain: 'author.example.test', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  return {
    SITE_URL: 'http://author.example.test', NEXT_PUBLIC_SITE_URL: 'http://author.example.test',
    SELLF_LICENSE_PRODUCTS: 'author-fixture',
    SELLF_LICENSE_KEY: `${payload}.${createSign('SHA256').update(payload).end().sign(privateKey).toString('base64url')}`,
    SELLF_JWKS_FALLBACK: JSON.stringify({ keys: [{ kid: 'author-fixture', alg: 'ES256', pem: publicKey.export({ type: 'spki', format: 'pem' }) }] }),
  };
}

// The dev server's ECBProvider (src/lib/services/currencyService.ts) is redirected here
// instead of the real frankfurter.dev host, via the webServer entry below — fixed rates,
// no network dependency, no flakiness from a third-party API being slow/down/changed.
// See scripts/fx-rate-stub-server.mjs.
const FX_STUB_PORT = Number(process.env.FX_STUB_PORT || 3779);
const APP_PORT = Number(process.env.PW_PORT || 3777);
const APP_COMMAND = process.env.PW_PRODUCTION === '1' ? 'start' : 'dev';
const FX_STUB_BASE_URL = `http://127.0.0.1:${FX_STUB_PORT}/v1`;

// Visual test projects run a subset of tests at different viewports with screenshots
const VISUAL_TESTS = [
  '**/visual-pages.spec.ts',
];

// Route-dense specs (>=12 page.goto each) that force Turbopack to compile a large slice
// of the app's route graph. Clustering several of these on one dev server is what trips
// Next's memory auto-restart (see scripts/run-pw-sharded.sh). Split into the dedicated
// `chromium-heavy` project so the sharded runner can give them their own fresh servers.
// NOTE: tests/smoke/critical-paths.spec.ts is also route-dense but stays in `chromium`
// so `bun run test:smoke` (playwright test tests/smoke --project=chromium) keeps working.
const HEAVY_SPECS = [
  '**/variants-admin-ui.spec.ts',
  '**/tracking-events.spec.ts',
  '**/variants-selector.spec.ts',
  '**/pwyw-free-option.spec.ts',
  '**/pwyw-checkout-ui.spec.ts',
  '**/payment-access-flow.spec.ts',
  '**/refund-system.spec.ts',
  '**/waitlist.spec.ts',
  '**/storefront-landing.spec.ts',
  '**/pwyw-admin.spec.ts',
  '**/integrations.spec.ts',
  '**/checkout-payment-e2e.spec.ts',
  '**/payment-method-config-checkout.spec.ts',
  '**/api-keys-ui.spec.ts',
  '**/variants-e2e.spec.ts',
  '**/payment-flow-complete.spec.ts',
  '**/multi-order-bump-access.spec.ts',
];

export default defineConfig({
  testDir: './tests',
  /* Only run .spec.ts files (exclude .test.ts which are for Vitest) */
  testMatch: '**/*.spec.ts',
  /* Safety net: puts known seed products back to their seeded active state even if a
   * spec that bulk-deactivates products gets interrupted before its own restore runs.
   * See tests/global-teardown.ts and tests/helpers/product-state.ts. */
  globalTeardown: './tests/global-teardown.ts',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* A failed attempt is a failed run. */
  retries: 0,
  updateSnapshots: 'none',
  /* Use single worker for test stability (avoids race conditions with shared database) */
  workers: 1,
  /* Reporter: 'dot' in quiet mode (ttt/tttt), 'list' otherwise */
  reporter: quietMode ? 'dot' : 'list',
  /* Per-test timeout: 45s (default 30s is too tight when Turbopack compiles pages on demand) */
  timeout: 45000,
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    // Playwright starts its own server on 3777 to avoid conflicts with other dev servers on 3000
    baseURL: process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${APP_PORT}`,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    ...(isTemplateAuthorMode ? [
      {
        name: 'template-author-setup',
        testMatch: '**/storefront-author.setup.ts',
      },
      {
        name: 'template-author',
        testMatch: '**/storefront-author-flow.acceptance.ts',
        dependencies: ['template-author-setup'],
        use: { ...devices['Desktop Chrome'] },
      },
    ] : []),
    ...(process.env.STRIPE_LIVE_E2E === '1' ? [{
      name: 'stripe-live',
      testMatch: '**/stripe-live/*.spec.ts',
      use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' as const },
      retries: 0,
      timeout: 300000,
    }] : []),
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // Rate-limiting, visual, accessibility, and route-heavy specs are excluded here
      testIgnore: ['**/bank-transfer.spec.ts', '**/public-hydration.spec.ts', '**/stripe-live/**', '**/rate-limiting.spec.ts', '**/rate-limiting-v1.spec.ts', '**/accessibility.spec.ts', ...HEAVY_SPECS, ...SECTION_FIXTURE_FILES.map(file => `**/${file}`)],
    },
    {
      // Route-dense specs split off so the sharded runner can isolate them on their own
      // fresh dev servers (keeps peak RSS down -> no Next memory auto-restart).
      name: 'chromium-heavy',
      use: { ...devices['Desktop Chrome'] },
      testMatch: HEAVY_SPECS,
    },
    {
      name: 'rate-limiting',
      use: { ...devices['Desktop Chrome'] },
      testMatch: '**/rate-limiting.spec.ts',
    },
    {
      name: 'rate-limiting-v1',
      use: { ...devices['Desktop Chrome'] },
      testMatch: '**/rate-limiting-v1.spec.ts',
    },

    // Accessibility testing — WCAG 2.x AA via axe-core
    {
      name: 'accessibility',
      use: { ...devices['Desktop Chrome'] },
      testMatch: '**/accessibility.spec.ts',
    },

    // Visual testing projects — run subset of tests at different viewports with screenshots
    // Usage: npx playwright test --project=visual-mobile --project=visual-tablet --project=visual-wide
    {
      name: 'visual-mobile',
      use: {
        viewport: { width: 375, height: 812 },
        screenshot: 'on',
      },
      testMatch: VISUAL_TESTS,
      outputDir: './screenshots/mobile',
    },
    {
      name: 'visual-tablet',
      use: {
        viewport: { width: 768, height: 1024 },
        screenshot: 'on',
      },
      testMatch: VISUAL_TESTS,
      outputDir: './screenshots/tablet',
    },
    {
      name: 'visual-laptop',
      use: {
        viewport: { width: 1366, height: 768 },
        screenshot: 'on',
      },
      testMatch: VISUAL_TESTS,
      outputDir: './screenshots/laptop',
    },
    {
      name: 'visual-wide',
      use: {
        viewport: { width: 1920, height: 1080 },
        screenshot: 'on',
      },
      testMatch: VISUAL_TESTS,
      outputDir: './screenshots/wide',
    },
    {
      name: 'visual-qhd',
      use: {
        viewport: { width: 2560, height: 1440 },
        screenshot: 'on',
      },
      testMatch: VISUAL_TESTS,
      outputDir: './screenshots/qhd',
    },
    {
      name: 'visual-4k',
      use: {
        viewport: { width: 3840, height: 2160 },
        screenshot: 'on',
      },
      testMatch: VISUAL_TESTS,
      outputDir: './screenshots/4k',
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: [
    {
      // Fixed-rate exchange stub — see the FX_STUB_* constants above. Started first so
      // its /health check is green before the dev server (which points at it) takes
      // its first currency request.
      command: `FX_STUB_PORT=${FX_STUB_PORT} node scripts/fx-rate-stub-server.mjs`,
      url: `http://127.0.0.1:${FX_STUB_PORT}/health`,
      reuseExistingServer: !isTemplateAuthorMode && process.env.PW_REUSE_SERVER === '1',
      stdout: quietMode ? 'ignore' : 'pipe',
      stderr: quietMode ? 'ignore' : 'pipe',
      timeout: 10000,
    },
    {
      // E2E specs assume captcha test mode; pin it so results don't depend on .env.local
      // (API tests pin the opposite — real ALTCHA — in scripts/run-api-tests.sh).
      // CURRENCY_ECB_BASE_URL redirects the ECB currency provider at the fixed-rate
      // stub above instead of the real frankfurter.dev host (see currencyService.ts /
      // startup-assertions.ts — this override is refused outside test runs in production).
      command: isRateLimitTestMode
        ? `NODE_OPTIONS=--max-old-space-size=8192 E2E_MODE=true NEXT_PUBLIC_TURNSTILE_TEST_MODE=${APP_COMMAND === 'start' ? 'false' : 'true'} CURRENCY_ECB_BASE_URL=${APP_COMMAND === 'start' ? '' : FX_STUB_BASE_URL} PORT=${APP_PORT} RATE_LIMIT_TEST_MODE=true bun run ${APP_COMMAND}`
        : `NODE_OPTIONS=--max-old-space-size=8192 E2E_MODE=true NEXT_PUBLIC_TURNSTILE_TEST_MODE=${APP_COMMAND === 'start' ? 'false' : 'true'} CURRENCY_ECB_BASE_URL=${APP_COMMAND === 'start' ? '' : FX_STUB_BASE_URL} PORT=${APP_PORT} bun run ${APP_COMMAND}`,
      env: templateAuthorEnvironment(),
      url: `http://localhost:${APP_PORT}`,
      // Never reuse — port 3000 may be occupied by another project (e.g. ReelStack)
      reuseExistingServer: !isTemplateAuthorMode && process.env.PW_REUSE_SERVER === '1',
      stdout: quietMode ? 'ignore' : 'pipe',
      stderr: quietMode ? 'ignore' : 'pipe',
      timeout: 60000,
    },
  ],
});
