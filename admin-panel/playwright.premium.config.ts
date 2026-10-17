/** Explicit disposable premium trial; no server or credential provisioning. @see tests/premium-a.acceptance.ts */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'premium-a.acceptance.ts', workers: 1, retries: 0,
  timeout: 600000, use: { baseURL: process.env.PREMIUM_TRIAL === 'b' ? 'http://sellf-t213.localhost:55446' : 'http://sellf-t208.localhost:55446', reducedMotion: 'reduce', actionTimeout: 30000, trace: 'off' },
});
