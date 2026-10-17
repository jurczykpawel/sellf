import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests', workers: 1, retries: 0,
  timeout: 60000, reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3777',
    extraHTTPHeaders: { 'x-forwarded-for': process.env.RUNTIME_URL_TEST_IP || '198.18.0.1' } },
  projects: [
    { name: 'login-routing', testMatch: 'login-routing.spec.ts' },
    { name: 'runtime-urls', testMatch: 'runtime-urls.spec.ts' },
    { name: 'public-hydration', testMatch: 'public-hydration.spec.ts',
      use: { locale: 'en-US', timezoneId: 'America/Los_Angeles', trace: 'retain-on-failure', screenshot: 'only-on-failure' } },
  ],
});
