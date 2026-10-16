import { defineConfig } from '@playwright/test';
import { config } from 'dotenv';
config({ path: '.env.local' });
export default defineConfig({ testDir: './tests', testMatch: 'storefront-template-api.spec.ts', workers: 1, retries: 0, use: { baseURL: 'http://localhost:55436', browserName: 'chromium' } });
