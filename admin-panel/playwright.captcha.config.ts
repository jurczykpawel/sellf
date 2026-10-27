/** Real-captcha checks use a dedicated server instead of password-login test mode. */
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
const port = Number(process.env.PW_PORT || 3780);
const databaseUrl = new URL(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://missing');
if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname)) throw new Error('Captcha acceptance requires a local Supabase stack');
export default defineConfig({
  testDir: './tests',
  testMatch: '**/captcha-feedback.acceptance.ts',
  workers: 1,
  retries: 0,
  timeout: 60000,
  use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  webServer: {
    command: `E2E_MODE=false NEXT_PUBLIC_TURNSTILE_TEST_MODE=false bun run dev --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
