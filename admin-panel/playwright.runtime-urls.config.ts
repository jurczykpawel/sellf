import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'runtime-urls.spec.ts', workers: 1, retries: 0,
  timeout: 60000, reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3777',
    extraHTTPHeaders: { 'x-forwarded-for': process.env.RUNTIME_URL_TEST_IP || '198.18.0.1' } },
});
