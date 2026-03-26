import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

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

// Visual test projects run a subset of tests at different viewports with screenshots
const VISUAL_TESTS = [
  '**/visual-pages.spec.ts',
];

export default defineConfig({
  testDir: './tests',
  /* Only run .spec.ts files (exclude .test.ts which are for Vitest) */
  testMatch: '**/*.spec.ts',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry failed tests once */
  retries: 1,
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
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3777',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // Rate-limiting, visual, and accessibility tests are excluded here
      testIgnore: ['**/rate-limiting.spec.ts', '**/rate-limiting-v1.spec.ts', '**/accessibility.spec.ts'],
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
      command: isRateLimitTestMode
        ? 'NODE_OPTIONS=--max-old-space-size=8192 PORT=3777 RATE_LIMIT_TEST_MODE=true bun run dev'
        : 'NODE_OPTIONS=--max-old-space-size=8192 PORT=3777 bun run dev',
      url: 'http://localhost:3777',
      // Never reuse — port 3000 may be occupied by another project (e.g. ReelStack)
      reuseExistingServer: false,
      stdout: quietMode ? 'ignore' : 'pipe',
      stderr: quietMode ? 'ignore' : 'pipe',
      timeout: 60000,
    },
    {
      command: 'npx http-server ../examples/test-pages -p 3778 --cors -c-1',
      url: 'http://localhost:3778',
      reuseExistingServer: false,
      stdout: quietMode ? 'ignore' : 'pipe',
      stderr: quietMode ? 'ignore' : 'pipe',
      timeout: 30000,
    },
  ],
});
